import assert from "node:assert/strict";
import { type HistoryPoint, compare } from "../../lib/screening/baseline";

/**
 * Laag 1 uit spec §5, tegen twee fouten die allebei stil zijn.
 *
 *   1. Een lijn trekken dwars door een protocolwissel heen. Spec §4: een
 *      heupadductiewaarde is niet langs een oudere te leggen als de hefboom,
 *      hoek of positie veranderd is. De grafiek ziet er daarna prima uit.
 *   2. "Geen baseline" zeggen terwijl er wel historie is, alleen onder een ander
 *      protocol. Dat verbergt juist wat de behandelaar moet weten.
 */

const v1 = "protocol-v1";
const v2 = "protocol-v2";

const history: HistoryPoint[] = [
  { occurredAt: "2026-01-10T09:00:00Z", recordedAt: "2026-01-10T09:00:00Z", protocolId: v1, value: 300 },
  { occurredAt: "2026-04-12T09:00:00Z", recordedAt: "2026-04-12T09:00:00Z", protocolId: v1, value: 340 },
  { occurredAt: "2026-07-03T09:00:00Z", recordedAt: "2026-07-03T09:00:00Z", protocolId: v1, value: 320 },
];

const now = { value: 330, protocolId: v1, occurredAt: "2026-10-09T09:00:00Z", recordedAt: "2026-10-09T09:00:00Z" };

// ── 1. Waartegen vergeleken wordt, staat erbij ───────────────────────────────
//
// Spec §8: "Reference may be previous, baseline, PB or rolling mean; label
// explicitly." Dezelfde meting levert drie verschillende percentages op, en
// zonder het label is niet te zeggen welk er op het scherm staat.
{
  const previous = compare(now, history, "previous", "higher_better", "n");
  assert.ok(previous.reference.ok);
  assert.equal(previous.reference.value, 320, "previous is de meest recente, niet de eerste");
  assert.ok(previous.change.ok);
  assert.ok(previous.change.value > 0, "330 na 320 is vooruitgang");

  const first = compare(now, history, "first", "higher_better", "n");
  assert.ok(first.reference.ok);
  assert.equal(first.reference.value, 300);

  const best = compare(now, history, "best", "higher_better", "n");
  assert.ok(best.reference.ok);
  assert.equal(best.reference.value, 340, "het PR is de hoogste, niet de laatste");
  assert.ok(best.change.ok);
  assert.ok(best.change.value < 0, "330 tegen een PR van 340 is achteruit");

  assert.equal(previous.mode, "previous");
  assert.equal(best.n, 3);
}

// Bij een tijdmetriek is het PR de LAAGSTE. Dezelfde fout als bij LSI en bij
// 'beste van drie', op een derde plek.
{
  const times: HistoryPoint[] = [
    { occurredAt: "2026-01-10T09:00:00Z", recordedAt: "2026-01-10T09:00:00Z", protocolId: v1, value: 2.6 },
    { occurredAt: "2026-04-12T09:00:00Z", recordedAt: "2026-04-12T09:00:00Z", protocolId: v1, value: 2.1 },
  ];
  const best = compare(
    { value: 2.3, protocolId: v1, occurredAt: "2026-10-09T09:00:00Z", recordedAt: "2026-10-09T09:00:00Z" },
    times,
    "best",
    "lower_better",
    "s",
  );
  assert.ok(best.reference.ok);
  assert.equal(best.reference.value, 2.1);
  assert.ok(best.change.ok);
  assert.ok(best.change.value > 0, "2,3 s tegen een PR van 2,1 s is trager, dus positief verschil");
}

// Zonder ordening bestaat er geen persoonlijk record.
{
  const r = compare(now, history, "best", "neutral", "n");
  assert.equal(r.reference.ok, false);
  assert.equal(r.n, 3, "de historie is er wel, er is alleen geen beste");
}

// ── 2. Een protocolwissel breekt de lijn ─────────────────────────────────────
//
// De huidige meting staat onder v2, alle historie onder v1. Er is dus GEEN
// vergelijkbare voorganger, hoeveel metingen er ook staan.
{
  const underV2 = { value: 330, protocolId: v2, occurredAt: "2026-10-09T09:00:00Z", recordedAt: "2026-10-09T09:00:00Z" };
  const r = compare(underV2, history, "previous", "higher_better", "n");

  assert.equal(r.reference.ok, false);
  assert.equal(r.n, 0);
  assert.equal(
    r.reference.ok === false && r.reference.reason,
    "protocol_mismatch",
    "historie onder een ander protocol is een breuk, geen lege historie",
  );
}

// En een echte eerste meting is iets anders dan een breuk: daar is niets, en dat
// heet no_baseline.
{
  const r = compare(now, [], "previous", "higher_better", "n");
  assert.equal(r.reference.ok, false);
  assert.equal(r.reference.ok === false && r.reference.reason, "no_baseline");
  assert.equal(r.n, 0);
}

// ── 3. Latere metingen tellen niet mee ───────────────────────────────────────
//
// Een sessie die na de huidige komt mag geen baseline zijn. Bij het opnieuw
// doorrekenen van een oude sessie zou dat anders de toekomst inlezen.
{
  const withFuture: HistoryPoint[] = [
    ...history,
    { occurredAt: "2027-01-01T09:00:00Z", recordedAt: "2027-01-01T09:00:00Z", protocolId: v1, value: 999 },
  ];
  const r = compare(now, withFuture, "best", "higher_better", "n");
  assert.ok(r.reference.ok);
  assert.equal(r.reference.value, 340, "999 ligt na deze sessie en telt niet mee");
  assert.equal(r.n, 3);
}

console.log("screening-baseline: previous/first/best, protocolwissel, geen toekomst");

// ── 4. Twee screenings op dezelfde dag ──────────────────────────────────────
//
// Het formulier vraagt een datum en geen tijdstip, dus een ochtend- en een
// avondmeting krijgen hetzelfde occurredAt. Zonder tweede sleutel is geen van
// beide "voor" de andere en krijgt de tweede geen baseline, terwijl de eerste
// er gewoon staat. Dat is stil: er staat dan "nog geen baseline" bij een atleet
// met vijf eerdere metingen.
{
  const sameDay: HistoryPoint[] = [
    { occurredAt: "2026-10-09T00:00:00Z", recordedAt: "2026-10-09T09:15:00Z", protocolId: v1, value: 70 },
  ];

  const evening = compare(
    {
      value: 76,
      protocolId: v1,
      occurredAt: "2026-10-09T00:00:00Z",
      recordedAt: "2026-10-09T18:40:00Z",
    },
    sameDay,
    "previous",
    "higher_better",
    "n",
  );

  assert.ok(evening.reference.ok, "de ochtendmeting telt als baseline");
  assert.equal(evening.reference.value, 70);
  assert.ok(evening.change.ok && evening.change.value > 0, "76 na 70 is vooruit");

  // En andersom niet: de ochtendmeting mag de avondmeting niet als baseline
  // nemen. Anders verwijzen ze naar elkaar.
  const morning = compare(
    {
      value: 70,
      protocolId: v1,
      occurredAt: "2026-10-09T00:00:00Z",
      recordedAt: "2026-10-09T09:15:00Z",
    },
    [
      { occurredAt: "2026-10-09T00:00:00Z", recordedAt: "2026-10-09T18:40:00Z", protocolId: v1, value: 76 },
    ],
    "previous",
    "higher_better",
    "n",
  );
  assert.equal(morning.reference.ok, false, "wat later ingevoerd is, is geen baseline");
}
