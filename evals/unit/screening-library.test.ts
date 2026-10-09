import assert from "node:assert/strict";
import { LIBRARY, type Library, validateLibrary } from "../../lib/screening/library";

/**
 * De geseede bibliotheek, gecontroleerd zonder databank.
 *
 * Dit is het net onder spec §6. De afkapwaarden daar zijn met de hand uit twee
 * bronbestanden overgenomen, en elke fout erin is stil: een regel die naar een
 * niet-bestaande metriek wijst levert geen melding op maar een test die nooit
 * een band krijgt, en een overlappende reeks levert gewoon de eerste band op die
 * past.
 *
 * Zelfde rol als evals/unit/ask-when.test.ts over supabase/seed.sql: in CI
 * laten vallen voordat een migratie het doet.
 */

// ── 1. De bibliotheek zelf is consistent ─────────────────────────────────────
assert.deepEqual(validateLibrary(), [], "de geseede bibliotheek hoort foutloos te zijn");

assert.ok(LIBRARY.tests.length >= 20, "spec §6 levert ruim twintig tests");
assert.equal(
  LIBRARY.protocols.length,
  LIBRARY.tests.length,
  "elke test heeft precies een protocolversie bij de start",
);

// ── 2. De validator vangt wat hij moet vangen ────────────────────────────────
//
// Een validator die nooit iets vindt is geen validator. Elke tak hieronder is
// een fout die anders pas bij de insert of in productie opvalt.
const base = (): Library => ({
  tests: [
    {
      key: "t.a", block: "test", sortOrder: 1,
      labelNl: "A", labelEn: "A", laterality: "per_side",
    },
  ],
  protocols: [
    {
      testKey: "t.a", version: 1, labelNl: "A v1", labelEn: "A v1",
      trialSelection: "single", protocolConfirmed: true,
    },
  ],
  metrics: [
    {
      key: "t.a.value", testKey: "t.a", labelNl: "A", labelEn: "A",
      unit: "deg", direction: "higher_better", isCore: true, decimals: 1,
    },
  ],
  rules: [
    {
      ruleKey: "r.a", version: 1, metricKey: "t.a.value", layer: "published",
      bands: [
        { status: "low", score: 0, lt: 10 },
        { status: "high", score: 1, gte: 10 },
      ],
      coverage: "total", classificationEnabled: true,
      evidence: "source_sheet", sourceCitation: "bron",
    },
  ],
});

assert.deepEqual(validateLibrary(base()), [], "de testbibliotheek zelf is geldig");

const broken: Array<[string, (l: Library) => void, RegExp]> = [
  ["metriek naar onbekende test", (l) => { l.metrics[0].testKey = "t.weg"; }, /onbekende test/],
  ["regel naar onbekende metriek", (l) => { l.rules[0].metricKey = "t.weg"; }, /onbekende metriek/],
  ["test zonder protocol", (l) => { l.protocols = []; }, /heeft geen protocol/],
  ["dubbele metrieksleutel", (l) => { l.metrics.push({ ...l.metrics[0] }); }, /dubbele sleutel/],
  [
    "botsende sorteervolgorde binnen een blok",
    (l) => {
      l.tests.push({ ...l.tests[0], key: "t.b" });
      l.protocols.push({ ...l.protocols[0], testKey: "t.b" });
    },
    /block, sort_order/,
  ],
  [
    "gaten en toch classificeren",
    (l) => { l.rules[0].coverage = "gapped"; },
    /mag niet classificeren/,
  ],
  [
    "gepubliceerde norm zonder citatie",
    (l) => { l.rules[0].evidence = "published"; delete l.rules[0].sourceCitation; },
    /citatie nodig/,
  ],
  [
    "streefbereik met twee banden",
    (l) => { l.metrics[0].direction = "target_range"; },
    /minstens drie banden/,
  ],
  [
    "score die lager-is-beter heet",
    (l) => { l.metrics[0].unit = "score"; l.metrics[0].direction = "lower_better"; },
    /higher_better/,
  ],
  [
    "overlappende banden",
    (l) => { l.rules[0].bands = [{ status: "a", lt: 20 }, { status: "b", gte: 10 }]; },
    /overlappen/,
  ],
];

