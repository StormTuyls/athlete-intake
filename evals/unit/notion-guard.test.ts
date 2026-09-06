import assert from "node:assert/strict";
import {
  buildAthleteBody,
  buildAthleteProperties,
  MedicalLeakError,
} from "../../lib/notion/sync";
import type { FieldDefinition } from "../../lib/types";

/**
 * De Notion-koppeling mag geen medische data naar buiten sturen.
 *
 * Drie dingen worden hier bewezen:
 *
 * 1. Medische waarden die wel in het dossier zitten komen niet in de payload,
 *    ook niet als ze in de meegegeven map staan.
 * 2. Raakt een veld uit de synclijst ooit als medisch gemarkeerd, dan weigert de
 *    sync in plaats van te blijven pushen.
 * 3. De payload bevat precies de bedoelde eigenschappen, niet meer.
 */

const MEDICAL_KEYS = [
  "medical.injury_history",
  "medical.current_complaints",
  "medical.surgeries",
  "medical.medication",
  "status.pain_now",
  "status.pain_location",
  "status.training_availability",
  "biometrics.height_cm",
  "biometrics.body_mass_kg",
  "identity.medical_network",
  "status.goals",
  "status.motivation",
];

const SYNCED_KEYS = [
  "identity.full_name",
  "identity.date_of_birth",
  "identity.email",
  "identity.phone",
  "identity.sport",
  "identity.discipline",
  "identity.club",
  "identity.federation",
  "identity.coach_name",
  "training.weekly_volume_hours",
  "training.season_phase",
  "training.seasons_experience",
  "training.strength_training_years",
  "status.target_event",
  "consent.share_with_practitioners",
  "uploads.medical_documents_provided",
  "uploads.test_data_provided",
  "uploads.programme_provided",
  "uploads.video_provided",
];

function definition(key: string, isMedical: boolean): FieldDefinition {
  return {
    key,
    section: key.split(".")[0],
    sortOrder: 1,
    labelNl: key,
    labelEn: key,
    dataType: "text",
    required: false,
    isMedical,
    enumOptions: null,
    questionNl: null,
    questionEn: null,
  };
}

const definitions = [
  ...SYNCED_KEYS.map((key) => definition(key, false)),
  ...MEDICAL_KEYS.map((key) => definition(key, true)),
];

// Een realistische map: alles wat een echte intake oplevert, medisch inbegrepen.
const values = new Map<string, unknown>([
  ["identity.full_name", "Jonas Peeters"],
  ["identity.date_of_birth", "2001-03-14"],
  ["identity.email", "jonas@example.com"],
  ["identity.phone", "0470 12 34 56"],
  ["identity.sport", "sprint"],
  ["identity.discipline", "100m en 200m"],
  ["identity.club", "AC Herentals"],
  ["identity.federation", "Atletiek Vlaanderen"],
  ["identity.coach_name", "Frederik"],
  ["training.weekly_volume_hours", 12],
  ["training.season_phase", "specific_prep"],
  ["status.target_event", "BK volgend jaar zomer"],
  ["consent.share_with_practitioners", true],
  ["uploads.medical_documents_provided", true],
  ["uploads.test_data_provided", true],
  // En nu het medische deel, dat nergens mag opduiken.
  ["medical.injury_history", "Tendinopathie proximale hamstring rechts sinds 2026"],
  ["medical.current_complaints", "Zeurende pijn bij sprints boven 80 procent"],
  ["medical.surgeries", "Arthroscopie linkerknie na meniscuslesie"],
  ["medical.medication", "Ibuprofen bij pijn"],
  ["status.pain_now", true],
  ["status.pain_location", "rechter hamstring proximaal"],
  ["status.training_availability", "modified"],
  ["biometrics.height_cm", 182],
  ["biometrics.body_mass_kg", 76.5],
  ["identity.medical_network", "Dr. Janssens, kinesist Peeters"],
  ["status.goals", "Weer sprinten zonder pijn in mijn hamstring"],
  ["status.motivation", "Na mijn knieoperatie durf ik niet meer voluit"],
]);

