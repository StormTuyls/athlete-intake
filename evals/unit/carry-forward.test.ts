import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadEnv } from "../../scripts/env";

loadEnv();

import { appDb } from "../../lib/supabase/service";
import { newToken } from "../../lib/intake/session";
import { addProposals, syncDossier } from "../../lib/db/dossier";
import { upsertDocument } from "../../lib/db/medical";
import { carriedValues } from "../../lib/intake/carryForward";
import { purgeAthleteRows } from "../../lib/purge/db";

/**
 * Wat een terugkerende atleet wel en niet opnieuw te zien krijgt.
 *
 * De regel zelf zit in de prompt en is daar niet hard te testen. Het deel dat
 * stil fout kan gaan is de query: welke intake is "de vorige", welke velden
 * mogen mee, en wat blijft eruit. Precies dat staat hier vast.
 */

const db = appDb();

const { data: athlete, error: athleteError } = await db
  .from("athletes")
  .insert({ locale: "nl", retention_basis: "carry-forward-test" })
  .select("id")
  .single();
if (athleteError) throw new Error(athleteError.message);
const athleteId = athlete!.id as string;

async function makeIntake(submittedAt: string | null): Promise<string> {
  const { hash } = newToken();
  const { data, error } = await db
    .from("intakes")
    .insert({
      athlete_id: athleteId,
      locale: "nl",
      access_token_hash: hash,
      consent_granted_at: new Date().toISOString(),
      ...(submittedAt ? { status: "submitted", submitted_at: submittedAt } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}

const older = await makeIntake("2026-03-01T10:00:00Z");
const newer = await makeIntake("2026-06-01T10:00:00Z");
const current = await makeIntake(null);

const athleteSaid = (fieldKey: string, value: unknown) => ({
  fieldKey,
  value,
  proposedBy: "athlete" as const,
  sourceDocumentId: null,
  sourcePage: null,
  sourceQuote: null,
  quoteVerified: false,
});

await addProposals(older, [athleteSaid("biometrics.height_cm", 178)]);

await addProposals(newer, [
  athleteSaid("biometrics.height_cm", 182),
  // Gewicht is met opzet geen carry-forward-veld: het verandert, en het is
  // klinisch juist op het moment van de intake relevant.
  athleteSaid("biometrics.body_mass_kg", 76.5),
]);

// Twee documenten die het over de geboortedatum niet eens zijn. Zo'n veld mag
// niet meegenomen worden: de vorige keer kwam er geen uitsluitsel, en het
// voorleggen van een van de twee is precies het stille kiezen dat dit systeem
// nergens doet.
// Een modelvoorstel zonder herkomst weigert de databank
// (field_proposals_model_needs_provenance), en terecht: dat is de garantie dat
// een waarde uit een document altijd naar dat document wijst. Dus een echt
// documentrij erbij.
const documentId = await upsertDocument({
  intakeId: newer,
  storagePath: `${newer}/carry-forward-test.pdf`,
  originalFilename: "carry-forward-test.pdf",
  mimeType: "application/pdf",
  byteSize: 1,
  // De kolom heeft een check op 64 hextekens: een sha256 is een sha256.
  sha256: createHash("sha256").update(`carry-forward-${newer}`).digest("hex"),
  kind: "pdf_text",
  pageCount: 1,
});

await addProposals(newer, [
  {
    ...athleteSaid("biometrics.dominant_side", "right"),
    proposedBy: "model",
    sourceDocumentId: documentId,
    sourcePage: 1,
    sourceQuote: "rechts dominant",
    modelId: "test",
  },
  {
    ...athleteSaid("biometrics.dominant_side", "left"),
    proposedBy: "model",
    sourceDocumentId: documentId,
    sourcePage: 1,
    sourceQuote: "links dominant",
    modelId: "test",
  },
]);

// De lopende intake heeft zelf al een antwoord: dat hoeft niet bevestigd te
// worden en mag dus niet als "bekend van vorige keer" terugkomen.
// Leeg: alles wat deze intake zelf al weet valt buiten de lijst, en dat wordt
// verderop apart getoetst.

for (const id of [older, newer, current]) await syncDossier(id, "nl");

const carried = await carriedValues({ athleteId, intakeId: current, locale: "nl" });
const byKey = new Map(carried.map((item) => [item.fieldKey, item]));

assert.equal(
  byKey.has("biometrics.body_mass_kg"),
  false,
  "gewicht is geen carry-forward-veld en mag niet voorgelegd worden",
);
assert.equal(
  byKey.has("biometrics.dominant_side"),
  false,
  "een tegenstrijdig veld uit de vorige intake mag niet voorgelegd worden",
);
assert.equal(
  byKey.get("biometrics.height_cm")?.value,
  182,
  "bij twee eerdere intakes wint de meest recente",
);

// Identiteit draagt sinds 20260915100000_identity_from_profile niet meer over.
// Die velden komen uit public.athletes en gelden voor elke intake, dus er valt
// niets ter bevestiging voor te leggen. Stond de vlag er nog op, dan opende het
// gesprek alsnog met "ik heb nog naam, geboortedatum, sport, club - klopt dat?",
// precies het administratieve rondje dat eruit moest.
for (const key of [
  "identity.full_name",
  "identity.date_of_birth",
  "identity.sport",
  "identity.club",
  "identity.federation",
]) {
  assert.equal(
    byKey.has(key),
    false,
    `${key} komt uit het profiel en hoort niet meer ter bevestiging voorgelegd te worden`,
  );
}

// Vanuit de oudste intake gezien bestaat er geen eerdere: dan is er niets te
// bevestigen en valt de hele opening weg.
const first = await carriedValues({ athleteId, intakeId: older, locale: "nl" });
assert.equal(
  first.some((item) => item.fieldKey === "biometrics.height_cm" && item.value === 178),
  false,
  "een intake legt zijn eigen waarden niet aan zichzelf voor",
);

assert.equal(
  byKey.get("biometrics.height_cm")?.label,
  "Lengte (cm)",
  "het label komt in de taal van de intake mee, want het gaat het gesprek in",
);

// Wat de lopende intake zelf al weet komt hier WEL uit: carriedValues sluit
// alleen de eigen rijen van deze intake uit als BRON. Het wegfilteren van
// velden die deze keer al beantwoord zijn gebeurt in app/api/intake/chat, tegen
// de gatenlijst. Dat onderscheid stond hier eerder verkeerd beschreven.

// Opruimen via het verwijderpad, want een gewone delete op public.athletes
// bestaat niet meer: de statement-trigger op medical.field_proposals weigert
// hem, en de grant is ingetrokken. Dat is precies de bedoeling, en het maakt
// deze teardown ook een kleine test van dat pad.
const purged = await purgeAthleteRows({ athleteId });
assert.equal(purged.counts.athletes, 1, "de testatleet moet echt verwijderd zijn");
assert.equal(
  purged.counts.intakes,
  3,
  "alle drie de intakes van de testatleet horen mee te gaan",
);

console.log("carry-forward: de vorige intake, zonder gewicht en zonder tegenspraak");
process.exit(0);
