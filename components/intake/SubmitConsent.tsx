"use client";

import { useTranslations } from "next-intl";
import { SectionLabel } from "@/components/intake/SectionLabel";

/**
 * De laatste vraag voor het indienen: mag de behandelaar een samenvatting zien?
 *
 * Twee knoppen, geen vinkje met een standaardwaarde. Een optionele toestemming
 * die al aangevinkt staat is geen toestemming, en een vinkje dat leeg blijft
 * omdat niemand het opmerkt is geen keuze. Beide antwoorden dienen de intake in;
 * alleen het delen verschilt.
 */
export function SubmitConsent({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (share: boolean) => void;
}) {
  const t = useTranslations("sharing");
  return (
    <section className="mx-4 mb-2 rounded-card bg-surface p-4 shadow-card ring-1 ring-hairline ring-inset">
      <SectionLabel>{t("title")}</SectionLabel>
      <p className="mt-2 text-sm text-ink">{t("body")}</p>

      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit(true)}
          className="rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
        >
          {t("share")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit(false)}
          className="rounded-md px-4 py-2.5 text-sm font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas disabled:opacity-40"
        >
          {t("keep")}
        </button>
      </div>

      <p className="mt-2.5 text-xs text-ink-faint">{t("note")}</p>
    </section>
  );
}
