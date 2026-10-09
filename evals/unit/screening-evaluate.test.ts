import assert from "node:assert/strict";
import { type MetricSpec, evaluate, historyKey } from "../../lib/screening/evaluate";

/**
 * De lijm tussen metingen en uitkomstrijen.
 *
 * Twee dingen moeten kloppen en zijn allebei stil als ze dat niet doen: een
 * meting zonder band mag geen rij MISSEN (dan verdwijnt de waarde uit het
 * rapport), en asymmetrie mag niet berekend worden waar hij niets betekent.
 */

const slr: MetricSpec = {
  key: "mobility_ll.passive_slr.value",
  unit: "deg",
  direction: "higher_better",
  perSide: true,
  rule: {
    id: 1,
    layer: "published",
    classificationEnabled: true,
    coverage: "total",
    bands: [
      { status: "poor", score: 0, lt: 75 },
      { status: "fair", score: 1, gte: 75, lt: 80 },
      { status: "good", score: 2, gte: 80, lt: 85 },
      { status: "excellent", score: 3, gte: 85 },
    ],
  },
};

// Thomas: geseed, maar classificatie uit tot de tekenconventie vastligt.
const thomas: MetricSpec = {
  ...slr,
  key: "mobility_ll.thomas.value",
  rule: { ...slr.rule!, id: 2, classificationEnabled: false },
};

const squat: MetricSpec = {
  key: "movement_ll.overhead_deep_squat.value",
  unit: "score",
  direction: "higher_better",
  perSide: false,
  rule: null,
};

const specs = new Map([slr, thomas, squat].map((s) => [s.key, s]));

/** Alle metingen hieronder onder dezelfde protocolversie. */
const PROTO = "protocol-v1";

// ── 1. Band waar het mag, geen band waar het niet mag ────────────────────────
{
  const rows = evaluate(
    [
      { metricKey: slr.key, side: "left", value: 82, protocolId: PROTO },
      { metricKey: thomas.key, side: "left", value: 82, protocolId: PROTO },
    ],
    specs,
  );

  const slrRow = rows.find((r) => r.metricKey === slr.key && r.kind === "absolute")!;
  assert.equal(slrRow.bandStatus, "good");
  assert.equal(slrRow.bandScore, 2);
  assert.equal(slrRow.referenceRuleId, 1, "de band draagt de regel-ID, niet de rule_key");

  // Dezelfde waarde, regel uit: de meting blijft, de band niet.
  const thomasRow = rows.find((r) => r.metricKey === thomas.key)!;
  assert.equal(thomasRow.value, 82, "de waarde hoort er te staan");
  assert.equal(thomasRow.status, "computed");
  assert.equal(thomasRow.bandStatus, null);
  assert.equal(thomasRow.referenceRuleId, null, "geen band betekent geen regelverwijzing");
}

// ── 2. Niet gemeten levert nog steeds een rij ────────────────────────────────
//
// Anders verdwijnt "hoorde bij deze sessie, niet gemeten" uit het rapport, en
// dat is precies het onderscheid dat spec §12.1 eist.
{
  const rows = evaluate([{ metricKey: slr.key, side: "left", value: null, protocolId: PROTO }], specs);

  const absolute = rows.find((r) => r.kind === "absolute")!;
  assert.equal(absolute.status, "unavailable");
  assert.equal(absolute.unavailableReason, "missing_input");
  assert.equal(absolute.value, null);

  // En er komt een asymmetrierij bij die zegt dat er maar een zijde is. Bij een
  // test die per zijde hoort te gaan is dat geen ruis maar een opdracht aan de
  // tester, en precies het verschil dat spec §12.1 eist tussen "niet gemeten"
  // en "nul verschil".
  const asym = rows.find((r) => r.kind === "asymmetry")!;
  assert.equal(asym.status, "unavailable");
  assert.equal(asym.unavailableReason, "single_side_only");
}

// ── 3. Asymmetrie: alleen waar hij betekenis heeft ───────────────────────────
{
  const rows = evaluate(
    [
      { metricKey: slr.key, side: "left", value: 70, protocolId: PROTO },
      { metricKey: slr.key, side: "right", value: 84, protocolId: PROTO },
    ],
    specs,
  );

  const asym = rows.find((r) => r.kind === "asymmetry")!;
  assert.ok(asym, "twee zijden horen een asymmetrierij op te leveren");
  assert.equal(asym.side, "bilateral", "de uitkomst hoort bij geen van beide zijden");
  assert.equal(asym.unit, "percent");
  assert.ok(Math.abs(asym.value! - (14 / 84) * 100) < 1e-9);
  // Asymmetrie krijgt GEEN band: er is geen bronafkapwaarde voor. De check
  // constraint derived_band_needs_rule dwingt dat af, want een band zonder de
  // regel die hem gaf is een kleur zonder onderbouwing.
  assert.equal(asym.bandStatus, null);
  assert.equal(asym.referenceRuleId, null);

  // Spec §11 wil teller en noemer naast de uitkomst; daaruit volgt ook welke
  // zijde lager is, dus die hoeft er niet apart bij.
  assert.deepEqual(asym.inputs, { left: 70, right: 84 });
}

// Een 0-3-score heeft geen procentuele asymmetrie: het verschil tussen 2 en 3 is
// geen 33%.
{
  const rows = evaluate(
    [
      { metricKey: squat.key, side: "left", value: 2, protocolId: PROTO },
      { metricKey: squat.key, side: "right", value: 3, protocolId: PROTO },
    ],
    specs,
  );
  assert.equal(rows.filter((r) => r.kind === "asymmetry").length, 0);
  assert.equal(
    rows.filter((r) => r.kind === "absolute").length,
    2,
    "de twee metingen zelf blijven wel staan",
  );
}

