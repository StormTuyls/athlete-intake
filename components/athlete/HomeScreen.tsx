"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { monthName } from "@/lib/intake/format";
import { toLocale, type Locale } from "@/lib/i18n/locale";
import { LocaleToggle } from "@/components/LocaleToggle";
import { cn } from "@/lib/cn";
import { SectionLabel } from "@/components/intake/SectionLabel";
import {
  ArrowRightIcon,
  ChatIcon,
  ImageIcon,
  PdfIcon,
} from "@/components/athlete/icons";
import { formatIntakeTitle } from "@/lib/intake/title";
import { ACCEPT_BY_TILE } from "@/lib/intake/uploads";
import { stashFiles } from "@/lib/intake/handoff";
import type { HomeData, HomeIntake } from "@/lib/intake/home";

/**
 * Scherm 02 uit het ontwerp: het thuisscherm van de atleet.
 *
 * De recente intakes dragen sinds kort wel de titel uit het ontwerp
 * ("Shoulder — right"). Dat stond hier bewust niet, omdat het scherm openstaat
 * op een telefoon in een kleedkamer, maar drie regels "Intake" onder elkaar
 * zijn onbruikbaar en dit is je eigen dossier achter je eigen login. Zie
 * lib/intake/title.ts.
 *
 * Eén afwijking van het ontwerp blijft: de voortgangsbalk toont secties en niet
 * "4 / 9". De taxonomie heeft zeven secties en 41 velden, dus negen bestaat
 * niet, en het getal komt uit dezelfde telling als de ring in het gesprek. Twee
 * plekken die hetzelfde anders berekenen is hoe een voortgangsbalk gaat liegen.
 */

type T = ReturnType<typeof useTranslations<"home">>;

/**
 * De drie tegels. De sleutel is tegelijk de berichtsleutel en de sleutel in
 * ACCEPT_BY_TILE, zodat een vierde tegel toevoegen niet op drie plekken hoeft.
 */
const TILES = [
  { key: "screenshot", Icon: ImageIcon },
  { key: "pdf", Icon: PdfIcon },
  { key: "whatsapp", Icon: ChatIcon },
] as const satisfies ReadonlyArray<{
  key: keyof typeof ACCEPT_BY_TILE;
  Icon: (props: { className?: string }) => React.ReactElement;
}>;

function greeting(t: T): string {
  const hour = new Date().getHours();
  if (hour < 12) return t("goodMorning");
  if (hour < 18) return t("goodAfternoon");
  return t("goodEvening");
}

/** Alleen de voornaam in de kop, zoals in het ontwerp. */
function firstName(name: string | null, t: T): string {
  if (!name) return t("fallbackName");
  return name.split(/\s+/)[0];
}

function statusText(intake: HomeIntake, t: T): string {
  if (intake.status === "approved") return t("statusApproved");
  if (intake.status === "in_review") return t("statusInReview");
  return t("statusComplete");
}

/**
 * "8 aug" bij een intake in de lijst.
 *
 * Gebruikt de maandnamen uit lib/intake/format.ts in plaats van een eigen
 * lijstje: dit scherm had er een tweede, en dan staat dezelfde maand in de
 * transcriptie anders dan in het overzicht.
 */
