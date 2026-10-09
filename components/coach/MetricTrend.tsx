import { type TrendSeries, layout } from "@/lib/screening/chart";

/**
 * Het verloop van één metriek over de screenings heen. FR-12.
 *
 * Met opzet klein en zonder bibliotheek: wat deze grafiek moet kunnen (een
 * lijn die breekt bij een protocolwissel, een markering bij een blessure) is
 * precies wat een algemene grafiekbibliotheek lastig maakt. De rest van deze
 * codebase doet hetzelfde: geen tailwind-merge, geen iconenpakket, geen
 * pdf-bibliotheek.
 *
 * Drie regels uit de visualisatierichtlijn die hier zichtbaar zijn:
 *
 *   Kleur is nooit het enige onderscheid. Twee zijden, dus altijd een legenda,
 *   en het laatste punt draagt zijn waarde als tekst.
 *   Niet elk punt krijgt een getal. Dat leest niemand; de as en de tabel
 *   dragen de rest.
 *   Rasterlijnen zijn doorlopende haarlijnen, geen streepjes. Een streepjeslijn
 *   leest als een drempel, en dat is dit niet.
 */

const COLOR: Record<string, string> = {
  left: "var(--color-series-1)",
  right: "var(--color-series-2)",
  bilateral: "var(--color-series-1)",
  unknown: "var(--color-series-1)",
};

export interface TrendLabels {
  left: string;
  right: string;
  protocolChanged: string;
  injury: string;
}

export function MetricTrend({
  series,
  labels,
  events = [],
  decimals = 1,
}: {
  series: TrendSeries[];
  labels: TrendLabels;
  /** Gebeurtenissen op de tijdlijn, bv. de aanvang van een blessure. Spec §11. */
  events?: Array<{ date: string; label: string }>;
  decimals?: number;
}) {
  const l = layout(series);
  if (l.marks.length === 0) return null;

  // Vaste volgorde, niet die van de gegevens: anders staat links bij de ene
  // kaart vooraan en bij de volgende achteraan, en gaat de lezer zoeken.
  const ORDER = ["left", "right", "bilateral", "unknown"];
  const sides = [...new Set(series.filter((s) => s.points.length > 0).map((s) => s.side))]
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const sideLabel = (side: string) =>
    side === "left" ? labels.left : side === "right" ? labels.right : "";

  // Een gebeurtenis valt zelden precies op een meetdatum; hij wordt naar de
  // dichtstbijzijnde meting geschoven zodat hij binnen het vak blijft staan.
  const dates = [...new Set(l.marks.map((m) => m.point.date))].sort();
  const eventMarks = events
    .map((e) => {
      const nearest = dates.reduce((best, d) =>
        Math.abs(Date.parse(d) - Date.parse(e.date)) < Math.abs(Date.parse(best) - Date.parse(e.date)) ? d : best,
      dates[0]);
      const mark = l.marks.find((m) => m.point.date === nearest);
      return mark ? { x: mark.cx, label: e.label } : null;
    })
    .filter((e): e is { x: number; label: string } => e !== null);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${l.width} ${l.height}`}
        className="h-auto w-full max-w-[20rem]"
        role="img"
        aria-label={`${sides.map(sideLabel).join(", ")}`}
      >
        {/* Raster: doorlopende haarlijnen, één tint van het vlak af. */}
        {l.yTicks.map((tick) => (
          <g key={tick.label}>
            <line
              x1={l.plot.x} x2={l.plot.x + l.plot.w} y1={tick.y} y2={tick.y}
              stroke="var(--color-hairline)" strokeWidth="1"
            />
            <text
              x={l.plot.x - 5} y={tick.y + 3} textAnchor="end"
              className="fill-ink-faint text-[8px] tabular-nums"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* Een protocolwissel: doorlopende haarlijn, niet gestreept. */}
        {l.breaks.map((b, i) => (
          <line
            key={`b${i}`} x1={b.x} x2={b.x} y1={l.plot.y} y2={l.plot.y + l.plot.h}
            stroke="var(--color-ink-faint)" strokeWidth="1"
          >
            <title>{labels.protocolChanged}</title>
          </line>
        ))}

        {/* Een gebeurtenis, bv. de aanvang van een blessure. */}
        {eventMarks.map((e, i) => (
          <g key={`e${i}`}>
            <line
              x1={e.x} x2={e.x} y1={l.plot.y} y2={l.plot.y + l.plot.h}
              stroke="var(--color-warn)" strokeWidth="1" opacity="0.5"
            />
            <circle cx={e.x} cy={l.plot.y} r="2.5" fill="var(--color-warn)">
              <title>{e.label}</title>
            </circle>
          </g>
        ))}

        {l.paths.map((path, i) => (
          <path
            key={`p${i}`} d={path.d} fill="none"
            stroke={COLOR[path.side]} strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
          />
        ))}

        {/* Markers met een ring in de vlakkleur, zodat ze elkaar niet opeten. */}
        {l.marks.map((m, i) => (
          <circle
            key={`m${i}`} cx={m.cx} cy={m.cy} r="3.5"
            fill={COLOR[m.side]} stroke="var(--color-surface)" strokeWidth="2"
          >
            <title>
              {m.point.date} · {sideLabel(m.side)} {m.point.value}
            </title>
          </circle>
        ))}

        {/* Alleen het laatste punt draagt zijn waarde. */}
        {l.endpoints.map((e) => (
          <text
            key={e.side} x={e.cx + 7} y={e.cy + 3}
            className="text-[9px] tabular-nums"
            fill={COLOR[e.side]}
          >
            {e.value.toFixed(decimals)}
          </text>
        ))}

        {l.xTicks.map((tick) => (
          <text
            key={tick.label}
            x={tick.x} y={l.height - 6}
            textAnchor={tick.x > l.plot.x + l.plot.w / 2 ? "end" : "start"}
            className="fill-ink-faint text-[8px] tabular-nums"
          >
            {tick.label}
          </text>
        ))}
      </svg>

      {/* Bij twee reeksen hoort altijd een legenda: kleur mag niet het enige
          onderscheid zijn. Bij één reeks noemt de kop de metriek al. */}
      {sides.length > 1 && (
        <figcaption className="mt-1 flex gap-3 text-[10px] text-ink-muted">
          {sides.map((side) => (
            <span key={side} className="flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ background: COLOR[side] }}
              />
              {sideLabel(side)}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