// Een zijde gemeten is geen asymmetrie van 0.
{
  const rows = evaluate(
    [
      { metricKey: slr.key, side: "left", value: 70, protocolId: PROTO },
      { metricKey: slr.key, side: "right", value: null, protocolId: PROTO },
    ],
    specs,
  );
  const asym = rows.find((r) => r.kind === "asymmetry")!;
  assert.equal(asym.status, "unavailable");
  assert.equal(asym.unavailableReason, "single_side_only");
}

// ── 4. Een onbekende metriek wordt niet stil weggelaten ──────────────────────
{
  const rows = evaluate([{ metricKey: "bestaat.niet", side: "left", value: 1, protocolId: PROTO }], specs);
  assert.equal(rows.length, 0, "er is geen rij, want er is geen definitie om hem aan te hangen");
}



// ── 5. Laag 1: de atleet tegen zichzelf ──────────────────────────────────────
//
// Spec §5 zet zelfvergelijking op plaats 1 voor longitudinale opvolging. De
// uitkomst is een DELTA en nooit een band: "gelijk aan vorige keer" mag geen
// groen opleveren bij een waarde die ver onder elke norm ligt.
{
  const history = new Map([
    [
      historyKey(slr.key, "left"),
      [
        { occurredAt: "2026-04-01T09:00:00Z", recordedAt: "2026-04-01T09:00:00Z", protocolId: PROTO, value: 90 },
        { occurredAt: "2026-07-01T09:00:00Z", recordedAt: "2026-07-01T09:00:00Z", protocolId: PROTO, value: 84 },
      ],
    ],
  ]);

  const rows = evaluate(
    [{ metricKey: slr.key, side: "left", value: 77, protocolId: PROTO }],
    specs,
    history,
    "2026-10-09T09:00:00Z",
  );

  const delta = rows.find((r) => r.kind === "delta")!;
  assert.ok(delta, "er hoort een verandering tegenover de vorige sessie te zijn");
  assert.equal(delta.derivedKey, "delta_previous", "spec §8: het label is expliciet");
  assert.equal(delta.unit, "percent");
  // 77 na 84, dus achteruit. De VORIGE telt, niet de eerste.
  assert.ok(delta.value! < 0);
  assert.ok(Math.abs(delta.value! - ((77 - 84) / 84) * 100) < 1e-9);
  assert.deepEqual(delta.inputs, { previous: 84, current: 77 });

  // En geen band: laag 1 oordeelt niet.
  assert.equal(delta.bandStatus, null);
  assert.equal(delta.referenceRuleId, null);

  // De ruwe waarde wordt wel gewoon geclassificeerd.
  const absolute = rows.find((r) => r.kind === "absolute")!;
  assert.equal(absolute.bandStatus, "fair");
}

// Een eerste meting levert geen deltarij op: "nog geen baseline" is de
// afwezigheid van een uitkomst, en een rij per metriek die dat zegt maakt het
// eerste rapport onleesbaar.
{
  const rows = evaluate(
    [{ metricKey: slr.key, side: "left", value: 77, protocolId: PROTO }],
    specs,
    new Map(),
  );
  assert.equal(rows.filter((r) => r.kind === "delta").length, 0);
}

// Maar een protocolwissel WEL: daar is historie, alleen niet vergelijkbaar, en
// dat hoort de behandelaar te zien in plaats van een lege plek. Spec §4.
{
  const history = new Map([
    [
      historyKey(slr.key, "left"),
      [{ occurredAt: "2026-07-01T09:00:00Z", recordedAt: "2026-07-01T09:00:00Z", protocolId: "protocol-v2", value: 84 }],
    ],
  ]);
  const rows = evaluate(
    [{ metricKey: slr.key, side: "left", value: 77, protocolId: PROTO }],
    specs,
    history,
    "2026-10-09T09:00:00Z",
  );

  const delta = rows.find((r) => r.kind === "delta")!;
  assert.ok(delta, "een protocolwissel is geen lege historie");
  assert.equal(delta.status, "unavailable");
  assert.equal(delta.unavailableReason, "protocol_mismatch");
}

console.log(
  "screening-evaluate: band aan/uit, niet-gemeten blijft een rij, asymmetrie met richting, " +
    "delta tegen de vorige sessie",
);

// De zijde hoort bij de sleutel. Zonder dat vergelijkt links met de vorige
// RECHTS zodra die toevallig als laatste is ingevoerd: een geloofwaardig
// percentage over twee verschillende knieen. Gemeten in de browser, niet bedacht.
{
  const history = new Map([
    [historyKey(slr.key, "left"), [{ occurredAt: "2026-07-01T09:00:00Z", recordedAt: "2026-07-01T09:00:00Z", protocolId: PROTO, value: 78 }]],
    [historyKey(slr.key, "right"), [{ occurredAt: "2026-07-01T09:00:00Z", recordedAt: "2026-07-01T09:00:00Z", protocolId: PROTO, value: 84 }]],
  ]);

  const rows = evaluate(
    [
      { metricKey: slr.key, side: "left", value: 70, protocolId: PROTO },
      { metricKey: slr.key, side: "right", value: 86, protocolId: PROTO },
    ],
    specs,
    history,
    "2026-10-09T09:00:00Z",
  );

  const left = rows.find((r) => r.kind === "delta" && r.side === "left")!;
  const right = rows.find((r) => r.kind === "delta" && r.side === "right")!;

  assert.equal(left.inputs.previous, 78, "links vergelijkt met de vorige LINKS");
  assert.equal(right.inputs.previous, 84, "rechts met de vorige RECHTS");
  assert.ok(left.value! < 0, "70 na 78 is achteruit");
  assert.ok(right.value! > 0, "86 na 84 is vooruit");
}