for (const [name, mutate, expected] of broken) {
  const lib = base();
  mutate(lib);
  const errors = validateLibrary(lib);
  assert.ok(errors.length > 0, `'${name}' hoort een fout op te leveren`);
  assert.ok(
    errors.some((e) => expected.test(e)),
    `'${name}' leverde: ${errors.join(" | ")}`,
  );
}

// ── 3. Wat spec §10 en §18 onveilig noemt, classificeert niet ────────────────
//
// Dit is geen stijlkeuze maar de kern van het ontwerp: deze tests worden gemeten
// en getrend, niet ingedeeld, tot de praktijk het protocol bevestigt. Gaat een
// van deze ooit per ongeluk aan, dan hangt er een rood badge aan een
// tekenconventie die niemand nagekeken heeft.
const mustNotClassify = [
  "screening2025.mobility_ll.knee_extension_90_90", // VERIFY PROTOCOL, richting kan omdraaien
  "screening2025.mobility_ll.thomas",               // VERIFY PROTOCOL and sign convention
  "screening2025.anthropometry.apley",              // protocol and direction must be explicit
  "screening2025.strength_ul.ash_i",                // GAPS between categories
  "screening2025.strength_ul.ash_y",
  "screening2025.strength_ul.ash_t",
  "screening2025.forcedecks.hip_iso_push",          // VERIFY 'system weight'
  "screening2025.forcedecks.knee_iso_push",
  "screening2025.forcedecks.ankle_iso_push",
];

for (const ruleKey of mustNotClassify) {
  const rule = LIBRARY.rules.find((r) => r.ruleKey === ruleKey);
  assert.ok(rule, `regel ${ruleKey} hoort geseed te zijn, ook al classificeert hij niet`);
  assert.equal(
    rule.classificationEnabled,
    false,
    `${ruleKey} mag niet classificeren zolang het protocol niet bevestigd is`,
  );
  assert.ok(rule.sourceNote, `${ruleKey} hoort uit te leggen waarom hij uit staat`);
}

// En omgekeerd: de regels die wel classificeren moeten sluitend zijn, anders
// valt een deel van de atleten stil buiten elke band.
for (const rule of LIBRARY.rules.filter((r) => r.classificationEnabled)) {
  assert.equal(rule.coverage, "total", `${rule.ruleKey} classificeert maar dekt niet alles`);
}

// ── 4. De bronafkapwaarden staan er zoals spec §6 ze geeft ───────────────────
{
  const slr = LIBRARY.rules.find((r) => r.ruleKey === "screening2025.mobility_ll.passive_slr");
  assert.ok(slr);
  assert.deepEqual(
    slr.bands.map((b) => [b.score, b.gte ?? null, b.lt ?? null]),
    [
      [0, null, 75],
      [1, 75, 80],
      [2, 80, 85],
      [3, 85, null],
    ],
    "passieve SLR: 0 <75; 1 75-80; 2 80-85; 3 >85",
  );

  // FABER loopt omgekeerd: lager is beter, dus de score daalt terwijl de banden
  // oplopen. Precies de plek waar een overgetypte tabel omklapt.
  const faber = LIBRARY.rules.find((r) => r.ruleKey === "screening2025.mobility_ll.faber");
  assert.ok(faber);
  assert.deepEqual(faber.bands.map((b) => b.score), [3, 2, 1, 0]);
  const faberMetric = LIBRARY.metrics.find((m) => m.key === faber.metricKey);
  assert.equal(faberMetric?.direction, "lower_better");
}

console.log(
  `screening-library: ${LIBRARY.tests.length} tests, ${LIBRARY.rules.length} regels ` +
    `(${LIBRARY.rules.filter((r) => r.classificationEnabled).length} classificeren), validator getest`,
);
