import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach } from "@/lib/review/access";
import { listRules } from "@/lib/db/referenceRules";

export async function generateMetadata() {
  const t = await getTranslations("library");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

const BLOCK_ORDER = ["anthropometry", "mobility_ll", "mobility_ul", "core",
                     "movement_ll", "forcedecks", "strength_ul"];

/** Welke drempels er gelden, en welke daarvan mogen indelen. FR-02. */
export default async function LibraryPage() {
  const access = await checkCoach();
  if (access.kind === "anonymous") redirect("/coach/login?next=/coach/library");
  if (access.kind !== "coach") notFound();

  const rules = await listRules();
  const t = await getTranslations("library");
  const ts = await getTranslations("screening");
  const titles = await getTranslations("titles");
  const locale = await getLocale();
  const name = (r: { testLabelNl: string; testLabelEn: string }) =>
    locale === "nl" ? r.testLabelNl : r.testLabelEn;

  const byBlock = new Map<string, typeof rules>();
  for (const rule of rules) {
    const list = byBlock.get(rule.block) ?? [];
    list.push(rule);
    byBlock.set(rule.block, list);
  }
  const ordered = [...byBlock].sort(
    (a, b) => (BLOCK_ORDER.indexOf(a[0]) + 1 || 99) - (BLOCK_ORDER.indexOf(b[0]) + 1 || 99),
  );

  const grading = rules.filter((r) => r.classificationEnabled).length;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/coach" className="text-xs text-ink-muted underline">
        {titles("athletes")}
      </Link>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {grading}/{rules.length} {t("classifies")}
        </p>
        <p className="mt-2 max-w-prose text-xs text-ink-faint">{t("intro")}</p>
      </header>

      {rules.length === 0 ? (
        <p className="text-sm text-ink-faint">{t("noRules")}</p>
      ) : (
        ordered.map(([block, items]) => (
          <section key={block} className="mb-8">
            <h2 className="mb-1 text-sm font-medium">
              {ts(`blocks.${block}` as "blocks.core")}
            </h2>
            <ul className="divide-y divide-hairline border-t border-hairline">
              {items.map((rule) => (
                <li key={rule.id}>
                  <Link
                    href={`/coach/library/${encodeURIComponent(rule.metricKey)}`}
                    className="flex flex-col gap-1 py-2.5 transition-colors hover:bg-canvas sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm">{name(rule)}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                        {/* Kleur is niet het enige signaal: er staat tekst bij. */}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            rule.classificationEnabled
                              ? "bg-ok/10 text-ok"
                              : "bg-canvas text-ink-muted"
                          }`}
                        >
                          {rule.classificationEnabled ? t("classifies") : t("notClassifying")}
                        </span>
                        {!rule.protocolConfirmed && (
                          <span className="text-ink-faint">{t("protocolNotFixed")}</span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">
                      {t("version", { n: rule.version })} ·{" "}
                      {rule.bands.length} {t("bands").toLowerCase()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
