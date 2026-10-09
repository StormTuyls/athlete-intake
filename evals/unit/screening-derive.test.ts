import assert from "node:assert/strict";
import {
  ENGINE_VERSION,
  asymmetry,
  lsi,
  meanOf,
  percentChange,
  perBodyHeight,
  perBodyMass,
  perBodyWeight,
  ratio,
  sum,
} from "../../lib/screening/derive";
import { fromNullable, measured, unavailable } from "../../lib/screening/measured";
import { select } from "../../lib/screening/selection";
import { GRAVITY } from "../../lib/screening/units";

/**
 * De rekenmotor, tegen de fouten die spec §8 en §12.1 met naam noemen.
 *
 * Elke test hieronder staat voor een faalwijze die STIL is: er komt geen
 * foutmelding uit, alleen een plausibel getal dat de verkeerde kant op wijst.
 * Dat is precies het soort fout dat een behandelaar niet aan het scherm ziet,
 * en de reden dat deze module zuiver is en zonder databank te testen.
 */

const close = (a: number, b: number, eps = 1e-9) =>
  Math.abs(a - b) < eps ? true : assert.fail(`${a} != ${b}`);

// ── 1. LSI op een tijdmetriek ────────────────────────────────────────────────
//
// Spec §8: "LSI - lower time is better: uninvolved time / involved time x100.
// Avoid using the higher-is-better formula on time."
//
// De aangedane zijde doet er 2,4 s over, de gezonde 2,0 s. De aangedane is dus
// TRAGER en hoort onder de 100% te zitten. Met de hoger-is-beter-formule komt er
// 120% uit: dat leest als "aangedane zijde 20% beter dan gezond", en dat is
// precies omgekeerd.
{
  const involved = measured(2.4, "s");
  const uninvolved = measured(2.0, "s");

  const correct = lsi(involved, uninvolved, "lower_better");
  assert.ok(correct.ok);
  close(correct.value, (2.0 / 2.4) * 100); // 83,33%
  assert.ok(correct.value < 100, "de tragere aangedane zijde hoort onder 100%");

  // Wat er gebeurd zou zijn met de verkeerde richting. Geen foutmelding, een
  // plausibel getal, de verkeerde conclusie.
  const wrong = lsi(involved, uninvolved, "higher_better");
  assert.ok(wrong.ok);
  close(wrong.value, (2.4 / 2.0) * 100); // 120%
  assert.ok(wrong.value > 100);
  assert.notEqual(correct.value, wrong.value);
}

// Bij een krachtmetriek klopt hoger-is-beter wel: 280 N aangedaan tegen 350 N
// gezond is 80%.
{
  const r = lsi(measured(280, "n"), measured(350, "n"), "higher_better");
  assert.ok(r.ok);
  close(r.value, 80);
}

// Een richting zonder ordening heeft geen LSI. 'symmetrisch beter' betekent
// niets voor een streefbereik.
for (const direction of ["target_range", "neutral"] as const) {
  const r = lsi(measured(10, "n"), measured(10, "n"), direction);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "protocol_mismatch");
}

// ── 2. Niet gemeten is geen nul ──────────────────────────────────────────────
//
// Spec §12.1: "A metric can be unavailable rather than zero. Missing data and
// true zero are different states."
{
  const notMeasured = fromNullable(null, "n");
  assert.equal(notMeasured.ok, false);
  assert.equal(notMeasured.ok === false && notMeasured.reason, "missing_input");

  const realZero = fromNullable(0, "n");
  assert.ok(realZero.ok, "een gemeten nul is een waarde en geen gat");
  assert.equal(realZero.ok && realZero.value, 0);

  // En het verschil moet door de hele keten blijven bestaan: een ontbrekende
  // invoer levert geen 0% maar geen uitkomst.
  const missing = lsi(notMeasured, measured(350, "n"), "higher_better");
  assert.equal(missing.ok, false);

  const zero = lsi(realZero, measured(350, "n"), "higher_better");
  assert.ok(zero.ok, "0 N is meetbaar en levert 0% symmetrie");
  close(zero.value, 0);
}

