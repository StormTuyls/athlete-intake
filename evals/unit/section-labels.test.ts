import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nl from "../../messages/nl.json";
import en from "../../messages/en.json";

/**
 * De sectienamen moeten de secties uit de taxonomie dekken, allemaal en niet meer.
 *
 * Er stonden drie van deze lijsten in de codebase, elk met hun eigen woorden, en
 * ze konden los van elkaar verlopen. Nu is er één bron, en dit is wat hem eerlijk
 * houdt: de seed is de waarheid over welke secties bestaan, dus die wordt
 * uitgelezen in plaats van hier een vierde lijst neer te zetten.
 *
 * Geen databank nodig: het gaat om een tekstbestand en twee JSON-bestanden, dus
 * dit draait in CI zonder Supabase.
 */

const seed = readFileSync("supabase/seed.sql", "utf8");

// De insert heeft de vorm ('sleutel', 'sectie', volgnummer, ...
const sections = new Set(
  [...seed.matchAll(/^\s*\('[a-z_.]+',\s*'([a-z_]+)',\s*\d+/gm)].map((m) => m[1]),
);

assert.ok(sections.size > 0, "de seed leverde geen enkele sectie op, klopt de regex nog?");
assert.equal(
  sections.size,
  7,
  `de taxonomie heeft zeven informatieblokken, gevonden: ${[...sections].join(", ")}`,
);

for (const [language, catalog] of [
  ["nl", nl],
  ["en", en],
] as const) {
  for (const register of ["athlete", "clinical"] as const) {
    const labels = catalog.sections[register] as Record<string, string>;
    const known = new Set(Object.keys(labels));

    for (const section of sections) {
      assert.ok(
        known.has(section),
        `${language}.sections.${register} mist de sectie '${section}' uit de seed`,
      );
      assert.ok(
        labels[section].trim() !== "",
        `${language}.sections.${register}.${section} is leeg`,
      );
    }

    for (const key of known) {
      assert.ok(
        sections.has(key),
        `${language}.sections.${register} heeft '${key}', maar die sectie staat niet in de seed`,
      );
    }
  }
}

// De twee registers moeten echt van elkaar verschillen, anders is het onderscheid
// alleen een idee en verdwijnt het bij de eerste opruiming.
const athleteNl = nl.sections.athlete as Record<string, string>;
const clinicalNl = nl.sections.clinical as Record<string, string>;
const different = [...sections].filter((key) => athleteNl[key] !== clinicalNl[key]);
assert.ok(
  different.length >= 3,
  `atleet- en klinisch register horen in toon te verschillen, verschillend: ${different.join(", ")}`,
);

console.log(
  `section-labels: 7 secties, 2 registers, 2 talen, ${different.length} bewust verschillend`,
);
process.exit(0);
