import assert from "node:assert/strict";
import { type TrendSeries, layout } from "../../lib/screening/chart";

/**
 * De meetkunde van de verlooplijn.
 *
 * Eén regel telt echt: een lijn loopt nooit door een protocolwissel heen. Spec
 * §4 zegt dat een waarde onder een ander protocol niet langs de vorige te
 * leggen is, en een doorlopende lijn beweert precies het tegenovergestelde.
 * Dat is een overtuigende leugen, want de grafiek ziet er daarna prima uit.
 */

const P1 = "protocol-v1";
const P2 = "protocol-v2";

// ── 1. De breuk ─────────────────────────────────────────────────────────────
{
  const series: TrendSeries[] = [
    {
      side: "left",
      points: [
        { date: "2026-01-10", value: 70, protocolId: P1 },
        { date: "2026-04-10", value: 76, protocolId: P1 },
        { date: "2026-07-10", value: 80, protocolId: P2 },
        { date: "2026-10-10", value: 82, protocolId: P2 },
      ],
    },
  ];

  const l = layout(series);

  // Twee paden, niet één: v1 heeft twee punten, v2 heeft er twee.
  assert.equal(l.paths.length, 2, "de lijn breekt bij de protocolwissel");
  assert.equal(l.marks.length, 4, "alle vier de metingen blijven zichtbaar");
  assert.equal(l.breaks.length, 1, "de wissel wordt gemarkeerd");

  // De breuk ligt tussen de twee datums waar het protocol verandert.
  const xs = l.marks.map((m) => m.cx).sort((a, b) => a - b);
  assert.ok(l.breaks[0].x > xs[1] && l.breaks[0].x < xs[2]);

  // Zonder wissel is het één doorlopend pad.
  const same = layout([
    { side: "left", points: series[0].points.map((p) => ({ ...p, protocolId: P1 })) },
  ]);
  assert.equal(same.paths.length, 1);
  assert.equal(same.breaks.length, 0);
}

// Een losse meting onder een eigen protocol krijgt geen pad: één punt is geen
// lijn. Het punt blijft wel staan, anders verdwijnt een meting van het scherm.
{
  const l = layout([
    {
      side: "left",
      points: [
        { date: "2026-01-10", value: 70, protocolId: P1 },
        { date: "2026-04-10", value: 76, protocolId: P2 },
      ],
    },
  ]);
  assert.equal(l.paths.length, 0, "twee losse protocollen, dus geen enkele lijn");
  assert.equal(l.marks.length, 2, "beide metingen staan er wel");
}

// ── 2. Twee zijden delen één schaal ─────────────────────────────────────────
//
// Spec §11: "For bilateral tests, show L and R on the same scale." Een eigen
// y-as per zijde laat een verschil van 2 graden eruitzien als een kloof.
{
  const l = layout([
    { side: "left", points: [
      { date: "2026-01-10", value: 70, protocolId: P1 },
      { date: "2026-04-10", value: 72, protocolId: P1 }] },
    { side: "right", points: [
      { date: "2026-01-10", value: 86, protocolId: P1 },
      { date: "2026-04-10", value: 88, protocolId: P1 }] },
  ]);

  assert.equal(l.paths.length, 2, "één pad per zijde");
  const left = l.marks.filter((m) => m.side === "left");
  const right = l.marks.filter((m) => m.side === "right");

  // Hogere waarde, hoger in het vak: één schaal voor allebei.
  assert.ok(right[0].cy < left[0].cy, "86 hoort boven 70 te staan");
  // Dezelfde datum, dezelfde x.
  assert.equal(left[0].cx, right[0].cx);
}

// ── 3. Randgevallen die anders een deling door nul zijn ─────────────────────
{
  const empty = layout([]);
  assert.deepEqual(empty.paths, []);
  assert.deepEqual(empty.marks, []);
  assert.ok(empty.plot.w > 0 && empty.plot.h > 0);

  // Eén meting: geen lijn, wel een punt, en een as die niet deelt door nul.
  const one = layout([
    { side: "left", points: [{ date: "2026-01-10", value: 70, protocolId: P1 }] },
  ]);
  assert.equal(one.marks.length, 1);
  assert.equal(one.paths.length, 0);
  assert.ok(Number.isFinite(one.marks[0].cx) && Number.isFinite(one.marks[0].cy));

  // Alles exact gelijk: een vlakke lijn, geen NaN.
  const flat = layout([
    { side: "left", points: [
      { date: "2026-01-10", value: 50, protocolId: P1 },
      { date: "2026-04-10", value: 50, protocolId: P1 }] },
  ]);
  assert.ok(flat.marks.every((m) => Number.isFinite(m.cy)));
  assert.equal(flat.marks[0].cy, flat.marks[1].cy);
}

// ── 4. Alles blijft binnen het vak ──────────────────────────────────────────
//
// Een punt dat buiten het tekenvak valt wordt door de SVG afgeknipt en is dan
// stil weg. Daarom loopt de as naar ronde getallen BUITEN het bereik.
{
  const l = layout([
    { side: "left", points: [
      { date: "2026-01-10", value: 7.3, protocolId: P1 },
      { date: "2026-04-10", value: 12.8, protocolId: P1 },
      { date: "2026-07-10", value: 9.1, protocolId: P1 }] },
  ]);

  for (const m of l.marks) {
    assert.ok(m.cx >= l.plot.x - 0.01 && m.cx <= l.plot.x + l.plot.w + 0.01, `x ${m.cx} buiten het vak`);
    assert.ok(m.cy >= l.plot.y - 0.01 && m.cy <= l.plot.y + l.plot.h + 0.01, `y ${m.cy} buiten het vak`);
  }
  assert.ok(l.yTicks.length >= 2 && l.yTicks.length <= 6, "een leesbaar aantal aslijnen");
  assert.equal(l.xTicks.length, 2, "alleen de eerste en de laatste datum passen");
}

// ── 5. Alleen het laatste punt krijgt een label ─────────────────────────────
//
// Een getal bij elk punt is onleesbaar; de as en de tabel dragen de rest.
{
  const l = layout([
    { side: "left", points: [
      { date: "2026-01-10", value: 70, protocolId: P1 },
      { date: "2026-04-10", value: 72, protocolId: P1 },
      { date: "2026-07-10", value: 75, protocolId: P1 }] },
    { side: "right", points: [
      { date: "2026-01-10", value: 80, protocolId: P1 }] },
  ]);

  assert.equal(l.endpoints.length, 2, "één eindpunt per zijde");
  assert.equal(l.endpoints.find((e) => e.side === "left")?.value, 75, "de laatste, niet de hoogste");
  assert.equal(l.endpoints.find((e) => e.side === "right")?.value, 80);
}

console.log("screening-chart: breuk bij protocolwissel, één schaal voor L/R, niets buiten het vak");
