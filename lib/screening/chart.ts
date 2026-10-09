/**
 * Meetkunde voor de verlooplijn. Zuiver, zoals de rest van lib/screening/.
 *
 * De reden dat dit een eigen bestand is en geen JSX: er zit één regel in die
 * niet mag wegglijden, en die is te testen zonder iets te renderen.
 *
 *   Een lijn loopt NOOIT door een protocolwissel heen.
 *
 * Spec §4 is daar onvoorwaardelijk over: een waarde onder een ander protocol is
 * niet langs de vorige te leggen. Een doorlopende lijn zegt het tegenovergestelde,
 * en zegt het overtuigend. De punten blijven staan, de verbinding verdwijnt.
 */

export type Side = "left" | "right" | "bilateral" | "unknown";

export interface TrendPoint {
  /** ISO-datum, YYYY-MM-DD. */
  readonly date: string;
  readonly value: number;
  readonly protocolId: string;
}

export interface TrendSeries {
  readonly side: Side;
  readonly points: readonly TrendPoint[];
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly plot: { x: number; y: number; w: number; h: number };
  /** Eén pad per aaneengesloten reeks onder hetzelfde protocol. */
  readonly paths: ReadonlyArray<{ side: Side; d: string }>;
  readonly marks: ReadonlyArray<{ side: Side; cx: number; cy: number; point: TrendPoint }>;
  readonly yTicks: ReadonlyArray<{ y: number; label: number }>;
  readonly xTicks: ReadonlyArray<{ x: number; label: string }>;
  /** Waar een protocolwissel zit, als verticale hairline met uitleg. */
  readonly breaks: ReadonlyArray<{ x: number }>;
  /** Het laatste punt per zijde: alleen die krijgt een label op de lijn. */
  readonly endpoints: ReadonlyArray<{ side: Side; cx: number; cy: number; value: number }>;
}

const PAD = { top: 10, right: 44, bottom: 20, left: 34 };

/** Een "nette" stap, zodat de as op ronde getallen eindigt. */
function niceStep(span: number): number {
  if (span <= 0) return 1;
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * mag) return m * mag;
  }
  return 10 * mag;
}

export function layout(
  series: readonly TrendSeries[],
  width = 320,
  height = 110,
): Layout {
  const all = series.flatMap((s) => s.points);
  const plot = {
    x: PAD.left,
    y: PAD.top,
    w: Math.max(1, width - PAD.left - PAD.right),
    h: Math.max(1, height - PAD.top - PAD.bottom),
  };

  if (all.length === 0) {
    return { width, height, plot, paths: [], marks: [], yTicks: [], xTicks: [], breaks: [], endpoints: [] };
  }

  // Alle unieke datums, oplopend. De x-as is ORDINAAL en niet op tijdschaal:
  // screenings staan maanden uit elkaar en op ongelijke afstanden, en dan drukt
  // een echte tijdschaal drie metingen van dezelfde week tot een vlek samen.
  const dates = [...new Set(all.map((p) => p.date))].sort();
  const xOf = (date: string) => {
    const i = dates.indexOf(date);
    if (dates.length === 1) return plot.x + plot.w / 2;
    return plot.x + (i / (dates.length - 1)) * plot.w;
  };

  const values = all.map((p) => p.value);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    // Eén waarde, of alles gelijk: geef de lijn lucht in plaats van een deling
    // door nul. Een vlakke lijn midden in het vak is het eerlijke beeld.
    lo -= 1;
    hi += 1;
  }
  const step = niceStep(hi - lo);
  const axisLo = Math.floor(lo / step) * step;
  const axisHi = Math.ceil(hi / step) * step;
  const yOf = (v: number) =>
    plot.y + plot.h - ((v - axisLo) / (axisHi - axisLo)) * plot.h;

  const paths: Array<{ side: Side; d: string }> = [];
  const marks: Layout["marks"] = [];
  const endpoints: Array<{ side: Side; cx: number; cy: number; value: number }> = [];

  for (const s of series) {
    const sorted = [...s.points].sort((a, b) => a.date.localeCompare(b.date));
    let run: TrendPoint[] = [];

    const flush = () => {
      if (run.length >= 2) {
        paths.push({
          side: s.side,
          d: run.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.date).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" "),
        });
      }
      run = [];
    };

    for (const p of sorted) {
      // De breuk: een nieuw protocol begint een nieuwe reeks.
      if (run.length > 0 && run[run.length - 1].protocolId !== p.protocolId) flush();
      run.push(p);
      (marks as Array<{ side: Side; cx: number; cy: number; point: TrendPoint }>).push({
        side: s.side,
        cx: xOf(p.date),
        cy: yOf(p.value),
        point: p,
      });
    }
    flush();

    const last = sorted[sorted.length - 1];
    if (last) {
      endpoints.push({ side: s.side, cx: xOf(last.date), cy: yOf(last.value), value: last.value });
    }
  }

  // Een protocolwissel geldt voor de hele test, dus hij wordt bepaald over alle
  // zijden samen: op de datum waarop het protocol verschilt van de vorige datum.
  const byDate = new Map<string, string>();
  for (const p of all) byDate.set(p.date, p.protocolId);
  const breaks: Array<{ x: number }> = [];
  for (let i = 1; i < dates.length; i++) {
    if (byDate.get(dates[i]) !== byDate.get(dates[i - 1])) {
      breaks.push({ x: (xOf(dates[i - 1]) + xOf(dates[i])) / 2 });
    }
  }

  const yTicks: Array<{ y: number; label: number }> = [];
  for (let v = axisLo; v <= axisHi + 1e-9; v += step) {
    yTicks.push({ y: yOf(v), label: Number(v.toFixed(2)) });
  }

  // Alleen de eerste en de laatste datum op de as: bij vier screenings passen
  // vier datums niet naast elkaar onder een vak van 320 pixels.
  const xTicks =
    dates.length === 1
      ? [{ x: xOf(dates[0]), label: dates[0] }]
      : [
          { x: xOf(dates[0]), label: dates[0] },
          { x: xOf(dates[dates.length - 1]), label: dates[dates.length - 1] },
        ];

  return { width, height, plot, paths, marks, yTicks, xTicks, breaks, endpoints };
}
