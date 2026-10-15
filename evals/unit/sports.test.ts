import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SPORTS,
  disciplinesOf,
  selectableSports,
  sportKeys,
  sportLabel,
} from "../../lib/intake/sports";

/**
 * De sportenlijst staat op twee plekken, en dit houdt ze gelijk.
 *
 * De sleutels horen in de databank (`field_definitions.enum_options` van
 * identity.sport, want dat is wat bevroren is), de labels en de disciplines in
 * lib/intake/sports.ts (want dat is presentatie en invoerhulp). Dat is een
 * verdeling met één faalwijze: iemand voegt een sport toe aan het TS-bestand en
 * niet aan de seed, of andersom.
 *
 * Wat er dan gebeurt is stil. Een sleutel die wel in enum_options staat maar
 * niet in het TS-bestand krijgt via enumLabel() een opgepoetste sleutel als
 * label ("Cross country skiing"), en niemand ziet dat dat de terugval was. Een
 * sleutel die alleen in het TS-bestand staat is nooit te kiezen, want
 * lib/dossier/validate.ts kijkt naar enum_options.
 *
 * Geen databank nodig: de seed is een tekstbestand.
 */

const seed = readFileSync("supabase/seed.sql", "utf8");

// Het array-literal achter identity.sport, tot de sluitende blokhaak.
const block = /\('identity\.sport'[\s\S]*?array\[([\s\S]*?)\]/.exec(seed);
assert.ok(block, "identity.sport met zijn enum_options niet gevonden in de seed");

const inSeed = [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);

assert.deepEqual(
  inSeed,
  sportKeys(),
  "supabase/seed.sql en lib/intake/sports.ts zijn uit de pas gelopen",
);

// Dezelfde lijst staat in de migratie, voor databanken die de seed niet draaien.
const migration = readFileSync(
  "supabase/migrations/20261015090000_intake_protocol_v2.sql",
  "utf8",
);
const migrationBlock = /set enum_options = array\[([\s\S]*?)\]/.exec(migration);
assert.ok(migrationBlock, "de migratie zet geen enum_options");
assert.deepEqual(
  [...migrationBlock[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]),
  sportKeys(),
  "de migratie en lib/intake/sports.ts zijn uit de pas gelopen",
);

// Dubbele sleutels zouden de vergelijking hierboven overleven zolang ze in
// beide lijsten even vaak voorkomen, en pas opvallen als een label het andere
// overschrijft.
assert.equal(new Set(sportKeys()).size, sportKeys().length, "dubbele sportsleutel");

for (const sport of SPORTS) {
  assert.ok(sport.labelNl.trim() !== "", `${sport.key} heeft geen Nederlands label`);
  assert.ok(sport.labelEn.trim() !== "", `${sport.key} heeft geen Engels label`);

  const keys = sport.disciplines.map((d) => d.key);
  assert.equal(
    new Set(keys).size,
    keys.length,
    `${sport.key} heeft een dubbele discipline`,
  );
}

// De afgedankte sleutels blijven geldig maar worden niet meer aangeboden. Zou
// dat omdraaien, dan verschijnt "sprint" weer als sport naast de atletiek waar
// hij een discipline van is.
const selectable = new Set(selectableSports().map((s) => s.key));
assert.ok(!selectable.has("sprint"), "sprint wordt nog aangeboden als sport");
assert.ok(!selectable.has("hurdles"), "hurdles wordt nog aangeboden als sport");
assert.ok(sportKeys().includes("sprint"), "sprint is uit enum_options verdwenen");
assert.equal(sportLabel("sprint", "nl"), "Sprint", "afgedankte sleutel heeft geen label meer");

// Een onbekende sport mag geen fout geven: identity.sport kan leeg zijn op het
// moment dat de discipline gevraagd wordt.
assert.deepEqual(disciplinesOf(null, "nl"), []);
assert.deepEqual(disciplinesOf("bestaat_niet", "nl"), []);
assert.ok(disciplinesOf("athletics", "nl").includes("Horden (100-110 m)"));
assert.ok(disciplinesOf("athletics", "en").includes("Hurdles (100-110 m)"));

console.log(
  `sports: ${sportKeys().length} sleutels gelijk in seed, migratie en code; ` +
    `${selectable.size} aangeboden, ${SPORTS.length - selectable.size} afgedankt`,
);
process.exit(0);
