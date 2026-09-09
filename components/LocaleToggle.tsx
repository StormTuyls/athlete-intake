"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LOCALES } from "@/lib/i18n/locale";

/**
 * De taalknop, zoals in het ontwerp: NL | EN.
 *
 * Na de POST een router.refresh() en geen eigen toestand: de taal zit in een
 * httpOnly cookie dat de server leest, dus alleen de server weet wat er nu geldt.
 * Zou dit component de taal lokaal bijhouden, dan lopen de knop en het scherm
 * uiteen zodra de POST faalt.
 */
export function LocaleToggle({ className }: { className?: string }) {
  const router = useRouter();
  const active = useLocale();
  const t = useTranslations("toggle");
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(locale: string) {
    if (locale === active || pending) return;
    setBusy(locale);
    try {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={`inline-flex overflow-hidden rounded-full ring-1 ring-hairline ring-inset ${className ?? ""}`}
      role="group"
      aria-label={t("label")}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => choose(locale)}
          aria-current={locale === active ? "true" : undefined}
          disabled={busy !== null}
          className={
            locale === active
              ? "px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase bg-ink text-surface"
              : "px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase text-ink-muted transition-colors hover:bg-canvas disabled:opacity-50"
          }
        >
          {locale}
        </button>
      ))}
    </div>
  );
}
