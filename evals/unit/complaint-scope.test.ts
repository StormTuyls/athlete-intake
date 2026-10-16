import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, parseAskWhen, validateConditions } from "../../lib/dossier/askWhen";
import { computeGaps } from "../../lib/dossier/completeness";
import type { FieldDefinition, FieldTier, ResolvedField } from "../../lib/types";

/**
 * De klachtsectie gaat open en dicht met één antwoord.
 *
 * Dit is de eerste sectie in de taxonomie die ask_when gebruikt, en de faalwijze
 * is precies die uit de kop van lib/dossier/askWhen.ts: hij is stil. Staat de
 * voorwaarde verkeerd, dan krijgt een atleet met rugpijn de veertien
 * klachtvragen gewoon niet, er komt geen foutmelding, en het dossier ziet er
 * compleet uit omdat die velden buiten bereik vallen.
 *
 * Daarom wordt de SEED uitgelezen en niet een lijst in dit bestand. Een test met
 * zijn eigen definities zou blijven slagen nadat iemand de voorwaarde in de seed
 * stukmaakt.
 *
 * Geen databank: de seed is een tekstbestand.
 */

const seed = readFileSync("supabase/seed.sql", "utf8");

/**
 * De rijen uit de klacht-insert. Die heeft als enige twaalf kolommen, en de
 * laatste twee zijn tier en ask_when.
 */
const rows = [
  ...seed.matchAll(
    /\('(complaint\.[a-z0-9_]+)',\s*'complaint',\s*(\d+),[\s\S]*?'(core|standard|deep)',\s*('(?:[^']|'')*')\)/g,
  ),
];

assert.equal(rows.length, 14, `veertien klachtvelden verwacht, gevonden: ${rows.length}`);

/**
 * Dezelfde veertien staan in de migratie, en dat moet letterlijk hetzelfde zijn.
 *
 * Migraties draaien voor de seed, dus op een VERSE databank wint de migratie en
 * doet de seed niets; op een BESTAANDE databank draait de seed nooit. Lopen de
 * twee uiteen, dan hangt het antwoord op "is dit veld verplicht" af van wanneer
 * de databank is aangemaakt. Dat is niet te zien en niet te debuggen.
 */
const migrationSql = readFileSync(
  "supabase/migrations/20261015090000_intake_protocol_v2.sql",
  "utf8",
);

function shape(sql: string): string[] {
  return [
    ...sql.matchAll(
      /\('(complaint\.[a-z0-9_]+)',\s*'complaint',\s*(\d+),\s*'[^']*',\s*'[^']*',\s*'([a-z_]+)',\s*(true|false),\s*(true|false)/g,
    ),
  ].map((m) => `${m[1]} #${m[2]} ${m[3]} verplicht=${m[4]} medisch=${m[5]}`);
}

const fromSeed = shape(seed);
assert.equal(fromSeed.length, 14, "de seedrijen zijn niet te ontleden");
assert.deepEqual(
  shape(migrationSql),
  fromSeed,
  "supabase/seed.sql en de migratie beschrijven niet dezelfde klachtvelden",
);

const complaint: FieldDefinition[] = rows.map((row) => ({
  key: row[1],
  section: "complaint",
  sortOrder: Number(row[2]),
  labelNl: row[1],
  labelEn: row[1],
  dataType: "text",
  // Of een veld verplicht is staat verderop in dezelfde rij; voor het bereik
  // doet het niet ter zake, en `true` maakt elk veld in bereik tot een gat.
  required: true,
  isMedical: true,
  enumOptions: null,
  questionNl: "vraag",
  questionEn: "question",
  tier: row[3] as FieldTier,
  askWhen: parseAskWhen(JSON.parse(row[4].slice(1, -1).replace(/''/g, "'")), row[1]),
  fromProfile: false,
  carryForward: false,
}));

// status.pain_now opent de sectie, dus hij moet er zijn en hij moet core zijn.
// Zonder core wordt er pas naar gevraagd als zijn eigen voorwaarden kloppen, en
// die heeft hij niet: dan gaat de sectie nooit open.
assert.match(
  seed,
  /set tier = 'core'\s*\n\s*where key = 'status\.pain_now'/,
  "status.pain_now staat niet op tier core in de seed",
);

const painNow: FieldDefinition = {
  ...complaint[0],
  key: "status.pain_now",
  section: "current_status",
  sortOrder: 1,
  dataType: "boolean",
  tier: "core",
  askWhen: null,
};

const definitions = [painNow, ...complaint];

// Een typefout in een veldsleutel of een kring moet hier al klappen.
validateConditions(definitions);

function gapKeys(values: Record<string, unknown>): string[] {
  const resolved = new Map<string, ResolvedField>();
  for (const [key, value] of Object.entries(values)) {
    resolved.set(key, {
      fieldKey: key,
      value,
      status: "extracted",
      confidence: "high",
      proposedBy: "athlete",
      winningProposalId: null,
      conflicts: [],
    });
  }
  return computeGaps(definitions, resolved, "nl").gaps.map((gap) => gap.fieldKey);
}

// 1. Nog niets beantwoord: onbekend is geen gat. Alleen pain_now zelf staat open.
assert.deepEqual(
  gapKeys({}),
  ["status.pain_now"],
  "voor het antwoord op pain_now hoort alleen pain_now een gat te zijn",
);

// 2. Geen klacht: de hele sectie valt weg, en indienen wordt er niet door
//    geblokkeerd ook al staan die velden op verplicht.
assert.deepEqual(
  gapKeys({ "status.pain_now": false }),
  [],
  "bij 'geen pijn' hoort de klachtsectie leeg te blijven",
);

// 3. Wel een klacht: dertien velden gaan open. night_detail niet, want die hangt
//    ook nog aan complaint.night_pain, en daar is nog niets over gezegd.
const withPain = gapKeys({ "status.pain_now": true });
assert.ok(
  withPain.includes("complaint.location"),
  "bij pijn hoort naar de locatie gevraagd te worden",
);
for (const key of [
  "complaint.provocation",
  "complaint.reduction",
  "complaint.pattern_24h",
  "complaint.night_pain",
  "complaint.activity_limitations",
  "complaint.participation_limitations",
]) {
  assert.ok(withPain.includes(key), `${key} hoort in bereik te zijn bij pijn`);
}
assert.ok(
  !withPain.includes("complaint.night_detail"),
  "night_detail hoort pas open te gaan na het antwoord op night_pain",
);

// 4. Nachtpijn bevestigd: dan pas de vervolgvraag.
assert.ok(
  gapKeys({ "status.pain_now": true, "complaint.night_pain": true }).includes(
    "complaint.night_detail",
  ),
  "na 'ja' op nachtpijn hoort de toelichting gevraagd te worden",
);
assert.ok(
  !gapKeys({ "status.pain_now": true, "complaint.night_pain": false }).includes(
    "complaint.night_detail",
  ),
  "na 'nee' op nachtpijn hoort de toelichting weg te blijven",
);

// 5. De voorwaarde zelf, los van de gatenberekening.
const location = complaint.find((d) => d.key === "complaint.location");
assert.equal(evaluate(location!.askWhen, new Map()), "unknown");

// Dertien, niet veertien: night_detail wacht op het antwoord op night_pain.
assert.equal(withPain.length, 13);

console.log(
  `complaint-scope: 14 velden, dicht bij 'geen pijn', ${withPain.length} open bij pijn`,
);
process.exit(0);
