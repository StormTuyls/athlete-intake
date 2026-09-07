"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { SectionLabel } from "@/components/intake/SectionLabel";
import {
  ArrowRightIcon,
  ChatIcon,
  ImageIcon,
  PdfIcon,
} from "@/components/athlete/icons";
import type { HomeData, HomeIntake } from "@/lib/intake/home";

/**
 * Scherm 02 uit het ontwerp: het thuisscherm van de atleet.
 *
 * Twee afwijkingen van het ontwerp, beide om dezelfde reden.
 *
 * De recente intakes staan er zonder omschrijving. Het ontwerp zet er
 * "Shoulder — right" bij, en dat is een diagnose op een overzichtspagina.
 * Dit is het scherm dat openstaat op een telefoon in een kleedkamer; de datum
 * en de status zijn genoeg om te kiezen welke je opent.
 *
 * De voortgangsbalk toont secties, niet "4 / 9". De taxonomie heeft zeven
 * secties en 41 velden, dus negen bestaat niet, en het getal komt uit dezelfde
 * telling als de ring in het gesprek. Twee plekken die hetzelfde anders
 * berekenen is hoe een voortgangsbalk gaat liegen.
 */

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Alleen de voornaam in de kop, zoals in het ontwerp. */
function firstName(name: string | null): string {
  if (!name) return "there";
  return name.split(/\s+/)[0];
}

function statusText(intake: HomeIntake): string {
  if (intake.status === "approved") return "Reviewed by your coach";
  if (intake.status === "in_review") return "With your coach";
  return "Complete · sent to coach";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function HomeScreen({ data }: { data: HomeData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: "en" }),
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? "could not start");
      }
      router.push("/intake");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not start");
      setBusy(false);
    }
  }

  const progress = data.inProgress;

  return (
    <main className="mx-auto min-h-dvh max-w-[30rem] bg-canvas px-4 pt-6 pb-10">
      <header className="flex items-start justify-between px-1">
        <div>
          <SectionLabel>{greeting()}</SectionLabel>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">
            {firstName(data.displayName)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-chip px-2.5 py-1 text-label uppercase text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-surface"
            >
              Sign out
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
        <SectionLabel className="text-white/70">AI intake assistant</SectionLabel>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight">
          {progress ? "Continue your intake" : "Start a new intake"}
        </h2>
        <p className="mt-1.5 text-sm text-white/85">
          Chat about your symptoms, pain and history. Upload scans or reports and
          the assistant does the rest.
        </p>
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          className="mt-3.5 flex items-center gap-1.5 rounded-md bg-white/15 px-3.5 py-2 text-sm font-medium ring-1 ring-white/25 ring-inset transition-colors hover:bg-white/25 disabled:opacity-50"
        >
          {busy ? "Opening" : progress ? "Continue" : "Begin"}
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
              Intake in progress
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
                ? `Next: ${progress.nextSection.toLowerCase()}`
                : "All questions answered"}
            </span>
            <button
              type="button"
              onClick={() => void open()}
              disabled={busy}
              className="shrink-0 text-xs font-medium text-brand-600 disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {/* Quick add: hetzelfde doel als de + in het gesprek, en dus dezelfde
          route. Openen en dan uploaden, in plaats van een tweede uploadpad dat
          los van het gesprek zijn eigen fouten kan maken. */}
      <section className="mt-6">
        <SectionLabel>Quick add</SectionLabel>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[
            { label: "Screenshot", Icon: ImageIcon },
            { label: "PDF", Icon: PdfIcon },
            { label: "WhatsApp", Icon: ChatIcon },
          ].map(({ label, Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => void open()}
              disabled={busy}
              className="flex flex-col items-center gap-1.5 rounded-card bg-surface px-2 py-3 shadow-card ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas disabled:opacity-50"
            >
              <Icon className="size-5 text-ink-muted" />
              <span className="text-xs text-ink">{label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <SectionLabel>Recent</SectionLabel>
        {data.recent.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">
            Nothing here yet. Your finished intakes will appear in this list.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline rounded-card bg-surface shadow-card ring-1 ring-hairline ring-inset">
            {data.recent.map((intake) => (
              <li
                key={intake.id}
                className="flex items-baseline justify-between gap-3 px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    <span className="size-1.5 rounded-chip bg-brand-600" aria-hidden />
                    Intake
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {statusText(intake)}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {shortDate(intake.submittedAt ?? intake.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
