import assert from "node:assert/strict";
import { buildAthleteProperties, MedicalLeakError } from "../../lib/notion/sync";
import type { FieldDefinition } from "../../lib/types";

/**
 * De Notion-koppeling mag geen medische data naar buiten sturen.
 *
 * Die garantie moet standhouden als de taxonomie verandert. Markeert iemand
 * later een veld uit de synclijst als medisch, dan hoort de koppeling te
 * weigeren in plaats van te blijven pushen. Dit is die test.
 */

function definition(key: string, isMedical: boolean): FieldDefinition {
  return {
    key,
    section: "identity",
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

const base = {
  values: new Map<string, unknown>([
    ["identity.full_name", "Jonas Peeters"],
    ["identity.email", "jonas@example.com"],
    ["identity.sport", "sprint"],
  ]),
  intakeId: "11111111-1111-1111-1111-111111111111",
  submittedAt: "2026-09-02T10:00:00.000Z",
  completenessRatio: 0.8,
  openFields: 8,
  dossierUrl: "https://example.test/review/1",
  status: "Intake ontvangen",
};

// 1. Normale situatie: niets uit de synclijst is medisch, dus dit hoort te lukken.
const ok = buildAthleteProperties({
  ...base,
  definitions: [
    definition("identity.full_name", false),
    definition("identity.email", false),
    definition("identity.phone", false),
    definition("identity.club", false),
    definition("identity.federation", false),
    definition("identity.sport", false),
  ],
});
assert.ok(ok.Naam, "naam hoort mee te gaan");
assert.equal(
  JSON.stringify(ok).includes("hamstring"),
  false,
  "er hoort geen klinische inhoud in de payload te zitten",
);

// 2. Iemand markeert een veld uit de synclijst als medisch. Nu moet het stoppen.
assert.throws(
  () =>
    buildAthleteProperties({
      ...base,
      definitions: [
        definition("identity.full_name", false),
        definition("identity.email", true), // <- omgezet naar medisch
        definition("identity.phone", false),
        definition("identity.club", false),
        definition("identity.federation", false),
        definition("identity.sport", false),
      ],
    }),
  MedicalLeakError,
  "een medisch gemarkeerd veld in de synclijst moet de sync blokkeren",
);

// 3. De payload bevat alleen de velden die we bedoeld hebben, en twee getallen.
const keys = Object.keys(ok).sort();
assert.deepEqual(keys, [
  "Club",
  "Dossier",
  "E-mail",
  "Federatie",
  "Intake ID",
  "Intake ontvangen",
  "Naam",
  "Openstaande velden",
  "Sport",
  "Status",
  "Telefoon",
  "Volledigheid",
]);

console.log("notion-guard: lek geblokkeerd, payload beperkt tot de commerciele laag");
