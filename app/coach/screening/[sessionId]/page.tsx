import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import { getSession } from "@/lib/db/screening";

export async function generateMetadata() {
  const t = await getTranslations("titles");
  return { title: t("athlete"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * Een screening terugkijken.
 *
 * Spec §11 in drie regels: het getal eerst en de duiding daarna, kleur als
 * tweede signaal en nooit als enige, en bij een verhouding de teller en de
 * noemer ernaast. Vandaar dat de band een pil achter de waarde is en niet een
 * kleur op de waarde zelf.
 *
 * Onderaan staat waar de banden vandaan komen (FR-08). Een drempel zonder bron
 * hoort niet in een medisch dossier, en bij de tests die NIET classificeren is
 * juist die noot het antwoord op "waarom staat hier geen band".
 */

/** De band als kleur, met het getal er altijd naast. */
function bandStyle(score: number | null): string {
  if (score === null) return "bg-canvas text-ink-muted";
  if (score <= 0) return "bg-danger-soft text-danger";
  if (score === 1) return "bg-warn-soft text-warn";
  return "bg-ok/10 text-ok";
}

const UNIT_SUFFIX: Record<string, string> = {
  deg: "°", cm: " cm", n: " N", xbw: "×BW", score: "", percent: "%",
  hand_lengths: "", mm: " mm", s: " s", kg: " kg",
};

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
  if (session === null) notFound();

  const t = await getTranslations("screening");
  // De testnamen staan in de databank in beide talen; de pagina kiest, zodat de
  // datalaag de locale niet hoeft te kennen.
  const locale = await getLocale();
  const name = (row: { testLabelNl: string; testLabelEn: string }) =>
    locale === "nl" ? row.testLabelNl : row.testLabelEn;

  const blocks = new Map<string, typeof session.results>();
  for (const row of session.results) {
    const list = blocks.get(row.block) ?? [];
    list.push(row);
    blocks.set(row.block, list);
  }
  // Zelfde volgorde als het invoerscherm: meten, bewegen, kracht.
  const order = ["anthropometry", "mobility_ll", "mobility_ul", "core",
                 "movement_ll", "forcedecks", "strength_ul"];
  const ordered = [...blocks].sort(
    (a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99),
  );

  const unclassified = session.results.filter(
    (r) => r.kind === "absolute" && r.status === "computed" && r.bandStatus === null,
  ).length;

  // Een regel per test, niet per rij: links en rechts delen hun referentieregel.
  //
  // Of hij classificeert volgt uit de ABSOLUTE rijen, niet uit de laatste rij
  // die toevallig in de map landt. Een delta- of asymmetrierij heeft per
  // ontwerp geen band, dus die zou elke test als "classificeert niet" tonen,
  // ook de tests waar hierboven gewoon een band bij staat.
  const rules = new Map<string, { row: Row; classifies: boolean }>();
  for (const row of session.results) {
    if (!row.ruleNote && !row.ruleSource) continue;
    const key = name(row);
    const entry = rules.get(key);
    const classifies = (entry?.classifies ?? false) || row.bandStatus !== null;
    rules.set(key, { row: entry?.row ?? row, classifies });
  }

  type Row = (typeof session.results)[number];

  function label(row: Row): string {
    if (row.kind === "asymmetry") return t("asymmetry");
    const side = row.side === "left" ? t("left") : row.side === "right" ? t("right") : "";
    if (row.kind === "delta") return side ? `${t("vsPrevious")}, ${side}` : t("vsPrevious");
    return side;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href={`/coach/athletes/${session.athleteId}`}
        className="text-xs text-ink-muted underline"
      >
        {session.athleteName ?? t("title")}
      </Link>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("title")} {session.occurredOn}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {session.bodyMassKg ? `${session.bodyMassKg} kg` : t("bodyMassMissing")}
          {session.notes ? ` · ${session.notes}` : ""}
        </p>
      </header>

      {ordered.map(([block, rows]) => (
        <section key={block} className="mb-8">
          <h2 className="mb-1 text-sm font-medium">
            {t(`blocks.${block}` as "blocks.core")}
          </h2>
          <ul className="divide-y divide-hairline border-t border-hairline">
            {rows.map((row, index) => (
              <li
                key={`${row.metricKey}-${row.kind}-${row.side}-${index}`}
                className="flex items-baseline justify-between gap-4 py-2"
              >
                <span className="min-w-0 text-sm">
                  {name(row)}
                  <span className="ml-1.5 text-xs text-ink-faint">{label(row)}</span>
                </span>

                <span className="flex shrink-0 items-baseline gap-2">
                  {/* Het getal eerst, dan pas de duiding. Spec §11. */}
                  {row.status === "computed" && row.value !== null ? (
                    <span className="text-sm tabular-nums">
                      {row.value.toFixed(row.kind === "absolute" ? row.decimals : 1)}
                      <span className="text-ink-faint">
                        {UNIT_SUFFIX[row.unit] ?? ` ${row.unit}`}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-ink-faint">
                      {t(
                        `unavailable.${row.unavailableReason ?? "missing_input"}` as
                          "unavailable.missing_input",
                      )}
                    </span>
                  )}

                  {/* Teller en noemer naast de uitkomst. Spec §11: een 'goede'
                      verhouding kan twee slechte absolute waarden verbergen. */}
                  {row.kind === "asymmetry" && row.inputs && (
                    <span className="text-xs whitespace-nowrap text-ink-faint tabular-nums">
                      L {row.inputs.left ?? "-"} · R {row.inputs.right ?? "-"}
                      {typeof row.inputs.left === "number" &&
                        typeof row.inputs.right === "number" &&
                        row.inputs.left !== row.inputs.right &&
                        ` · ${row.inputs.left < row.inputs.right ? t("lowerLeft") : t("lowerRight")}`}
                    </span>
                  )}

                  {row.kind === "delta" && (
                    <span className="text-xs whitespace-nowrap text-ink-faint tabular-nums">
                      {typeof row.inputs?.previous === "number"
                        ? t("was", { value: row.inputs.previous })
                        : t("protocolChanged")}
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
        <p className="mb-6 border-t border-hairline pt-3 text-xs text-ink-faint">
          {t("unclassified", { count: unclassified })}
        </p>
      )}

      {/* FR-08: herkomst van de regels. Zonder dit leest een behandelaar "poor"
          zonder enige manier om te vragen waar die drempel vandaan komt. */}
      {rules.size > 0 && (
        <details className="border-t border-hairline pt-3">
          <summary className="cursor-pointer text-xs text-ink-muted">
            {t("provenance")} ({rules.size})
          </summary>
          <p className="mt-2 text-xs text-ink-faint">{t("provenanceIntro")}</p>
          <dl className="mt-2 divide-y divide-hairline border-t border-hairline">
            {[...rules.values()].map(({ row, classifies }) => (
              <div key={name(row)} className="py-2">
                <dt className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="font-medium">{name(row)}</span>
                  {row.ruleEvidence && (
                    <span className="text-ink-muted">
                      {t(
                        `evidence.${row.ruleEvidence}` as "evidence.source_sheet",
                      )}
                    </span>
                  )}
                  {!classifies && (
                    <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted">
                      {t("classificationOff")}
                    </span>
                  )}
                  {!row.protocolConfirmed && (
                    <span className="text-ink-faint">· {t("protocolNotFixed")}</span>
                  )}
                </dt>
                {row.ruleNote && (
                  <dd className="mt-0.5 text-xs text-ink-faint">{row.ruleNote}</dd>
                )}
                {row.ruleSource && (
                  <dd className="mt-0.5 text-xs text-ink-faint">{row.ruleSource}</dd>
                )}
              </div>
            ))}
          </dl>
        </details>
      )}
    </main>
  );
}