function shortDate(iso: string | null, locale: Locale): string {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.getDate()} ${monthName(date.getMonth(), locale)}`;
}

export function HomeScreen({ data }: { data: HomeData }) {
  const t = useTranslations("home");
  const tTitle = useTranslations("intakeTitle");
  const locale = toLocale(useLocale());

  // Eén keer opbouwen en niet per regel: de woorden hangen aan de taal van de
  // kijker, niet aan de intake.
  const titleLabels = {
    left: tTitle("left"),
    right: tTitle("right"),
    bilateral: tTitle("bilateral"),
    fallback: tTitle("fallback"),
  };
  const router = useRouter();
  const pickers = useRef<Partial<Record<(typeof TILES)[number]["key"], HTMLInputElement | null>>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * De intake openen of hervatten, eventueel met bestanden in de hand.
   *
   * De bestanden gaan niet vanaf hier de deur uit. Ze worden doorgegeven aan
   * het gesprek, en dat uploadt ze langs het pad dat er al is, met de
   * bestandsbubbel en de voortgang op de plek waar de atleet ze verwacht.
   */
  async function openWith(files?: File[]) {
    setBusy(true);
    setError(null);
    try {
      // Geen locale meesturen: de server neemt die van de atleet. Dit stond
      // hier hard op "en", en app/api/intake/route.ts gaf de body voorrang op
      // athletes.locale, dus een Nederlandstalige atleet kreeg een Engelse
      // intake.
      const response = await fetch("/api/intake", { method: "POST" });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? t("couldNotStart"));
      }
      // Pas nadat de intake er is. Klapt de aanroep hierboven, dan blijft de
      // atleet hier staan en mogen er geen bestanden klaarstaan voor een
      // scherm dat hij nooit te zien krijgt.
      if (files?.length) stashFiles(files);
      router.push("/intake");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("couldNotStart"));
      setBusy(false);
    }
  }

  const open = () => openWith();

  const progress = data.inProgress;

  return (
    <main className="mx-auto min-h-dvh max-w-[30rem] bg-canvas px-4 pt-6 pb-10">
      <header className="flex items-start justify-between px-1">
        <div>
          <SectionLabel>{greeting(t)}</SectionLabel>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">
            {firstName(data.displayName, t)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <LocaleToggle />
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-chip px-2.5 py-1 text-label uppercase text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-surface"
            >
              {t("signOut")}
            </button>
          </form>
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-chip bg-brand-600 text-xs font-semibold text-white"
            aria-hidden
          >
            {data.initials}
          </span>
        </div>
      </header>

      {/* De teal kaart uit het ontwerp: de enige echte actie op dit scherm. */}
      <section className="mt-6 rounded-card bg-brand-600 p-4 text-white">
        <SectionLabel className="text-white/70">{t("assistant")}</SectionLabel>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight">
          {progress ? t("continueTitle") : t("startTitle")}
        </h2>
        <p className="mt-1.5 text-sm text-white/85">
          {t("startBody")}
        </p>
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          className="mt-3.5 flex items-center gap-1.5 rounded-md bg-white/15 px-3.5 py-2 text-sm font-medium ring-1 ring-white/25 ring-inset transition-colors hover:bg-white/25 disabled:opacity-50"
        >
          {busy ? t("opening") : progress ? t("continue") : t("begin")}
          {!busy && <ArrowRightIcon className="size-4" />}
        </button>
      </section>

      {error && (
        <p className="mt-3 rounded-card border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {progress && (
        <section className="mt-3 rounded-card bg-surface p-4 shadow-card ring-1 ring-hairline ring-inset">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <span className="size-1.5 rounded-chip bg-warn" aria-hidden />
              {t("inProgress")}
            </span>
            <span className="text-xs tabular-nums text-ink-muted">
              {progress.sectionsDone} / {progress.sectionsTotal}
            </span>
          </div>

          {/* Segmenten, geen doorlopende balk: het ontwerp toont per sectie een
              blokje, en dat leest als "zoveel hoofdstukken af" in plaats van
              een percentage dat niets betekent. */}
          <div
            className="mt-2.5 flex gap-1"
            role="progressbar"
            aria-valuenow={progress.sectionsDone}
            aria-valuemin={0}
            aria-valuemax={progress.sectionsTotal}
            aria-label={`${progress.requiredFilled} of ${progress.requiredTotal} required fields complete`}
          >
            {Array.from({ length: progress.sectionsTotal }, (_, index) => (
              <span
                key={index}
                className={cn(
                  "h-1.5 flex-1 rounded-chip",
                  index < progress.sectionsDone ? "bg-brand-600" : "bg-hairline",
                )}
              />
            ))}
          </div>

          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-ink-muted">
              {progress.nextSection
                ? t("next", { section: progress.nextSection.toLowerCase() })
                : t("allAnswered")}
            </span>
            <button
              type="button"
              onClick={() => void open()}
              disabled={busy}
              className="shrink-0 text-xs font-medium text-brand-600 disabled:opacity-50"
            >
              {t("continue")}
            </button>
          </div>
        </section>
      )}

      {/* Quick add: een echte bestandskiezer per tegel, en dan door naar het
          gesprek. De upload zelf gebeurt daar, langs hetzelfde pad als de + in
          de invoerbalk: een tweede uploadpad naast het eerste zou zijn eigen
          fouten kunnen maken. Wat er NIET gebeurt is lezen. Het bestand ligt
          straks klaar in het gesprek met een knop erbij; tot die knop
          ingedrukt wordt komt er niets in het dossier. */}
      <section className="mt-6">
        <SectionLabel>{t("quickAdd")}</SectionLabel>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {TILES.map(({ key, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => pickers.current[key]?.click()}
              disabled={busy}
              className="flex flex-col items-center gap-1.5 rounded-card bg-surface px-2 py-3 shadow-card ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas disabled:opacity-50"
            >
              <Icon className="size-5 text-ink-muted" />
              <span className="text-xs text-ink">{t(key)}</span>
            </button>
          ))}
        </div>

        {TILES.map(({ key }) => (
          <input
            key={key}
            ref={(element) => {
              pickers.current[key] = element;
            }}
            type="file"
            multiple
            accept={ACCEPT_BY_TILE[key]}
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              // Leegmaken, anders vuurt hetzelfde bestand twee keer kiezen geen
              // change meer.
              event.target.value = "";
              if (files.length > 0) void openWith(files);
            }}
          />
        ))}
      </section>

      <section className="mt-6">
        <SectionLabel>{t("recent")}</SectionLabel>
        {data.recent.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">
            Nothing here yet. Your finished intakes will appear in this list.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline rounded-card bg-surface shadow-card ring-1 ring-hairline ring-inset">
            {data.recent.map((intake) => (
              <li key={intake.id}>
                <Link
                  href={`/report/${intake.id}`}
                  className="flex items-baseline justify-between gap-3 px-4 py-3 transition-colors hover:bg-canvas"
                >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    <span className="size-1.5 shrink-0 rounded-chip bg-brand-600" aria-hidden />
                    <span className="truncate">
                      {formatIntakeTitle(intake.title, titleLabels)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {statusText(intake, t)}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {shortDate(intake.submittedAt ?? intake.startedAt, locale)}
                </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
