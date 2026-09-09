import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../scripts/env";

loadEnv();

import { appDb, storage, DOCUMENTS_BUCKET } from "../lib/supabase/service";
import { newToken } from "../lib/intake/session";
import { readDocument, registerDocument } from "../lib/intake/processDocument";
import { syncDossier } from "../lib/db/dossier";
import { purgeAthleteRows } from "../lib/purge/db";
import { getInjuryEntries } from "../lib/db/review";

/**
 * Evalharnas.
 *
 * Draait echte documenten door de volledige pijplijn en rapporteert wat eruit
 * komt: welke velden, met welke herkomst, en of het citaat te verifieren was.
 * Dit loopt tegen de lokale Postgres en doet echte modelcalls, dus het kost
 * geld en tijd. Dat is het punt: een promptwijziging is een gedragswijziging
 * zonder compilerfout, en dit is de enige manier om die te zien.
 *
 * Verwachtingen staan per fixture in evals/expected/<naam>.json. Ontbreekt dat
 * bestand, dan rapporteert de run alleen wat hij vond, zodat je er een
 * verwachting van kunt maken.
 */

const FIXTURES = "evals/fixtures/synthetic";
const EXPECTED = "evals/expected";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

interface Expectation {
  fields?: Record<string, unknown>;
  /** Velden die er absoluut NIET mogen staan: het model mag niets verzinnen. */
  forbidden?: string[];
  minVerifiedQuotes?: number;
  /**
   * Blessures met hun startdatum. Datums in een medische tijdlijn moeten exact
   * kloppen: de klinische samenvatting van deze fixture vond een afwijking van
   * één dag tussen het tekstveld en de tijdlijn, en dat is precies het soort
   * fout dat je niet wil laten wegzakken.
   */
  injuries?: Array<{ bodyRegion: string; onsetDate?: string | null }>;
}

