"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { IntakeListRow } from "@/lib/db/review";

/**
 * De werklijst, gegroepeerd per atleet.
 *
 * Als platte lijst was dit onbruikbaar zodra een atleet een tweede intake had:
 * twaalf regels met dezelfde naam en een datum, waarin je moet turen welke de
 * laatste is. Een coach stelt hier twee vragen: "wat wacht op mij" en "waar staat
 * die ene atleet". Dus: één blok per atleet, nieuwste activiteit boven, een
 * zoekveld, en een filter voor wat op review wacht.
 *
 * Groeperen op athlete_id en niet op naam. Twee atleten van wie de naam nog niet
 * bekend is zijn niet dezelfde persoon, en die samenvoegen zou dossiers van
 * verschillende mensen onder één kop zetten.
 *
 * Filteren gebeurt in de browser en niet in de databank. Een praktijk heeft
 * tientallen atleten, geen tienduizenden, en zoeken zonder round trip voelt als
 * zoeken. Wordt de lijst ooit lang, dan hoort de filter in de query.
 *
 * Nog steeds alleen tellingen en statussen, geen medische inhoud: dit is de
 * pagina die openstaat terwijl er iemand meekijkt.
 */

interface AthleteGroup {
  athleteId: string;
  name: string | null;
  intakes: IntakeListRow[];
  lastActivity: string | null;
  waiting: number;
  conflicts: number;
}

/** Wacht dit dossier op de coach? Ingediend en nog niet afgetekend. */
function isWaiting(intake: IntakeListRow): boolean {
  return intake.status === "submitted" || intake.status === "in_review";
}

function activityOf(intake: IntakeListRow): string | null {
  return intake.submittedAt ?? intake.startedAt;
}

function groupByAthlete(intakes: IntakeListRow[]): AthleteGroup[] {
  const groups = new Map<string, AthleteGroup>();

  for (const intake of intakes) {
    const existing = groups.get(intake.athleteId);
    const group =
      existing ??
      {
        athleteId: intake.athleteId,
        name: null,
        intakes: [],
        lastActivity: null,
        waiting: 0,
        conflicts: 0,
      };

    group.intakes.push(intake);
    // De naam kan per intake verschillen: hij komt uit het account of, als dat
    // niets weet, uit het dossier van die ene intake. De eerste die iets zegt
    // wint, en de lijst komt al op nieuwste-eerst binnen.
    group.name = group.name ?? intake.athleteName;
    if (isWaiting(intake)) group.waiting += 1;
    group.conflicts += intake.conflicts;

    const activity = activityOf(intake);
    if (activity && (!group.lastActivity || activity > group.lastActivity)) {
      group.lastActivity = activity;
    }

    if (!existing) groups.set(intake.athleteId, group);
  }

  return [...groups.values()].sort((a, b) => {
    // Nieuwste activiteit boven. Een atleet zonder enige datum zakt naar
    // beneden in plaats van bovenaan te blijven hangen.
    if (a.lastActivity === b.lastActivity) return 0;
    if (!a.lastActivity) return 1;
    if (!b.lastActivity) return -1;
    return a.lastActivity > b.lastActivity ? -1 : 1;
  });
}

function statusLabel(intake: IntakeListRow): string {
  if (intake.status === "approved") return "approved";
  if (intake.status === "in_review") return "in review";
  if (intake.status === "submitted") return "waiting for review";
  return "in progress";
}

export function IntakeList({ intakes }: { intakes: IntakeListRow[] }) {
  const [search, setSearch] = useState("");
  const [onlyWaiting, setOnlyWaiting] = useState(false);

  const groups = useMemo(() => groupByAthlete(intakes), [intakes]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return groups.filter((group) => {
      if (onlyWaiting && group.waiting === 0) return false;
      if (needle === "") return true;
      return (group.name ?? "").toLowerCase().includes(needle);
    });
  }, [groups, search, onlyWaiting]);

  const waitingTotal = groups.reduce((sum, group) => sum + group.waiting, 0);

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
          {intakes.length === 0
            ? "No intakes yet."
            : "No athletes match that search."}
        </p>
      ) : (
        <ul className="space-y-5">
          {shown.map((group) => (
            <li key={group.athleteId}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="min-w-0 truncate text-sm font-medium">
                  {group.name ?? "Name unknown"}
                </h2>
                <span className="shrink-0 text-xs text-ink-faint">
                  {group.intakes.length === 1
                    ? "1 intake"
                    : `${group.intakes.length} intakes`}
                  {/* Alleen optellen als er iets op te tellen valt. Bij één
                      intake staat hetzelfde getal een regel lager al. */}
                  {group.conflicts > 0 && group.intakes.length > 1 && (
                    <span className="ml-2 text-warn">
                      {group.conflicts} to check
                    </span>
                  )}
                </span>
              </div>

              <ul className="mt-1 divide-y divide-hairline border-t border-hairline">
                {group.intakes.map((intake) => (
                  <li key={intake.id}>
                    <Link
                      href={`/review/${intake.id}`}
                      className="flex items-baseline justify-between gap-4 py-2 transition-colors hover:bg-canvas"
                    >
                      <span className="min-w-0 text-xs text-ink-muted">
                        <span
                          className={
                            isWaiting(intake) ? "font-medium text-ink" : undefined
                          }
                        >
                          {statusLabel(intake)}
                        </span>
                        {activityOf(intake) && ` · ${activityOf(intake)!.slice(0, 10)}`}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {intake.requiredFilled}/{intake.requiredTotal} required
                        {intake.conflicts > 0 && (
                          <span className="ml-2 text-warn">
                            {intake.conflicts} to check
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
