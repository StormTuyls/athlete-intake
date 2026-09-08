import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { loadEnv } from "../scripts/env";

loadEnv();

import { appDb, storage, DOCUMENTS_BUCKET } from "../lib/supabase/service";
import { newToken } from "../lib/intake/session";
import { processDocument } from "../lib/intake/processDocument";
import { syncDossier } from "../lib/db/dossier";
import { purgeAthleteRows } from "../lib/purge/db";

/**
 * De belangrijkste negatieve test.
 *
 * Twee documenten van dezelfde atleet spreken elkaar tegen over zijn gewicht:
 * het kine-verslag zegt 76,5 kg, de WhatsApp-export zegt 77 kg. Het systeem mag
 * daar niet stil een van kiezen. Het moet het veld als 'conflicting' markeren,
 * de rivaliserende waarde bewaren met haar herkomst, en de coach laten beslissen.
 *
 * Even belangrijk: waarden die alleen in notatie verschillen mogen GEEN conflict
 * geven. "AC Herentals" staat in beide documenten en moet gewoon kloppen.
 */

const FIXTURES = "evals/fixtures/synthetic";

async function main() {
  const db = appDb();

  const { data: athlete } = await db
    .from("athletes")
    .insert({ locale: "nl", retention_basis: "conflicttest" })
    .select("id")
    .single();

  const { hash } = newToken();
  const { data: intake } = await db
    .from("intakes")
    .insert({
      athlete_id: athlete!.id,
      locale: "nl",
      access_token_hash: hash,
      consent_granted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  const intakeId = intake!.id as string;
  const paths: string[] = [];

  for (const [file, mimeType] of [
    ["kine-verslag.pdf", "application/pdf"],
    ["whatsapp-export.txt", "text/plain"],
  ] as const) {
    const path = `${intakeId}/${randomUUID()}.${file.split(".").pop()}`;
    paths.push(path);
    const upload = await storage()
      .from(DOCUMENTS_BUCKET)
      .upload(path, readFileSync(`${FIXTURES}/${file}`), { contentType: mimeType });
    if (upload.error) throw new Error(upload.error.message);

    const result = await processDocument({
      intakeId,
      storagePath: path,
      originalFilename: file,
      mimeType,
    });
    console.log(`${file}: ${result.fieldsProposed} velden, ${result.quotesVerified} citaten geverifieerd`);
  }

  const state = await syncDossier(intakeId);

  const mass = state.resolved.get("biometrics.body_mass_kg");
  console.log(
    `\nbiometrics.body_mass_kg -> ${mass?.value} (${mass?.status}, ${mass?.confidence}), ` +
      `${mass?.conflicts.length} rivaal/rivalen`,
  );
  for (const rival of mass?.conflicts ?? []) {
    console.log(`  rivaal: ${rival.value} uit document ${rival.sourceDocumentId?.slice(0, 8)} p${rival.sourcePage}`);
  }

  assert.equal(mass?.status, "conflicting", "tegenstrijdig gewicht moet 'conflicting' zijn");
  assert.equal(mass?.confidence, "low", "een conflict is nooit betrouwbaar");
  assert.ok((mass?.conflicts.length ?? 0) >= 1, "de rivaliserende waarde moet bewaard blijven");
  assert.ok(
    mass?.conflicts.every((rival) => rival.sourceQuote && rival.sourceDocumentId),
    "elke rivaal moet zijn herkomst meenemen, anders kan de coach niet kiezen",
  );

  const club = state.resolved.get("identity.club");
  console.log(`identity.club -> ${club?.value} (${club?.status})`);
  assert.notEqual(
    club?.status,
    "conflicting",
    "dezelfde clubnaam in twee documenten mag geen conflict geven",
  );

  const gap = state.gaps.find((g) => g.fieldKey === "biometrics.body_mass_kg");
  assert.ok(gap, "een conflict hoort in de lijst met wat de assistent nog vraagt");
  assert.equal(gap?.reason, "conflicting");

  // Indienen moet blokkeren zolang het conflict open staat.
  assert.equal(
    state.completeness.readyToSubmit,
    false,
    "met een open conflict mag de intake niet ingediend kunnen worden",
  );
  console.log(`\ncompleteness.readyToSubmit = ${state.completeness.readyToSubmit} (correct: conflict blokkeert)`);

  const removed = await storage().from(DOCUMENTS_BUCKET).remove(paths);
  if (removed.error) throw new Error(`storage opruimen mislukt: ${removed.error.message}`);
  // Via het verwijderpad, en de fout niet negeren: dat deze delete jarenlang
  // stil faalde is waarom niemand wist dat er geen verwijderpad was.
  await purgeAthleteRows({ athleteId: athlete!.id as string });

  console.log("\nconflicttest: geslaagd");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
