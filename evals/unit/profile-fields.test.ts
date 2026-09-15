import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROFILE_FIELDS,
  missingRequiredProfileFields,
} from "../../lib/intake/profileFields";
import { computeGaps } from "../../lib/dossier/completeness";
import type { FieldDefinition, FieldTier, ResolvedField } from "../../lib/types";

/**
 * Identiteit komt uit het profiel, en dat moet op drie plekken kloppen.
 *
 * De vlag `from_profile` zegt DAT een veld uit het profiel komt; de tabel in
 * lib/intake/profileFields.ts zegt WAARVANDAAN. Lopen die twee uiteen, dan is
 * het gevolg stil: het veld verdwijnt uit het gesprek (want de vlag staat aan)
 * en wordt nergens uit het profiel gevuld, dus er komt gewoon niets. Geen
 * foutmelding, alleen een dossier zonder naam.
 *
 * En een derde plek, die makkelijk vergeten wordt: `supabase/seed.sql`. De
 * migraties draaien VOOR de seed, dus de update in de migratie raakt bij een
 * verse databank nul rijen. Staat de lijst niet ook in de seed, dan vraagt het
 * gesprek na een `db reset` de hele identiteitssectie weer uit. Dat merk je
 * niet aan een fout maar aan negen extra beurten.
 *
 * Geen databank: dit leest de seed als tekstbestand, zoals section-labels.
 */

const seed = readFileSync("supabase/seed.sql", "utf8");

// ----------------------------------------- 1. seed en code zeggen hetzelfde

const block = /set from_profile = true\s*where key in \(([^)]*)\)/.exec(seed);
assert.ok(block, "de seed zet from_profile nergens; na een db reset is de vlag overal false");

const seeded = new Set(
  [...block[1].matchAll(/'([a-z_.]+)'/g)].map((match) => match[1]),
);
const mapped = new Set(Object.keys(PROFILE_FIELDS));

assert.deepEqual(
  [...seeded].sort(),
  [...mapped].sort(),
  "de seed en PROFILE_FIELDS noemen niet dezelfde velden; dan verdwijnt er een uit het gesprek zonder uit het profiel te komen",
);

// Elk veld hoort een eigen kolom te hebben. Twee sleutels op dezelfde kolom zou
// betekenen dat een wijziging in het ene veld het andere overschrijft.
const columns = Object.values(PROFILE_FIELDS);
assert.equal(
  new Set(columns).size,
  columns.length,
  "twee velden wijzen naar dezelfde kolom op public.athletes",
);

// De taxonomie moet die kolommen ook echt hebben. De migratie voegt er vier
// toe; de andere vijf stonden er al.
const expectedColumns = [
  "full_name",
  "date_of_birth",
  "email",
  "phone",
  "sport",
  "discipline",
  "club",
  "federation",
  "coach_name",
];
assert.deepEqual(
  [...columns].sort(),
  [...expectedColumns].sort(),
  "de kolomnamen wijken af van wat de migratie op public.athletes zet",
);

// medical.* hoort hier niet in. Het atleetprofiel is bewust vrij van medische
// inhoud, en dat staat letterlijk op dat scherm.
for (const key of mapped) {
  assert.ok(
    key.startsWith("identity."),
    `${key} komt uit het profiel maar zit niet in de identiteitssectie; het profiel hoort administratief te blijven`,
  );
}
assert.ok(
  !mapped.has("identity.medical_network"),
  "identity.medical_network is is_medical en hoort in de intake te blijven, niet in het profiel",
);

// ------------------------------------- 2. carry-forward staat uit voor deze

const carryOff = /set carry_forward = false\s*where from_profile/.test(seed);
assert.ok(
  carryOff,
  "de seed zet carry_forward niet uit voor profielvelden; dan opent het gesprek alsnog met de hele administratieve opsomming",
);
// En die regel moet NA het aanzetten staan, anders zet het carry-forwardblok
// hem er meteen weer op.
assert.ok(
  seed.indexOf("set carry_forward = false") > seed.indexOf("set from_profile = true"),
  "carry_forward wordt uitgezet voordat from_profile bestaat; de volgorde in de seed klopt niet",
);

// ------------------------------------------ 3. nooit een gesprekssvraag

function definition(key: string, extra: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    key,
    section: "identity",
    sortOrder: 1,
    labelNl: key,
    labelEn: key,
    dataType: "text",
    required: false,
    isMedical: false,
    enumOptions: null,
    questionNl: `vraag over ${key}`,
    questionEn: null,
    tier: "standard" as FieldTier,
    askWhen: null,
    fromProfile: false,
    ...extra,
  };
}

const TAXONOMY: FieldDefinition[] = [
  definition("identity.full_name", { fromProfile: true, required: true }),
  definition("identity.sport", { fromProfile: true, required: true }),
  definition("identity.medical_network", { isMedical: true }),
  definition("status.pain_now", { tier: "core", required: true }),
];

const empty = new Map<string, ResolvedField>();
const { gaps, outOfScope } = computeGaps(TAXONOMY, empty, "nl");

assert.ok(
  !gaps.some((gap) => gap.fieldKey.startsWith("identity.full_name")),
  "een profielveld hoort nooit een gesprekssvraag te worden, ook niet als het leeg is",
);
assert.deepEqual(
  outOfScope
    .filter((entry) => entry.reason === "profile")
    .map((entry) => entry.fieldKey)
    .sort(),
  ["identity.full_name", "identity.sport"],
  "een leeg profielveld hoort zichtbaar te blijven voor de behandelaar, met reden 'profile'",
);
assert.ok(
  gaps.some((gap) => gap.fieldKey === "identity.medical_network"),
  "medical_network komt niet uit het profiel en hoort dus gewoon gevraagd te worden",
);

// ------------------------------------------------ 4. de poort voor de intake

assert.deepEqual(
  missingRequiredProfileFields(TAXONOMY, { full_name: "Sofie", sport: "  " }),
  ["identity.sport"],
  "een veld met alleen spaties telt als leeg",
);
assert.deepEqual(
  missingRequiredProfileFields(TAXONOMY, { full_name: "Sofie", sport: "sprint" }),
  [],
  "een compleet profiel hoort de poort te passeren",
);
// Niet-verplichte profielvelden blokkeren niets: een atleet zonder club hoort
// gewoon te kunnen beginnen.
assert.deepEqual(
  missingRequiredProfileFields(
    [...TAXONOMY, definition("identity.club", { fromProfile: true })],
    { full_name: "Sofie", sport: "sprint" },
  ),
  [],
  "een leeg optioneel profielveld hoort de intake niet tegen te houden",
);

console.log(
  "profile-fields: seed, koppeling en taxonomie zeggen hetzelfde, profielvelden worden nooit gevraagd, de poort kijkt naar de verplichte",
);
