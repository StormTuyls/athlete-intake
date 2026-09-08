import { loadEnv } from "./env";

loadEnv();

import { createHash, randomUUID } from "node:crypto";
import { appDb, storage, DOCUMENTS_BUCKET } from "../lib/supabase/service";
import { newToken } from "../lib/intake/session";
import { addProposals, syncDossier } from "../lib/db/dossier";
import { addInjuries, savePages, upsertDocument } from "../lib/db/medical";
import { verifyQuote } from "../lib/verify/quote";
import { purgeAthleteRows } from "../lib/purge/db";
import { purgeStorage } from "../lib/purge/storage";
import { freezeReport } from "../lib/report/freeze";

/**
 * Demodata voor ontwikkelen en demonstreren.
 *
 * Niet te verwarren met supabase/seed.sql: dat is de taxonomie en die hoort in
 * elke omgeving. Dit zijn verzonnen atleten, en die horen alleen lokaal.
 *
 * Waarom dit bestaat: na een tijd handmatig testen stond de databank vol
 * dossiers zonder naam, met waarden als "opgegeven tijdens de intake" in het
 * naamveld en een lengte van 12 cm. Dan is het coachscherm niet meer te
 * beoordelen, want alles ziet er stuk uit terwijl het klopt.
 *
 * De herkomst is echt, niet nagebootst: er komt een documentrij met paginatekst
 * uit de synthetische fixture, en elk citaat gaat door verifyQuote heen. Een
 * veld dat hier `high` is, is dat op dezelfde grond als in productie. Zonder dat
 * zou de demo geloofwaardiger lijken dan het systeem is.
 *
 * Draaien: npm run seed:demo -- --reset
 */

const RESET = process.argv.includes("--reset");
const BASIS = "demo: verzonnen atleet voor ontwikkelwerk";

/**
 * Deze rem is het hele veiligheidsmechanisme. `--reset` verwijdert ELKE atleet,
 * dus hij mag alleen op een lokale stack draaien. Een productie-URL hoort hier
 * nooit langs te komen, en een vergissing in een omgevingsvariabele mag geen
 * dossiers kosten.
 */
function assertLocal(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const local = url.includes("127.0.0.1") || url.includes("localhost");
  if (!local) {
    throw new Error(
      `weigert te draaien: NEXT_PUBLIC_SUPABASE_URL is ${url || "leeg"} en dat is geen lokale stack`,
    );
  }
}

const KINE_REPORT = `PRAKTIJK VOOR SPORTKINESITHERAPIE
Verslag onderzoek

Patient: {{name}}
Geboortedatum: {{dob}}
Lengte: {{height}} cm
Gewicht: {{mass}} kg
Sport: {{sport}}, club {{club}}, {{federation}}
Dominante zijde: {{side}}

Anamnese
Belastingsafhankelijke pijn ter hoogte van de {{injurySide}} {{injuryRegion}}.
Klachten sinds {{onset}}, ontstaan tijdens een versnelling op training.

Trainingsbelasting: {{hours}} uur per week, momenteel in {{phase}}.

Besluit: {{diagnosis}}. Aangepast trainen mogelijk.
`;

interface DemoAthlete {
  fullName: string;
  email: string;
  phone: string;
  club: string;
  federation: string;
  sport: string;
  discipline: string;
  dob: string;
  height: number;
  mass: number;
  side: "left" | "right";
  hours: number;
  phase: string;
  goals: string;
  injury: { region: string; side: "left" | "right"; diagnosis: string; onset: string };
  /** Draft blijft open, submitted wacht op de coach, approved is afgetekend. */
  state: "draft" | "submitted" | "approved";
  /** Twee documenten die het over het gewicht oneens zijn. */
  conflicted?: boolean;
  /** Een tweede, oudere intake, zodat carry-forward zichtbaar is. */
  returning?: boolean;
}

