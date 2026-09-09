import assert from "node:assert/strict";
import nl from "../../messages/nl.json";
import en from "../../messages/en.json";

/**
 * De twee catalogi moeten dezelfde sleutels hebben, met dezelfde plaatshouders.
 *
 * Waarom dit een test is en geen discipline: i18n/request.ts valt bij een
 * ontbrekende sleutel terug op de andere taal, en dat is bewust, want een half
 * vertaald scherm moet gewoon uitleveren in plaats van "chat.placeholder" te
 * tonen. Maar diezelfde terugval maakt een ontbrekende vertaling ONZICHTBAAR:
 * de Engelse zin verschijnt tussen de Nederlandse en niemand merkt het. Deze
 * test is wat de terugval een vangnet houdt in plaats van een werkwijze.
 *
 * Nederlands is de bron: dat bestand is de volledige lijst, en het is ook wat
 * types/i18n.d.ts als type gebruikt.
 */

type Node = Record<string, unknown>;

function flatten(value: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    out.set(prefix.replace(/\.$/, ""), value);
    return out;
  }
  for (const [key, child] of Object.entries(value as Node)) {
    for (const [k, v] of flatten(child, `${prefix}${key}.`)) out.set(k, v);
  }
  return out;
}

const dutch = flatten(nl);
const english = flatten(en);

// 1. Gelijke sleutelverzameling, in beide richtingen.
const missingInEnglish = [...dutch.keys()].filter((key) => !english.has(key));
const missingInDutch = [...english.keys()].filter((key) => !dutch.has(key));

assert.deepEqual(missingInEnglish, [], `sleutels ontbreken in en.json: ${missingInEnglish.join(", ")}`);
assert.deepEqual(missingInDutch, [], `sleutels ontbreken in nl.json: ${missingInDutch.join(", ")}`);

// 2. Geen lege waarden. Een leeg bericht rendert als niets, en dat is op een
//    scherm niet van een bug te onderscheiden.
//
//    Een lijst mag: format.months is er een, en die hoort een lijst te zijn.
//    Wel evenveel elementen in beide talen, anders levert maand 12 niets op.
for (const [catalog, entries] of [
  ["nl", dutch],
  ["en", english],
] as const) {
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      assert.ok(value.length > 0, `${catalog}.json: ${key} is een lege lijst`);
      for (const [index, entry] of value.entries()) {
        assert.equal(
          typeof entry,
          "string",
          `${catalog}.json: ${key}[${index}] is geen tekst`,
        );
        assert.ok(
          (entry as string).trim() !== "",
          `${catalog}.json: ${key}[${index}] is leeg`,
        );
      }
      continue;
    }
    assert.equal(
      typeof value,
      "string",
      `${catalog}.json: ${key} is geen tekst maar ${typeof value}`,
    );
    assert.ok((value as string).trim() !== "", `${catalog}.json: ${key} is leeg`);
  }
}

for (const [key, dutchValue] of dutch) {
  if (!Array.isArray(dutchValue)) continue;
  const englishValue = english.get(key);
  assert.ok(Array.isArray(englishValue), `${key}: is een lijst in nl maar niet in en`);
  assert.equal(
    (englishValue as unknown[]).length,
    dutchValue.length,
    `${key}: lijsten zijn niet even lang`,
  );
}

// 3. Dezelfde plaatshouders. Dit is de stille breker: een {count} die in het
//    Nederlands staat en in het Engels niet, levert een bericht op dat het
//    getal weglaat zonder een fout te geven.
/**
 * De ICU-argumenten in een bericht.
 *
 * Een naam die direct gevolgd wordt door `}` of `,`, dus `{filename}` en
 * `{count, plural, ...}` tellen mee. De eerste versie hiervan matchte alles na
 * een accolade, en pikte daardoor de eerste woorden van een meervoudstak op:
 * `{count, plural, one {Er staat...}}` gaf "Er" als plaatshouder en de test
 * viel op zijn eigen regex in plaats van op een echt verschil.
 */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*(?:\}|,)/g)]
    .map((m) => m[1])
    .sort();
}

for (const [key, dutchValue] of dutch) {
  if (typeof dutchValue !== "string") continue;
  const englishValue = english.get(key) as string;
  const a = placeholders(dutchValue);
  const b = placeholders(englishValue);
  assert.deepEqual(
    a,
    b,
    `${key}: plaatshouders lopen uiteen, nl [${a.join(", ")}] tegenover en [${b.join(", ")}]`,
  );
}

// 4. ICU-meervoud aan beide kanten of aan geen van beide. Een plural die alleen
//    in het Nederlands staat betekent dat het Engels "2 blessure" schrijft.
for (const [key, dutchValue] of dutch) {
  if (typeof dutchValue !== "string") continue;
  const englishValue = english.get(key) as string;
  const dutchPlural = dutchValue.includes(", plural,");
  const englishPlural = englishValue.includes(", plural,");
  assert.equal(
    dutchPlural,
    englishPlural,
    `${key}: meervoudsvorm staat maar in een van de twee talen`,
  );
}

console.log(
  `i18n-keys: ${dutch.size} sleutels, gelijk in beide talen, plaatshouders en meervouden op elkaar`,
);
process.exit(0);