async function createIntake(): Promise<string> {
  const db = appDb();
  const { data: athlete, error: athleteError } = await db
    .from("athletes")
    .insert({
      locale: "nl",
      retention_basis: "evalrun, wordt aan het einde verwijderd",
    })
    .select("id")
    .single();
  if (athleteError || !athlete) throw new Error(athleteError?.message);

  const { hash } = newToken();
  const { data: intake, error } = await db
    .from("intakes")
    .insert({
      athlete_id: athlete.id,
      locale: "nl",
      access_token_hash: hash,
      consent_granted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !intake) throw new Error(error?.message);

  return intake.id as string;
}

async function main() {
  const only = process.argv[2];
  const files = readdirSync(FIXTURES)
    .filter((name) => !name.startsWith("."))
    .filter((name) => !only || name.includes(only))
    // De PDF is de bron; de losse .txt ervan is alleen input voor cupsfilter.
    .filter((name) => name !== "kine-verslag.txt");

  if (files.length === 0) {
    console.log(`geen fixtures in ${FIXTURES}`);
    return;
  }

  let failures = 0;

  for (const file of files) {
    const extension = file.split(".").pop()?.toLowerCase() ?? "txt";
    const mimeType = MIME[extension] ?? "text/plain";
    const bytes = readFileSync(join(FIXTURES, file));

    console.log(`\n${"─".repeat(72)}\n${file}  (${mimeType}, ${bytes.length} bytes)`);

    const intakeId = await createIntake();
    const path = `${intakeId}/${randomUUID()}.${extension}`;

    const upload = await storage()
      .from(DOCUMENTS_BUCKET)
      .upload(path, bytes, { contentType: mimeType });
    if (upload.error) throw new Error(`upload mislukt: ${upload.error.message}`);

    const started = Date.now();
    // Twee stappen, zoals de app ze ook doet: binnenhalen en dan lezen. In de
    // app zit de atleet ertussen; hier niet, want een eval hoort de hele
    // pijplijn te draaien.
    const registered = await registerDocument({
      intakeId,
      storagePath: path,
      originalFilename: file,
      mimeType,
    });
    const result = await readDocument({ intakeId, documentId: registered.documentId });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    console.log(
      `soort ${result.kind} · ${result.pageCount} pagina('s) · ${result.fieldsProposed} velden · ` +
        `${result.quotesVerified} citaten geverifieerd · ${result.injuriesFound} blessures · ${seconds}s`,
    );

    const state = await syncDossier(intakeId);
    const found = new Map<string, unknown>();

    console.log("\n  veld                                waarde                     status      zeker");
    for (const definition of state.definitions) {
      const field = state.resolved.get(definition.key);
      if (!field || field.status === "missing") continue;
      found.set(definition.key, field.value);
      const value = String(field.value ?? "").slice(0, 25);
      console.log(
        `  ${definition.key.padEnd(35)} ${value.padEnd(26)} ${field.status.padEnd(11)} ${field.confidence}`,
      );
    }

    // Verwachtingen aftoetsen.
    let expectation: Expectation | null = null;
    try {
      expectation = JSON.parse(
        readFileSync(join(EXPECTED, `${basename(file, `.${extension}`)}.json`), "utf8"),
      ) as Expectation;
    } catch {
      console.log("\n  (geen verwachting vastgelegd, alleen gerapporteerd)");
    }

    if (expectation) {
      const problems: string[] = [];

      for (const [key, want] of Object.entries(expectation.fields ?? {})) {
        const got = found.get(key);
        if (got === undefined) problems.push(`${key}: niet gevonden, verwacht ${JSON.stringify(want)}`);
        else if (String(got) !== String(want)) {
          problems.push(`${key}: ${JSON.stringify(got)}, verwacht ${JSON.stringify(want)}`);
        }
      }

      for (const key of expectation.forbidden ?? []) {
        if (found.has(key)) {
          problems.push(`${key}: VERZONNEN, staat niet in de bron maar is wel gevuld`);
        }
      }

      if (expectation.injuries) {
        const entries = await getInjuryEntries(intakeId);
        for (const want of expectation.injuries) {
          const match = entries.filter((entry) =>
            entry.bodyRegion.toLowerCase().includes(want.bodyRegion.toLowerCase()),
          );
          if (match.length === 0) {
            problems.push(`blessure ${want.bodyRegion}: niet gevonden`);
            continue;
          }
          if (want.onsetDate !== undefined) {
            const dates = match.map((entry) => entry.onsetDate);
            if (!dates.includes(want.onsetDate)) {
              problems.push(
                `blessure ${want.bodyRegion}: startdatum ${JSON.stringify(dates)}, verwacht ${JSON.stringify(want.onsetDate)}`,
              );
            }
          }
        }
      }

      if (
        expectation.minVerifiedQuotes !== undefined &&
        result.quotesVerified < expectation.minVerifiedQuotes
      ) {
        problems.push(
          `slechts ${result.quotesVerified} geverifieerde citaten, minimaal ${expectation.minVerifiedQuotes} verwacht`,
        );
      }

      if (problems.length === 0) {
        console.log("\n  ✓ voldoet aan de verwachting");
      } else {
        failures++;
        console.log("\n  ✗ afwijkingen:");
        for (const problem of problems) console.log(`      ${problem}`);
      }
    }

    // Opruimen: de evalrun laat geen dossiers achter.
    const { data: intake } = await appDb()
      .from("intakes")
      .select("athlete_id")
      .eq("id", intakeId)
      .single();
    const removed = await storage().from(DOCUMENTS_BUCKET).remove([path]);
    if (removed.error) {
      throw new Error(`storage opruimen mislukt: ${removed.error.message}`);
    }
    // Via het verwijderpad: een gewone delete op public.athletes wordt geweigerd
    // door de append-only-trigger op de voorstellen.
    if (intake) await purgeAthleteRows({ athleteId: intake.athlete_id as string });
  }

  console.log(`\n${"─".repeat(72)}`);
  if (failures > 0) {
    console.log(`${failures} fixture(s) wijken af van de verwachting`);
    process.exit(1);
  }
  console.log("alle fixtures voldoen aan de verwachting");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
