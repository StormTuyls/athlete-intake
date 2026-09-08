import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadEnv } from "../../scripts/env";

loadEnv();

import { appDb } from "../../lib/supabase/service";
import { newToken } from "../../lib/intake/session";
import { addProposals, syncDossier } from "../../lib/db/dossier";
import { upsertDocument } from "../../lib/db/medical";
import { carriedValues } from "../../lib/intake/carryForward";

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

await addProposals(older, [
  athleteSaid("identity.club", "AC Oud"),
  athleteSaid("identity.sport", "football"),
]);

await addProposals(newer, [
  athleteSaid("identity.club", "AC Nieuw"),
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
    ...athleteSaid("identity.date_of_birth", "1992-03-14"),
    proposedBy: "model",
    sourceDocumentId: documentId,
    sourcePage: 1,
    sourceQuote: "geboren 14-03-1992",
    modelId: "test",
  },
  {
    ...athleteSaid("identity.date_of_birth", "1992-03-04"),
    proposedBy: "model",
    sourceDocumentId: documentId,
    sourcePage: 1,
    sourceQuote: "geboren 04-03-1992",
    modelId: "test",
  },
]);

// De lopende intake heeft zelf al een antwoord: dat hoeft niet bevestigd te
// worden en mag dus niet als "bekend van vorige keer" terugkomen.
await addProposals(current, [athleteSaid("identity.coach_name", "Sofie")]);

for (const id of [older, newer, current]) await syncDossier(id, "nl");

const carried = await carriedValues({ athleteId, intakeId: current, locale: "nl" });
const byKey = new Map(carried.map((item) => [item.fieldKey, item]));

assert.equal(
  byKey.get("identity.club")?.value,
  "AC Nieuw",
  "bij twee eerdere intakes wint de meest recente",
);
assert.equal(
  byKey.get("identity.sport")?.value,
  "football",
  "een veld dat alleen in de oudste intake staat gaat wel mee",
);
assert.equal(byKey.get("biometrics.height_cm")?.value, 182);

assert.equal(
  byKey.has("biometrics.body_mass_kg"),
  false,
  "gewicht is geen carry-forward-veld en mag niet voorgelegd worden",
);
assert.equal(
  byKey.has("identity.date_of_birth"),
  false,
  "een tegenstrijdig veld uit de vorige intake mag niet voorgelegd worden",
);
assert.equal(
  byKey.has("identity.coach_name"),
  false,
  "wat de atleet in DEZE intake al zei komt niet uit een eerdere terug",
);

// Vanuit de oudste intake gezien bestaat er geen eerdere: dan is er niets te
// bevestigen en valt de hele opening weg.
const first = await carriedValues({ athleteId, intakeId: older, locale: "nl" });
assert.equal(
  first.some((item) => item.fieldKey === "identity.club" && item.value === "AC Oud"),
  false,
  "een intake legt zijn eigen waarden niet aan zichzelf voor",
);

assert.equal(
  byKey.get("identity.club")?.label,
  "Club",
  "het label komt in de taal van de intake mee, want het gaat het gesprek in",
);

// Opruimen. De cascade struikelt vandaag over de append-only-trigger op
// medical.field_proposals; dat is precies wat stap B1 van het plan repareert.
// Tot dan blijft de fout hier zichtbaar in plaats van weggeslikt, zoals de
// bestaande teardowns doen.
const { error: cleanup } = await db.from("athletes").delete().eq("id", athleteId);
if (cleanup) {
  console.warn(
    `let op: opruimen mislukt (${cleanup.message}). Testatleet ${athleteId} blijft staan; zie B1 in docs/plan.md.`,
  );
}

console.log("carry-forward: de vorige intake, zonder gewicht en zonder tegenspraak");
process.exit(0);
