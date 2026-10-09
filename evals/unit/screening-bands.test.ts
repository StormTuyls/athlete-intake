import assert from "node:assert/strict";
import {
  BANDS,
  type Band,
  classify,
  matchBand,
  validateBands,
} from "../../lib/screening/bands";

/**
 * De bandenlogica, tegen de gaten die spec §6 en §10 benoemen.
 *
 * Twee faalwijzen staan hier centraal, en allebei zijn ze stil:
 *
 *   1. Een waarde in een gat die de dichtstbijzijnde band krijgt. Dan maakt het
 *      systeem van een onbekende bron een stellige uitspraak.
 *   2. Een regel die classificeert terwijl het protocol niet bevestigd is. Dan
 *      hangt er een rood badge aan een tekenconventie die niemand nagekeken heeft.
 */

// Passive SLR uit spec §6: 0 <75; 1 75-80; 2 80-85; 3 >85.
const slr: Band[] = [
  { status: "poor", score: 0, lt: 75 },
  { status: "fair", score: 1, gte: 75, lt: 80 },
  { status: "good", score: 2, gte: 80, lt: 85 },
  { status: "excellent", score: 3, gte: 85 },
];

const enabled = { bands: slr, coverage: "total" as const, classificationEnabled: true };

// ── 1. Halfopen grenzen, overal hetzelfde ────────────────────────────────────
//
// Spec §6 laat per regel open wat er op de grens gebeurt ("decide handling at
// exactly 1.0 cm", "Define exactly 60"). Een conventie op schemaniveau
// beantwoordt dat in een keer: de ondergrens telt mee, de bovengrens niet.
{
  assert.equal(matchBand(74.9, slr)?.status, "poor");
  assert.equal(matchBand(75, slr)?.status, "fair", "de ondergrens hoort bij de band");
  assert.equal(matchBand(79.9, slr)?.status, "fair");
  assert.equal(matchBand(80, slr)?.status, "good");
  assert.equal(matchBand(85, slr)?.status, "excellent");
  assert.equal(matchBand(140, slr)?.status, "excellent");
  assert.equal(matchBand(-10, slr)?.status, "poor", "de onderste band is open");
}

// ── 2. ASH: een gat levert geen buurband ─────────────────────────────────────
//
// Spec §6 bij ASH I: "1 <150 N; 2 >180; 3 >200" met de noot "GAPS exist between
// categories; must define full bands". 165 N valt nergens in. De verleidelijke
// fout is de dichtstbijzijnde band pakken; dat maakt van een gat in de bron een
// stille aanname.
{
  const ash: Band[] = [
    { status: "low", score: 1, lt: 150 },
    { status: "moderate", score: 2, gte: 180, lt: 200 },
    { status: "high", score: 3, gte: 200 },
  ];

  assert.equal(matchBand(140, ash)?.status, "low");
  assert.equal(matchBand(165, ash), null, "165 N valt in het gat en krijgt geen band");
  assert.equal(matchBand(190, ash)?.status, "moderate");

  // En de regel moet zichzelf als 'gapped' aangeven. Doet hij dat niet, dan is
  // dat een fout in de seed en geen verrassing in productie.
  assert.deepEqual(validateBands(ash, "gapped"), []);
  const lying = validateBands(ash, "total");
  assert.equal(lying.length, 1);
  assert.match(lying[0], /gat tussen 'low' en 'moderate'/);

  // Een gegapte regel mag van de databank sowieso niet classificeren
  // (reference_rules_gapped_cannot_classify). Zet iemand hem toch aan, dan is
  // het antwoord in het gat 'outside_bands' en nooit een buurband.
  const result = classify(165, { bands: ash, coverage: "gapped", classificationEnabled: true });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "outside_bands");
}

// ── 3. Classificatie uit betekent: meten ja, indelen nee ─────────────────────
//
// Spec §18: de tekenconventie van 90-90 knee extension en Thomas staat niet
// vast. Is de 90-90-waarde een extensieTEKORT, dan draait de scoringsrichting om
// en wordt elke atleet omgekeerd ingedeeld. Tot de praktijk dat bevestigt wordt
// er gemeten en getrend, maar niet ingedeeld.
{
  const off = { bands: slr, coverage: "total" as const, classificationEnabled: false };
  const result = classify(82, off);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "classification_disabled");

  // Dezelfde waarde met de schakelaar aan levert wel een band. Het verschil zit
  // in de data en niet in de code: aanzetten is een update, geen release.
  const on = classify(82, enabled);
  assert.ok(on.ok);
  assert.equal(on.ok && on.status, "good");
  assert.equal(on.ok && on.score, 2);
}

// ── 4. Niet gemeten is geen band en ook geen gat ─────────────────────────────
{
  const result = classify(null, enabled);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "not_measured");

  // Een gemeten nul is wel een waarde en krijgt wel een band.
  const zero = classify(0, enabled);
  assert.ok(zero.ok);
  assert.equal(zero.ok && zero.status, "poor");
}

// ── 5. De validator vangt wat een check constraint niet kan ──────────────────
{
  assert.deepEqual(validateBands(slr, "total"), [], "een sluitende reeks is geldig");

  // Overlap. 'de eerste die past' levert dan stil de verkeerde op.
  const overlapping: Band[] = [
    { status: "a", lt: 80 },
    { status: "b", gte: 75 },
  ];
  const overlap = validateBands(overlapping, "total");
  assert.ok(overlap.some((e) => /overlappen op 75/.test(e)));

  // Twee open uiteinden aan dezelfde kant: de getallenlijn is dubbel gedekt.
  const twoOpenTops: Band[] = [
    { status: "a", lt: 50 },
    { status: "b", gte: 50 },
    { status: "c", gte: 90 },
  ];
  assert.ok(
    validateBands(twoOpenTops, "total").some((e) => /precies een band zonder bovengrens/.test(e)),
  );

  // Omgekeerde grenzen binnen een band.
  assert.ok(
    validateBands([{ status: "a", gte: 90, lt: 50 }], "total").some((e) =>
      /ligt niet onder lt/.test(e),
    ),
  );

  assert.deepEqual(validateBands([], "total"), ["bandenreeks is leeg"]);
}

// ── 6. Het zod-schema weigert vormfouten uit de jsonb-kolom ──────────────────
{
  assert.ok(BANDS.safeParse(slr).success);
  // Een band zonder enige grens vangt alles af en maakt de rest onbereikbaar.
  assert.equal(BANDS.safeParse([{ status: "alles" }]).success, false);
  assert.equal(BANDS.safeParse([]).success, false);
  assert.equal(BANDS.safeParse([{ status: "a", score: 7, lt: 10 }]).success, false);
}

console.log("screening-bands: halfopen grenzen, ASH-gaten, classificatie uit, vormvalidatie");