// NaN en Infinity zijn geen metingen. Ze ontstaan uit een deling die ergens
// anders niet opgevangen is en horen niet in een grafiek terecht te komen.
for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(fromNullable(bad, "n").ok, false);
}

// ── 3. Onvergelijkbare eenheden leveren geen getal ───────────────────────────
//
// Spec §8 bij H:Q: "Do not combine NordBord N with knee-extension N blindly."
// De eenheidscontrole is wat dit bestand kan afdwingen; de hefboom- en
// hoekcontrole staat op het protocol en zit in de aanroeper.
{
  const mismatch = ratio(measured(300, "n"), measured(120, "nm"));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.ok === false && mismatch.reason, "unit_mismatch");

  const fine = ratio(measured(300, "n"), measured(350, "n"));
  assert.ok(fine.ok);
  close(fine.value, 300 / 350);
  assert.equal(fine.unit, "ratio");
}

// Deling door nul is geen oneindig grote ratio maar een onberekenbare.
{
  const r = ratio(measured(300, "n"), measured(0, "n"));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "zero_denominator");
}

// ── 4. N/kg en xBW zijn twee metrieken ───────────────────────────────────────
//
// Spec §8: "Force / (mass x 9.80665) -> xBW. Dimensionless. Do not mix with
// N/kg." Ze schelen een factor g en zijn in de bronbestanden door elkaar
// gehaald. Er is met opzet geen conversie tussen beide in units.ts.
{
  const force = measured(1420, "n");
  const ctx = { bodyMassKg: 72.5, bodyHeightCm: 178 };

  const perKg = perBodyMass(force, ctx);
  assert.ok(perKg.ok);
  assert.equal(perKg.unit, "n_per_kg");
  close(perKg.value, 1420 / 72.5);

  const perBw = perBodyWeight(force, ctx);
  assert.ok(perBw.ok);
  assert.equal(perBw.unit, "xbw");
  close(perBw.value, 1420 / (72.5 * GRAVITY));

  // Ze verschillen precies een factor g. Wie ze verwisselt leest 19,6 waar 2,0
  // hoorde te staan, en andersom.
  close(perKg.value / perBw.value, GRAVITY, 1e-9);

  // Zonder lichaamsmassa is er geen antwoord, en met opzet geen stille terugval
  // op het profiel: dat zou een oude meting hernormaliseren met een nieuw gewicht.
  const noMass = perBodyMass(force, { bodyMassKg: null, bodyHeightCm: 178 });
  assert.equal(noMass.ok, false);
  assert.equal(noMass.ok === false && noMass.reason, "no_body_mass");
}

// ── 5. Asymmetrie toont ook een richting ─────────────────────────────────────
//
// Spec §11: "Display direction (which side is lower/higher) in addition to
// magnitude." Alleen een percentage laat zien DAT er verschil is, niet waar.
{
  const { result, lowerSide } = asymmetry(measured(280, "n"), measured(350, "n"));
  assert.ok(result.ok);
  close(result.value, (70 / 350) * 100); // 20%
  assert.equal(lowerSide, "left");

  const mirrored = asymmetry(measured(350, "n"), measured(280, "n"));
  assert.ok(mirrored.result.ok);
  close(mirrored.result.value, 20, 1e-9);
  assert.equal(mirrored.lowerSide, "right", "zelfde grootte, andere kant");
}

// Een zijde gemeten is iets anders dan niets gemeten: daar kan de tester nog
// iets aan doen.
{
  const { result } = asymmetry(measured(280, "n"), unavailable("missing_input"));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "single_side_only");
}

