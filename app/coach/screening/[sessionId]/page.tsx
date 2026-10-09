import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import { getSession } from "@/lib/db/screening";

export async function generateMetadata() {
  const t = await getTranslations("titles");
  return { title: t("athlete"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

const BLOCK_LABELS: Record<string, string> = {
  anthropometry: "Anthropometry",
  mobility_ll: "Mobility, lower limb",
  mobility_ul: "Mobility, upper limb",
  core: "Core control",
  movement_ll: "Movement quality",
  forcedecks: "Isometric push",
  strength_ul: "Upper-limb strength",
};

const UNIT_LABELS: Record<string, string> = {
  deg: "°", cm: "cm", n: "N", xbw: "×BW", score: "", percent: "%",
  hand_lengths: " hand lengths",
};

/**
 * De band als kleur, met het getal ervoor.
 *
 * Spec §11: "Use colour as a secondary signal, never as the only meaning. Always
 * show the numeric value and reference." Vandaar dat de kleur op een pil achter
 * de waarde zit en niet op de waarde zelf.
 */
function bandStyle(score: number | null): string {
  if (score === null) return "bg-canvas text-ink-muted";
  if (score <= 0) return "bg-danger-soft text-danger";
  if (score === 1) return "bg-warn-soft text-warn";
  return "bg-ok/10 text-ok";
}

/** Waarom er geen waarde of geen band is, in de taal van de tester. */
function explain(reason: string | null): string {
  switch (reason) {
    case "missing_input": return "not measured";
    case "single_side_only": return "only one side measured";
    case "zero_denominator": return "cannot be calculated";
    case "unit_mismatch": return "units do not match";
    case "no_body_mass": return "no body mass recorded";
    case "no_baseline": return "no earlier measurement";
    default: return reason ?? "unavailable";
  }
}

export default async function ScreeningSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();

  const access = await checkCoach();
  if (access.kind === "anonymous") {
    redirect(`/coach/login?next=/coach/screening/${sessionId}`);
  }
  if (access.kind !== "coach") notFound();

  const session = await getSession(sessionId, { id: access.coach.id });
  if (!session) notFound();

  const blocks = new Map<string, typeof session.results>();
  for (const row of session.results) {
    const list = blocks.get(row.block) ?? [];
    list.push(row);
    blocks.set(row.block, list);
  }
  // Zelfde volgorde als het invoerscherm; zie de toelichting daar.
  const blockOrder = Object.keys(BLOCK_LABELS);
  const ordered = [...blocks].sort(
    (a, b) => (blockOrder.indexOf(a[0]) + 1 || 99) - (blockOrder.indexOf(b[0]) + 1 || 99),
  );

  const unclassified = session.results.filter(
    (r) => r.kind === "absolute" && r.status === "computed" && r.bandStatus === null,
  ).length;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href={`/coach/athletes/${session.athleteId}`}
        className="text-xs text-ink-muted underline"
      >
        {session.athleteName ?? "Athlete"}
      </Link>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Screening {session.occurredOn}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {session.bodyMassKg ? `${session.bodyMassKg} kg` : "body mass not recorded"}
          {session.notes ? ` · ${session.notes}` : ""}
        </p>
      </header>

      {ordered.map(([block, rows]) => (
        <section key={block} className="mb-8">
          <h2 className="mb-1 text-sm font-medium">{BLOCK_LABELS[block] ?? block}</h2>
          <ul className="divide-y divide-hairline border-t border-hairline">
            {rows.map((row, index) => (
              <li
                key={`${row.metricKey}-${row.kind}-${row.side}-${index}`}
                className="flex items-baseline justify-between gap-4 py-2"
              >
                <span className="min-w-0 text-sm">
                  {row.testLabel}
                  <span className="ml-1.5 text-xs text-ink-faint">
                    {row.kind === "asymmetry"
                      ? "asymmetry"
                      : row.kind === "delta"
                        ? `vs previous${row.side === "left" ? ", left" : row.side === "right" ? ", right" : ""}`
                        : row.side === "left"
                        ? "left"
                        : row.side === "right"
                          ? "right"
                          : ""}
                  </span>
                </span>

                <span className="flex shrink-0 items-baseline gap-2">
                  {/* Het getal eerst, dan pas de duiding. Spec §11. */}
                  {row.status === "computed" && row.value !== null ? (
                    <span className="text-sm tabular-nums">
                      {row.value.toFixed(row.kind === "asymmetry" ? 1 : row.decimals)}
                      <span className="text-ink-faint">
                        {UNIT_LABELS[row.unit] ?? ` ${row.unit}`}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-ink-faint">
                      {explain(row.unavailableReason)}
                    </span>
                  )}

                  {/* Spec §11: de teller en de noemer naast de uitkomst. Een
                      asymmetrie van 17% zegt niets zonder te weten of dat 70 en
                      84 is of 7 en 8,4, en al helemaal niet welke kant lager is. */}
                  {row.kind === "asymmetry" && row.inputs && (
                    <span className="text-xs whitespace-nowrap text-ink-faint tabular-nums">
                      L {row.inputs.left ?? "-"} · R {row.inputs.right ?? "-"}
                      {typeof row.inputs.left === "number" &&
                        typeof row.inputs.right === "number" &&
                        row.inputs.left !== row.inputs.right &&
                        ` · ${row.inputs.left < row.inputs.right ? "left" : "right"} lower`}
                    </span>
                  )}

                  {/* Laag 1 uit spec §5 levert een verandering, geen oordeel.
                      De vorige waarde staat erbij, want "-8%" is pas leesbaar
                      als "van 84 naar 77". */}
                  {row.kind === "delta" && (
                    <span className="text-xs whitespace-nowrap text-ink-faint tabular-nums">
                      {typeof row.inputs?.previous === "number"
                        ? `was ${row.inputs.previous}`
                        : "protocol changed"}
                    </span>
                  )}

                  {row.bandStatus && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap ${bandStyle(row.bandScore)}`}
                    >
                      {row.bandStatus.replace(/_/g, " ")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {unclassified > 0 && (
        /* Niet verstoppen dat een deel ongeclassificeerd blijft. Spec §10 en
           §18: bij deze tests staat de tekenconventie of de bandindeling niet
           vast, en een scherm dat daarover zwijgt laat de lezer denken dat de
           waarde goed was. */
        <p className="border-t border-hairline pt-3 text-xs text-ink-faint">
          {unclassified} {unclassified === 1 ? "measurement has" : "measurements have"} no
          band. Those tests have a protocol or scoring convention that is not
          confirmed yet, so the value is recorded and trended but not graded.
        </p>
      )}
    </main>
  );
}
