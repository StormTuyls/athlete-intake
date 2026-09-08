"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AthleteListRow } from "@/lib/db/athletes";

/**
 * De werklijst: namen, en verder niets.
 *
 * Eerst stond hier elke intake, daarna elke intake gegroepeerd per atleet. Beide
 * versies vulden het scherm met statusregels waar je langs moest lezen om de
 * naam te vinden die je zocht. Een coach zoekt eerst een persoon en dan een
 * dossier, dus die volgorde staat nu in de pagina: één regel per atleet, klikken
 * geeft het profiel met zijn intakes.
 *
 * Wat er per regel bij staat is alleen wat de keuze bepaalt: wacht er iets op
 * mij, valt er iets na te kijken, wanneer was het laatst iets. Geen medische
 * inhoud, want dit is de pagina die openstaat terwijl er iemand meekijkt.
 */

export function AthleteList({ athletes }: { athletes: AthleteListRow[] }) {
  const [search, setSearch] = useState("");
  const [onlyWaiting, setOnlyWaiting] = useState(false);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return athletes.filter((athlete) => {
      if (onlyWaiting && athlete.waiting === 0) return false;
      if (needle === "") return true;
      return (athlete.name ?? "").toLowerCase().includes(needle);
    });
  }, [athletes, search, onlyWaiting]);

  const waitingTotal = athletes.reduce((sum, athlete) => sum + athlete.waiting, 0);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          type="search"
          placeholder="Search by name"
          aria-label="Search athletes by name"
          className="min-w-0 flex-1 rounded-md border border-hairline bg-surface px-3 py-2 text-sm outline-none focus-visible:border-brand-500"
        />
        <button
          type="button"
          onClick={() => setOnlyWaiting((current) => !current)}
          aria-pressed={onlyWaiting}
          className={
            onlyWaiting
              ? "shrink-0 rounded-md bg-ink px-3 py-2 text-xs font-medium text-surface"
              : "shrink-0 rounded-md px-3 py-2 text-xs font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
          }
        >
          Waiting for review{waitingTotal > 0 && ` (${waitingTotal})`}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-ink-faint">
          {athletes.length === 0 ? "No athletes yet." : "No athletes match that search."}
        </p>
      ) : (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {shown.map((athlete) => (
            <li key={athlete.id}>
              <Link
                href={`/coach/athletes/${athlete.id}`}
                className="flex items-baseline justify-between gap-4 py-3 transition-colors hover:bg-canvas"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {athlete.name ?? "Name unknown"}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {athlete.intakeCount === 1
                      ? "1 intake"
                      : `${athlete.intakeCount} intakes`}
                    {athlete.lastActivity && ` · ${athlete.lastActivity.slice(0, 10)}`}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  {athlete.waiting > 0 && (
                    <span className="block font-medium text-ink">
                      {athlete.waiting === 1
                        ? "waiting for review"
                        : `${athlete.waiting} waiting for review`}
                    </span>
                  )}
                  {athlete.conflicts > 0 && (
                    <span className="block text-warn">{athlete.conflicts} to check</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