// ── 6. 'Beste van drie' hangt af van de richting ─────────────────────────────
//
// Bij een sprong is de beste de hoogste, bij een 5-10-5 de snelste. Dezelfde
// fout als bij LSI, op een andere plek.
{
  const trials = [
    { trialNumber: 1, value: 2.4, valid: true },
    { trialNumber: 2, value: 2.1, valid: true },
    { trialNumber: 3, value: 2.6, valid: true },
  ];

  const fastest = select(trials, "best", "lower_better", "s");
  assert.ok(fastest.result.ok);
  close(fastest.result.value, 2.1);
  assert.equal(fastest.selected?.trialNumber, 2);

  const highest = select(trials, "best", "higher_better", "s");
  assert.ok(highest.result.ok);
  close(highest.result.value, 2.6);
}

// Een ongeldige poging telt nooit mee, ook niet in het gemiddelde.
{
  const trials = [
    { trialNumber: 1, value: 300, valid: true },
    { trialNumber: 2, value: 10, valid: false },
    { trialNumber: 3, value: 320, valid: true },
  ];

  const best = select(trials, "best", "higher_better", "n");
  assert.ok(best.result.ok);
  close(best.result.value, 320);

  const mean = select(trials, "mean", "higher_better", "n");
  assert.ok(mean.result.ok);
  close(mean.result.value, 310, 1e-9);
  assert.equal(mean.selected, null, "een gemiddelde is geen poging");

  const median = select(trials, "median", "higher_better", "n");
  assert.ok(median.result.ok);
  close(median.result.value, 310, 1e-9);
}

// Nul geldige pogingen is geen nul.
{
  const r = select([{ trialNumber: 1, value: 300, valid: false }], "best", "higher_better", "n");
  assert.equal(r.result.ok, false);
}

// ── 7. Optellen, middelen, verandering ───────────────────────────────────────
{
  // Totale schouderrotatie: IR + ER.
  const total = sum([measured(55, "deg"), measured(95, "deg")]);
  assert.ok(total.ok);
  close(total.value, 150);

  const mean = meanOf([measured(90, "cm"), measured(100, "cm"), measured(110, "cm")]);
  assert.ok(mean.ok);
  close(mean.value, 100);

  // mm en cm meten dezelfde grootheid en worden genormaliseerd; N en graden niet.
  const scaled = sum([measured(5, "cm"), measured(50, "mm")]);
  assert.ok(scaled.ok);
  close(scaled.value, 10);
  assert.equal(scaled.unit, "cm");

  assert.equal(sum([measured(5, "cm"), measured(5, "n")]).ok, false);
}

{
  const drop = percentChange(measured(1300, "n"), measured(1420, "n"));
  assert.ok(drop.ok);
  close(drop.value, ((1300 - 1420) / 1420) * 100);
  assert.ok(drop.value < 0);

  // Zonder baseline is er geen verandering, en dat is een eigen reden: het
  // scherm moet "nog geen baseline" zeggen en niet "0% verschil".
  const noRef = percentChange(measured(1300, "n"), unavailable("missing_input"));
  assert.equal(noRef.ok, false);
  assert.equal(noRef.ok === false && noRef.reason, "no_baseline");
}

// ── 8. Genormaliseerde hopafstand ────────────────────────────────────────────
//
// Spec §17: een ACLR-studie vond <70% lichaamslengte geassocieerd met lagere
// return-to-sport. Dat is een absolute-capaciteitsmaat naast LSI, omdat
// symmetrie een bilateraal tekort kan maskeren.
{
  const r = perBodyHeight(measured(120, "cm"), { bodyMassKg: 72.5, bodyHeightCm: 178 });
  assert.ok(r.ok);
  close(r.value, (120 / 178) * 100);
  assert.equal(r.unit, "percent");
}

// ── 9. De motorversie is een getal dat meereist ──────────────────────────────
//
// medical.derived_results.engine_version. Zonder dit is achteraf niet te zien
// welke rijen nog een oude rekenfout dragen, en spec §10 voorspelt er al een
// (de bronbestanden noemen CMJ-RSI waar RSI-mod hoort).
assert.equal(typeof ENGINE_VERSION, "number");
assert.ok(ENGINE_VERSION >= 1);

console.log("screening-derive: LSI-richting, nul vs niet-gemeten, eenheden, N/kg vs xBW, selectie");