const base = {
  values,
  conflicts: 1,
  dossierUrl: "https://example.test/review/abc",
  intakeId: "11111111-1111-1111-1111-111111111111",
  submittedAt: "2026-09-02T10:00:00.000Z",
  status: "Intake ontvangen",
  definitions,
};

const FORBIDDEN_CONTENT = [
  "tendinopathie",
  "hamstring",
  "meniscus",
  "arthroscopie",
  "ibuprofen",
  "zeurende",
  "pijn",
  "dr. janssens",
  "kinesist",
  "knieoperatie",
  "182",
  "76.5",
];

// ── 1. Zonder toestemming gaat er niets medisch mee ───────────────────────────

const withoutConsent = buildAthleteProperties({
  ...base,
  sharingAllowed: false,
  medicalValues: new Map(),
});

const plainPayload = (
  JSON.stringify(withoutConsent) +
  JSON.stringify(
    buildAthleteBody({
      summary: "Sprinter bij AC Herentals.",
      clinical: false,
      dossierUrl: base.dossierUrl,
    }),
  )
).toLowerCase();

const leaked = FORBIDDEN_CONTENT.filter((term) => plainPayload.includes(term));
assert.deepEqual(
  leaked,
  [],
  `zonder toestemming zit deze medische inhoud toch in de payload: ${leaked.join(", ")}`,
);

assert.deepEqual(
  withoutConsent.Trainbaarheid,
  { select: null },
  "trainbaarheid is medisch en mag zonder toestemming niet gevuld worden",
);

// De niet-medische inhoud moet er wel in staan, anders bewijst de test niets.
for (const term of ["jonas peeters", "ac herentals", "100m en 200m", "bk volgend jaar"]) {
  assert.ok(plainPayload.includes(term), `${term} hoort wel mee te gaan`);
}

// ── 2. Met toestemming precies één medisch veld, en niet meer ─────────────────

const withConsent = buildAthleteProperties({
  ...base,
  sharingAllowed: true,
  medicalValues: new Map([["status.training_availability", "modified"]]),
});

assert.deepEqual(
  withConsent.Trainbaarheid,
  { select: { name: "Aangepast trainbaar" } },
  "met toestemming hoort trainbaarheid gevuld te zijn",
);

const consentedPayload = JSON.stringify(withConsent).toLowerCase();
const stillForbidden = FORBIDDEN_CONTENT.filter((term) => consentedPayload.includes(term));
assert.deepEqual(
  stillForbidden,
  [],
  `ook met toestemming horen klachten en diagnoses niet in de KOLOMMEN: ${stillForbidden.join(", ")}. ` +
    "Die staan in de samenvatting op de pagina, niet in een veld dat je kunt sorteren.",
);

// ── 3. Een medisch gemarkeerd veld in de synclijst blokkeert de sync ──────────

assert.throws(
  () =>
    buildAthleteProperties({
      ...base,
      definitions: definitions.map((d) =>
        d.key === "identity.email" ? definition(d.key, true) : d,
      ),
      sharingAllowed: false,
      medicalValues: new Map(),
    }),
  MedicalLeakError,
  "een medisch gemarkeerd veld in de synclijst moet de sync blokkeren",
);

// ── 4. Precies de bedoelde kolommen, kort gehouden voor de kinesist ───────────

assert.deepEqual(Object.keys(withoutConsent).sort(), [
  "Aandacht nodig",
  "Club",
  "Discipline",
  "Doelwedstrijd",
  "Dossier",
  "E-mail",
  "Geboortedatum",
  "Intake ID",
  "Intake ontvangen",
  "Naam",
  "Sport",
  "Status",
  "Telefoon",
  "Trainbaarheid",
  "Trainingsvolume per week",
]);

assert.deepEqual(
  withoutConsent["Aandacht nodig"],
  { checkbox: true },
  "1 conflict moet de vlag zetten",
);

console.log(
  `notion-guard: ${FORBIDDEN_CONTENT.length} medische termen geweerd, ` +
    `${Object.keys(withoutConsent).length} kolommen, toestemmingspoort werkt beide kanten op`,
);