const ATHLETES: DemoAthlete[] = [
  {
    fullName: "Sofie Dujardin",
    email: "sofie.dujardin@example.com",
    phone: "0470 11 22 33",
    club: "AC Herentals",
    federation: "Atletiek Vlaanderen",
    sport: "sprint",
    discipline: "100m en 200m",
    dob: "1998-05-12",
    height: 172,
    mass: 61.5,
    side: "right",
    hours: 14,
    phase: "specifieke voorbereiding",
    goals: "Het BK volgend jaar zomer, en een persoonlijk record op de 200m.",
    injury: {
      region: "hamstring",
      side: "right",
      diagnosis: "tendinopathie proximale hamstring rechts",
      onset: "2026-08-12",
    },
    state: "submitted",
    conflicted: true,
    returning: true,
  },
  {
    fullName: "Jonas Peeters",
    email: "jonas.peeters@example.com",
    phone: "0470 12 34 56",
    club: "AC Herentals",
    federation: "Atletiek Vlaanderen",
    sport: "sprint",
    discipline: "100m",
    dob: "2001-03-14",
    height: 182,
    mass: 76.5,
    side: "right",
    hours: 12,
    phase: "specifieke voorbereiding",
    goals: "Kwalificatie voor het BK, en gezond het seizoen doorkomen.",
    injury: {
      region: "knie",
      side: "left",
      diagnosis: "status na meniscuslesie links",
      onset: "2023-04-02",
    },
    state: "approved",
  },
  {
    fullName: "Marieke Vandenbroucke",
    email: "marieke.v@example.com",
    phone: "0489 55 66 77",
    club: "KAA Gent Atletiek",
    federation: "Atletiek Vlaanderen",
    sport: "rowing",
    discipline: "skiff",
    dob: "1995-11-02",
    height: 178,
    mass: 71,
    side: "left",
    hours: 18,
    phase: "basisuithouding",
    goals: "Selectie voor het nationale team en een sterkere rugketen.",
    injury: {
      region: "onderrug",
      side: "left",
      diagnosis: "lumbale overbelasting",
      onset: "2026-06-30",
    },
    state: "submitted",
  },
  {
    fullName: "Bram Coppens",
    email: "bram.coppens@example.com",
    phone: "0475 98 76 54",
    club: "Excelsior Brugge",
    federation: "Atletiek Vlaanderen",
    sport: "hurdles",
    discipline: "110m horden",
    dob: "2003-07-21",
    height: 188,
    mass: 82,
    side: "right",
    hours: 10,
    phase: "algemene voorbereiding",
    goals: "Techniek over de horde verbeteren zonder terugval van de adductoren.",
    injury: {
      region: "adductoren",
      side: "right",
      diagnosis: "adductorenklachten rechts",
      onset: "2026-07-15",
    },
    state: "draft",
  },
  {
    fullName: "Lotte Verhoeven",
    email: "lotte.verhoeven@example.com",
    phone: "0468 33 44 55",
    club: "Sprint Leuven",
    federation: "Atletiek Vlaanderen",
    sport: "speed_skating",
    discipline: "1500m",
    dob: "2000-01-30",
    height: 169,
    mass: 63,
    side: "right",
    hours: 16,
    phase: "wedstrijdperiode",
    goals: "Een medaille op het BK allround.",
    injury: {
      region: "enkel",
      side: "left",
      diagnosis: "status na enkeldistorsie links",
      onset: "2025-12-18",
    },
    state: "draft",
  },
];

