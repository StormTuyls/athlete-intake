import assert from "node:assert/strict";
import nl from "../../messages/nl.json";
import en from "../../messages/en.json";
import {
  formatIntakeTitle,
  formatIntakeTitleOrNull,
  titleFromRow,
  type IntakeTitleLabels,
} from "../../lib/intake/title";

/**
 * De titel van een intake: de terugvalketen en de opmaak.
 *
 * Geen databank nodig, want dat is precies waarom deze twee functies los staan
 * van de query. Wat hier vastligt is de volgorde waarin een titel gekozen wordt
 * en hoe hij eruitziet, en dat zijn de twee dingen die stil kunnen veranderen
 * zonder dat iets faalt: een lijst met drie keer "Intake" is geen crash, hij is
 * alleen onbruikbaar.
 */

const labels: IntakeTitleLabels = nl.intakeTitle;

const empty = { bodyRegion: null, side: null, painLocation: null, complaints: null };

// 1. De terugvalketen, in volgorde van specifiek naar vaag.
assert.deepEqual(
  titleFromRow({ ...empty, bodyRegion: "schouder", side: "right" }),
  { kind: "injury", bodyRegion: "schouder", side: "right", diagnosis: null },
);

assert.deepEqual(
  titleFromRow({ ...empty, painLocation: "lage rug" }),
  { kind: "text", text: "lage rug" },
  "zonder blessure-entry wint de pijnlocatie",
);

assert.deepEqual(
  titleFromRow({ ...empty, complaints: "Pijn bij het buigen." }),
  { kind: "text", text: "Pijn bij het buigen." },
  "de klachten zijn de laatste terugval",
);

assert.deepEqual(titleFromRow(empty), { kind: "none" }, "niets bekend is geen titel");

// Een blessure wint van beide andere, ook als die er ook zijn.
assert.equal(
  titleFromRow({
    bodyRegion: "knie",
    side: "left",
    painLocation: "lage rug",
    complaints: "van alles",
  }).kind,
  "injury",
);

// Witruimte is geen waarde. Anders levert een leeg tekstveld een lege titel op,
// en een lege titel is op het scherm niet van een defect te onderscheiden.
assert.deepEqual(
  titleFromRow({ ...empty, bodyRegion: "   ", painLocation: "lage rug" }),
  { kind: "text", text: "lage rug" },
);

// 2. De opmaak.
assert.equal(
  formatIntakeTitle(
    { kind: "injury", bodyRegion: "schouder", side: "right", diagnosis: null },
    labels,
  ),
  "Schouder · rechts",
);

assert.equal(
  formatIntakeTitle(
    {
      kind: "injury",
      bodyRegion: "schouder",
      side: "right",
      diagnosis: "subacromiaal impingement",
    },
    labels,
  ),
  "Schouder · rechts · subacromiaal impingement",
  "de diagnose hoort erbij als hij kort genoeg is",
);

assert.equal(
  formatIntakeTitle(
    {
      kind: "injury",
      bodyRegion: "knie",
      side: "left",
      diagnosis: "x".repeat(61),
    },
    labels,
  ),
  "Knie · links",
  "een diagnose van meer dan zestig tekens is geen titel meer en valt weg",
);

assert.equal(
  formatIntakeTitle(
    { kind: "injury", bodyRegion: "knie", side: "unknown", diagnosis: null },
    labels,
  ),
  "Knie",
  "'onbekend' krijgt geen woord: dat zegt minder dan niets erbij zetten",
);

assert.equal(formatIntakeTitle({ kind: "none" }, labels), labels.fallback);

// Vrije tekst wordt op een woordgrens ingekort, niet midden in een woord.
const long = formatIntakeTitle(
  {
    kind: "text",
    text: "pijn onderaan de lumbale wervelkolom die uitstraalt naar het linkerbeen",
  },
  labels,
);
assert.ok(long.endsWith("…"), `verwachtte een afkapping, kreeg: ${long}`);
assert.ok(long.length <= 45, `te lang: ${long}`);
assert.ok(!long.includes(" …"), `afgekapt met een losse spatie ervoor: ${long}`);

// Een eerste zin is genoeg; de rest van een alinea hoort niet in een titel.
assert.equal(
  formatIntakeTitle(
    { kind: "text", text: "Lage rugpijn. Sinds drie weken, na het tillen." },
    labels,
  ),
  "Lage rugpijn",
);

// 3. Beide catalogi leveren de vier woorden die de opmaak nodig heeft.
for (const [language, catalog] of [
  ["nl", nl],
  ["en", en],
] as const) {
  for (const key of ["left", "right", "bilateral", "fallback"] as const) {
    assert.ok(
      catalog.intakeTitle[key]?.trim(),
      `${language}.json: intakeTitle.${key} ontbreekt of is leeg`,
    );
  }
}

// 4. De variant die null teruggeeft, voor schermen met hun eigen terugval.
assert.equal(formatIntakeTitleOrNull({ kind: "none" }, labels), null);
assert.equal(
  formatIntakeTitleOrNull(
    { kind: "injury", bodyRegion: "enkel", side: "left", diagnosis: null },
    labels,
  ),
  "Enkel · links",
);

console.log("intake-title: ok");
