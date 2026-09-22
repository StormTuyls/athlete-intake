"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AthleteListRow } from "@/lib/db/athletes";
import { InviteAthlete } from "@/components/coach/InviteAthlete";

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
  const [inviting, setInviting] = useState(false);
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
        <button
          type="button"
          onClick={() => setInviting((current) => !current)}
          aria-expanded={inviting}
          className="shrink-0 rounded-md px-3 py-2 text-xs font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
        >
          {inviting ? "Cancel" : "Invite athlete"}
        </button>
      </div>

      {/* Dichtgeklapt tenzij ernaar gevraagd. Dit scherm is een werklijst en geen
          invoerformulier: uitnodigen gebeurt af en toe, zoeken de hele dag. */}
      {inviting && <InviteAthlete onDone={() => setInviting(false)} />}

      {shown.length === 0 ? (
        <p className="text-sm text-ink-faint">
          {athletes.length === 0 ? "No athletes yet." : "No athletes match that search."}
        </p>
      ) : (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {shown.map((athlete) => (
            <li key={athlete.id}>
              {/* Onder lg: naam met de telling eronder, status rechts. Precies
                  wat het was. Vanaf lg schuift de telling naar een eigen kolom,
                  zodat de datums onder elkaar staan. Dat is het verschil tussen
                  een lijst waar je langs leest en een lijst waar je langs kijkt;
                  op 375 pixels is die kolom er niet, daar telt alleen dat de
                  naam heel blijft. */}
              <Link
                href={`/coach/athletes/${athlete.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-3 transition-colors hover:bg-canvas lg:grid-cols-[minmax(0,1fr)_13rem_11rem]"
              >
                <span className="col-start-1 truncate text-sm font-medium">
                  {athlete.name ?? "Name unknown"}
                </span>
                <span className="col-start-1 text-xs text-ink-muted lg:col-start-2 lg:row-start-1">
                  {/* Een uitnodiging die nog niet is aangenomen heeft geen
                      intakes om te tellen, en "0 intakes" zegt niet waarom.
                      Dat hij nog niet binnen is geweest, wel. */}
                  {athlete.invited
                    ? "invited, not signed in yet"
                    : athlete.intakeCount === 1
                      ? "1 intake"
                      : `${athlete.intakeCount} intakes`}
                  {athlete.lastActivity && ` · ${athlete.lastActivity.slice(0, 10)}`}
                </span>
                <span className="col-start-2 row-span-2 row-start-1 text-right text-xs lg:col-start-3 lg:row-span-1">
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