async function coachId(): Promise<string | null> {
  const { data } = await appDb()
    .from("profiles")
    .select("id")
    .in("role", ["coach", "admin"])
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function reset(): Promise<void> {
  const { data: athletes, error } = await appDb().from("athletes").select("id");
  if (error) throw new Error(`atleten opvragen mislukt: ${error.message}`);
  if (!athletes || athletes.length === 0) {
    console.log("niets op te ruimen");
    return;
  }

  let rows = 0;
  let files = 0;

  for (const { id } of athletes) {
    const purged = await purgeAthleteRows({ athleteId: id as string });
    const cleaned = await purgeStorage({
      intakeIds: purged.manifest.intake_ids,
      knownPaths: purged.manifest.storage_paths,
    });
    rows += Object.values(purged.counts).reduce((sum, n) => sum + n, 0);
    files += cleaned.removed;
  }

  console.log(
    `opgeruimd: ${athletes.length} atleten, ${rows} rijen, ${files} bestanden`,
  );
}

/** Eén intake met dossier, documenten en herkomst. */
async function makeIntake(
  athlete: DemoAthlete,
  athleteId: string,
  options: { state: DemoAthlete["state"]; monthsAgo: number; withDocument: boolean },
): Promise<string> {
  const started = new Date();
  started.setMonth(started.getMonth() - options.monthsAgo);
  const startedAt = started.toISOString();

  const { hash } = newToken();
  const { data: intake, error } = await appDb()
    .from("intakes")
    .insert({
      athlete_id: athleteId,
      locale: "nl",
      access_token_hash: hash,
      started_at: startedAt,
      consent_granted_at: startedAt,
      ...(options.state === "draft"
        ? {}
        : { status: "submitted", submitted_at: startedAt }),
    })
    .select("id")
    .single();

  if (error) throw new Error(`intake maken mislukt: ${error.message}`);
  const intakeId = intake!.id as string;

  const said = (fieldKey: string, value: unknown) => ({
    fieldKey,
    value,
    proposedBy: "athlete" as const,
    sourceDocumentId: null,
    sourcePage: null,
    sourceQuote: null,
    quoteVerified: false,
  });

  // Wat de atleet in het gesprek zelf zei.
  await addProposals(intakeId, [
    said("identity.full_name", athlete.fullName),
    said("identity.date_of_birth", athlete.dob),
    said("identity.email", athlete.email),
    said("identity.phone", athlete.phone),
    said("identity.sport", athlete.sport),
    said("identity.discipline", athlete.discipline),
    said("identity.club", athlete.club),
    said("identity.federation", athlete.federation),
    said("consent.medical_processing", true),
    said("consent.retention_acknowledged", true),
    said(
      "consent.share_with_practitioners",
      options.state === "draft" ? false : true,
    ),
    said("status.goals", athlete.goals),
    said(
      "status.training_availability",
      options.state === "draft" ? "full" : "modified",
    ),
    said("status.pain_now", options.state !== "draft"),
  ]);

  if (options.withDocument) {
    // Een echt document met echte paginatekst, zodat de citaten door
    // verifyQuote heen komen en de betrouwbaarheid op dezelfde grond staat als
    // in productie.
    const text = KINE_REPORT.replace("{{name}}", athlete.fullName)
      .replace("{{dob}}", athlete.dob.split("-").reverse().join("-"))
      .replace("{{height}}", String(athlete.height))
      .replace("{{mass}}", String(athlete.mass).replace(".", ","))
      .replace("{{sport}}", `${athlete.sport} (${athlete.discipline})`)
      .replace("{{club}}", athlete.club)
      .replace("{{federation}}", athlete.federation)
      .replace("{{side}}", athlete.side === "right" ? "rechts" : "links")
      .replace("{{injurySide}}", athlete.injury.side === "right" ? "rechter" : "linker")
      .replace("{{injuryRegion}}", athlete.injury.region)
      .replace("{{onset}}", athlete.injury.onset.split("-").reverse().join("-"))
      .replace("{{hours}}", String(athlete.hours))
      .replace("{{phase}}", athlete.phase)
      .replace("{{diagnosis}}", athlete.injury.diagnosis);

    const path = `${intakeId}/${randomUUID()}.txt`;
    const upload = await storage()
      .from(DOCUMENTS_BUCKET)
      .upload(path, Buffer.from(text, "utf8"), { contentType: "text/plain" });
    if (upload.error) throw new Error(`upload mislukt: ${upload.error.message}`);

    const documentId = await upsertDocument({
      intakeId,
      storagePath: path,
      originalFilename: "kine-verslag.txt",
      mimeType: "text/plain",
      byteSize: Buffer.byteLength(text),
      sha256: createHash("sha256").update(text).digest("hex"),
      kind: "pdf_text",
      pageCount: 1,
    });

    const pages = [{ pageNumber: 1, text }];
    await savePages(documentId, pages);

    const fromDocument = (fieldKey: string, value: unknown, quote: string) => {
      const check = verifyQuote(quote, pages);
      return {
        fieldKey,
        value,
        proposedBy: "model" as const,
        sourceDocumentId: documentId,
        sourcePage: check.pageNumber ?? 1,
        sourceQuote: quote,
        quoteVerified: check.verified,
        modelId: "claude-opus-5",
      };
    };

    await addProposals(intakeId, [
      fromDocument("biometrics.height_cm", athlete.height, `Lengte: ${athlete.height} cm`),
      fromDocument(
        "biometrics.body_mass_kg",
        athlete.mass,
        `Gewicht: ${String(athlete.mass).replace(".", ",")} kg`,
      ),
      fromDocument(
        "biometrics.dominant_side",
        athlete.side,
        `Dominante zijde: ${athlete.side === "right" ? "rechts" : "links"}`,
      ),
      fromDocument(
        "training.weekly_volume_hours",
        athlete.hours,
        `Trainingsbelasting: ${athlete.hours} uur per week`,
      ),
      fromDocument(
        "medical.injury_history",
        `Belastingsafhankelijke pijn ${athlete.injury.side === "right" ? "rechter" : "linker"} ${athlete.injury.region}, klachten sinds ${athlete.injury.onset}.`,
        `Klachten sinds ${athlete.injury.onset.split("-").reverse().join("-")}`,
      ),
      fromDocument(
        "status.pain_location",
        `${athlete.injury.side === "right" ? "Rechter" : "Linker"} ${athlete.injury.region}`,
        `pijn ter hoogte van de ${athlete.injury.side === "right" ? "rechter" : "linker"} ${athlete.injury.region}`,
      ),
    ]);

    const onsetQuote = `Klachten sinds ${athlete.injury.onset.split("-").reverse().join("-")}`;
    await addInjuries([
      {
        athleteId,
        intakeId,
        bodyRegion: athlete.injury.region,
        side: athlete.injury.side,
        diagnosis: athlete.injury.diagnosis,
        onsetDate: athlete.injury.onset,
        endDate: null,
        sourceDocumentId: documentId,
        sourcePage: 1,
        sourceQuote: onsetQuote,
        quoteVerified: verifyQuote(onsetQuote, pages).verified,
      },
    ]);

    // Een tweede document dat het over het gewicht niet eens is: zo staat er
    // een echte tegenstrijdigheid in de demo, met herkomst aan beide kanten.
    if (athlete.conflicted) {
      const rivalMass = athlete.mass + 1.5;
      const chat = `[12/08/2026, 19:04] ${athlete.fullName}: net gewogen, ${String(rivalMass).replace(".", ",")} kg\n[12/08/2026, 19:05] Coach: ok, dan passen we het schema aan`;
      const chatPath = `${intakeId}/${randomUUID()}.txt`;
      const chatUpload = await storage()
        .from(DOCUMENTS_BUCKET)
        .upload(chatPath, Buffer.from(chat, "utf8"), { contentType: "text/plain" });
      if (chatUpload.error) throw new Error(chatUpload.error.message);

      const chatDocument = await upsertDocument({
        intakeId,
        storagePath: chatPath,
        originalFilename: "whatsapp-export.txt",
        mimeType: "text/plain",
        byteSize: Buffer.byteLength(chat),
        sha256: createHash("sha256").update(chat).digest("hex"),
        kind: "whatsapp_export",
        pageCount: 1,
      });
      const chatPages = [{ pageNumber: 1, text: chat }];
      await savePages(chatDocument, chatPages);

      const quote = `net gewogen, ${String(rivalMass).replace(".", ",")} kg`;
      await addProposals(intakeId, [
        {
          fieldKey: "biometrics.body_mass_kg",
          value: rivalMass,
          proposedBy: "model",
          sourceDocumentId: chatDocument,
          sourcePage: 1,
          sourceQuote: quote,
          quoteVerified: verifyQuote(quote, chatPages).verified,
          modelId: "claude-opus-5",
        },
      ]);
    }
  }

  await syncDossier(intakeId, "nl");
  return intakeId;
}

async function main(): Promise<void> {
  assertLocal();

  if (RESET) await reset();
  else console.log("zonder --reset: bestaande atleten blijven staan");

  const coach = await coachId();
  if (!coach) {
    console.log(
      "let op: geen coachaccount gevonden, dus niets wordt goedgekeurd. Maak er een met npm run coach:create",
    );
  }

  for (const athlete of ATHLETES) {
    const { data: row, error } = await appDb()
      .from("athletes")
      .insert({
        full_name: athlete.fullName,
        email: athlete.email,
        phone: athlete.phone,
        club: athlete.club,
        federation: athlete.federation,
        locale: "nl",
        retention_mode: "indefinite",
        retention_basis: BASIS,
      })
      .select("id")
      .single();

    if (error) throw new Error(`atleet maken mislukt: ${error.message}`);
    const athleteId = row!.id as string;

    // Toestemming op accountniveau, want daar hangt de intake aan.
    const { error: consentError } = await appDb().from("consents").insert({
      athlete_id: athleteId,
      intake_id: null,
      consent_version: "2026-09-07",
      purposes: { intake: true, retention: true },
    });
    if (consentError) throw new Error(`toestemming maken mislukt: ${consentError.message}`);

    if (athlete.returning) {
      // Een afgeronde intake van een half jaar terug, zodat het gesprek bij de
      // volgende intake iets heeft om te laten bevestigen.
      await makeIntake(athlete, athleteId, {
        state: "submitted",
        monthsAgo: 6,
        withDocument: false,
      });
    }

    const intakeId = await makeIntake(athlete, athleteId, {
      state: athlete.state,
      monthsAgo: athlete.state === "draft" ? 0 : 1,
      withDocument: true,
    });

    if (athlete.state === "approved" && coach) {
      const now = new Date().toISOString();
      const { error: approveError } = await appDb()
        .from("intakes")
        .update({ status: "approved", approved_at: now, approved_by: coach })
        .eq("id", intakeId);
      if (approveError) throw new Error(`goedkeuren mislukt: ${approveError.message}`);
      // Zelfde volgorde als de route: eerst de status, dan bevriezen, zodat de
      // versie de goedgekeurde stand vastlegt.
      const report = await freezeReport(intakeId, "approval", coach);
      console.log(`  rapportversie ${report.version} vastgelegd`);
    }

    console.log(`${athlete.fullName}: ${athlete.state}${athlete.conflicted ? " (met tegenstrijdigheid)" : ""}${athlete.returning ? " (tweede intake)" : ""}`);
  }

  console.log(`\n${ATHLETES.length} atleten klaar. Coachscherm: /coach`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
