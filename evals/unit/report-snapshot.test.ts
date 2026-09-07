import assert from "node:assert/strict";
import { contentHashOf, type ReportSnapshot } from "../../lib/report/snapshot";

/**
 * De hash beantwoordt precies een vraag: is het dossier veranderd?
 *
 * Daar hangt de hele belofte aan. Telt `generatedAt` mee, dan is elke snapshot
 * uniek en mint elke export een nieuwe versie met een nieuwe modelcall. Telt
 * `summary` mee, dan kan de hash pas na die modelcall berekend worden en is
 * hergebruik onmogelijk. Beide fouten zijn onzichtbaar in gebruik: het werkt,
 * het kost alleen geld en de belofte is stil weg.
 */

function snapshot(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return {
    schemaVersion: 1,
    contentHash: "",
    reason: "submit",
    generatedAt: "2026-09-07T10:00:00.000Z",
    intake: {
      id: "3f9c1a2b-0000-4000-8000-000000000000",
      status: "submitted",
      locale: "en",
      startedAt: "2026-09-07T09:00:00.000Z",
      submittedAt: "2026-09-07T10:00:00.000Z",
    },
    athlete: {
      fullName: "Sofie Dujardin",
      email: "sofie@example.com",
      phone: null,
      club: "AC Herentals",
      federation: "Atletiek Vlaanderen",
    },
    consent: {
      version: "2026-09-02b",
      grantedAt: "2026-09-07T09:00:00.000Z",
      withdrawnAt: null,
      sharingAllowed: true,
    },
    fields: [
      {
        key: "biometrics.height_cm",
        section: "biometrics",
        sortOrder: 1,
        labelNl: "Lengte (cm)",
        labelEn: "Height (cm)",
        dataType: "number",
        required: true,
        isMedical: true,
        value: 182,
        displayValue: "182",
        status: "extracted",
        confidence: "high",
        proposedBy: "model",
        provenance: {
          proposalId: 1,
          proposedBy: "model",
          modelId: "claude-opus-5",
          documentId: "doc-1",
          documentFilename: "verslag.pdf",
          page: 1,
          quote: "lengte 182 cm",
          quoteVerified: true,
        },
        conflicts: [],
      },
    ],
    injuries: [],
    documents: [],
    completeness: {
      total: 41,
      filled: 1,
      requiredTotal: 15,
      requiredFilled: 1,
      conflicts: 0,
      readyToSubmit: false,
    },
    openItems: [],
    summary: null,
    ...overrides,
  };
}

const base = snapshot();
const baseHash = contentHashOf(base);

// 1. Twee keer hetzelfde dossier geeft dezelfde hash.
assert.equal(contentHashOf(snapshot()), baseHash, "gelijke inhoud moet gelijke hash geven");

// 2. Een ander tijdstip verandert de hash NIET. Anders mint elke export een versie.
assert.equal(
  contentHashOf(snapshot({ generatedAt: "2026-12-25T23:59:59.000Z" })),
  baseHash,
  "generatedAt mag niet meetellen",
);

// 3. Een andere aanleiding verandert de hash niet: dezelfde inhoud blijft dezelfde versie.
assert.equal(contentHashOf(snapshot({ reason: "export" })), baseHash);

// 4. De samenvatting telt niet mee. Hij is afgeleid van de inhoud, en zou hij
//    meetellen dan kan de hash pas na de modelcall berekend worden.
assert.equal(
  contentHashOf(
    snapshot({
      summary: {
        kind: "clinical",
        text: "Een hele andere tekst.",
        modelId: "claude-opus-5",
        generatedAt: "2026-09-07T10:05:00.000Z",
      },
    }),
  ),
  baseHash,
  "summary mag niet meetellen",
);

// 5. Een echte wijziging in het dossier verandert de hash wel.
const changed = snapshot();
changed.fields[0].value = 183;
changed.fields[0].displayValue = "183";
assert.notEqual(contentHashOf(changed), baseHash, "een gewijzigde waarde moet een nieuwe hash geven");

// 6. Ook een intrekking van de toestemming, want dat bepaalt of de samenvatting
//    klinisch of zakelijk mag zijn.
assert.notEqual(
  contentHashOf(snapshot({ consent: { ...base.consent, sharingAllowed: false } })),
  baseHash,
  "een gewijzigde toestemming moet een nieuwe versie forceren",
);

// 7. Sleutelvolgorde mag niet uitmaken: JSON.stringify bewaart invoegorde, dus
//    zonder canonieke sortering geeft hetzelfde dossier een andere hash zodra
//    iemand de volgorde van een object verandert.
const reordered = snapshot({
  athlete: {
    federation: "Atletiek Vlaanderen",
    club: "AC Herentals",
    phone: null,
    email: "sofie@example.com",
    fullName: "Sofie Dujardin",
  },
});
assert.equal(contentHashOf(reordered), baseHash, "sleutelvolgorde mag de hash niet veranderen");

console.log("report-snapshot: hash volgt de inhoud, niet het tijdstip of de tekst");
