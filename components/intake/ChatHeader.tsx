"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { ChevronLeftIcon } from "@/components/intake/icons";
import Link from "next/link";
import { ProgressRing } from "@/components/intake/ProgressRing";
import { formatIntakeTitle, type IntakeTitle } from "@/lib/intake/title";

/**
 * De vaste kop boven het gesprek.
 *
 * De ondertitel zegt waar de assistent nu naar vraagt. Die sectie komt van de
 * server, uit het eerste openstaande gat, niet uit het laatste bericht: na een
 * upload verspringt het onderwerp en dan zou de kop achterlopen.
 *
 * De kop zelf is "Intake-assistent" tot er een klacht bekend is, en daarna waar
 * dit gesprek over gaat. Dat is dezelfde titel als in de lijst op het
 * thuisscherm en in het dossieroverzicht van de coach, uit dezelfde afleiding:
 * je hoort een dossier op elk scherm bij dezelfde naam te kunnen noemen.
 */
export function ChatHeader({
  collecting,
  title = { kind: "none" },
  ready = false,
  reportHref = null,
  sectionsDone,
  sectionsTotal,
  requiredFilled,
  requiredTotal,
  backHref,
  className,
}: {
  /** Naam van de sectie waar nu naar gevraagd wordt, of null als alles beantwoord is. */
  collecting: string | null;
  /** Waar dit gesprek over gaat. 'none' zolang er nog niets bekend is. */
  title?: IntakeTitle;
  /**
   * Niets blokkeert indienen meer. Dan geen sectienaam tonen: de ring staat op
   * 7/7 en er tegelijk "Collecting: body measurements" bij zetten leest als een
   * tegenspraak, ook al zijn beide waar. De optionele velden mogen open blijven.
   */
  ready?: boolean;
  sectionsDone: number;
  sectionsTotal: number;
  requiredFilled: number;
  requiredTotal: number;
  /**
   * Waar de terugpijl heen gaat, of undefined om hem weg te laten.
   *
   * Een link en geen knop met een callback. Het is navigatie, dus cmd-klik,
   * middelklik en "openen in nieuw tabblad" horen te werken, en het werkt ook
   * als het JavaScript nog niet binnen is. Een button die router.back() doet
   * kan geen van drieen.
   */
  backHref?: string;
  /** Zet de ring om in een link naar het rapport. Null zolang de intake onbekend is. */
  reportHref?: string | null;
  className?: string;
}) {
  const t = useTranslations("chat");
  const tTitle = useTranslations("intakeTitle");
  // Eén keer opbouwen: hij staat twee keer in de boom, met en zonder link.
  const progress = t("progressLabel", {
    sectionsDone,
    sectionsTotal,
    required: requiredFilled,
    requiredTotal,
  });

  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex items-center gap-3 border-b border-hairline bg-surface/95 px-4 py-3 backdrop-blur",
        className,
      )}
    >
      {backHref && (
        <Link
          href={backHref}
          aria-label={t("back")}
          className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-chip text-ink-muted transition-colors hover:bg-canvas"
        >
          <ChevronLeftIcon className="size-5" />
        </Link>
      )}

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[0.9375rem] font-semibold text-ink">
          {formatIntakeTitle(title, {
            left: tTitle("left"),
            right: tTitle("right"),
            bilateral: tTitle("bilateral"),
            // Geen "Intake" hier: zolang er niets bekend is heet dit scherm naar
            // wat het is, en dat is de assistent.
            fallback: t("title"),
          })}
        </h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="size-1.5 shrink-0 rounded-chip bg-brand-600" aria-hidden />
          <span className="truncate">
            {ready
              ? t("collectingReady")
              : collecting
                ? t("collecting", { section: collecting.toLowerCase() })
                : t("collectingIdle")}
          </span>
        </p>
      </div>

      {/* De ring is de enige plek in het gesprek waar de stand staat, dus is hij
          ook de plek waar je op tikt om te zien wat er verzameld is. */}
      {reportHref ? (
        <Link
          href={reportHref}
          aria-label={t("openReport")}
          className="shrink-0 rounded-chip transition-opacity hover:opacity-80"
        >
          <ProgressRing
            done={sectionsDone}
            total={sectionsTotal}
            label={progress}
          />
        </Link>
      ) : (
        <ProgressRing
          done={sectionsDone}
          total={sectionsTotal}
          label={progress}
        />
      )}
    </header>
  );
}
