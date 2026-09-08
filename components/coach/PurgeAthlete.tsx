"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Het verwijderpad, voor de coach.
 *
 * Drie dingen die dit scherm moet doen, en die alle drie een reden hebben.
 *
 * Het moet zeggen wat er verdwijnt EN wat blijft. "Alles wordt verwijderd" is
 * niet waar: het audit-spoor blijft, met opzet, want bewijzen dat er verwijderd
 * is kan niet uit een leeg spoor. Dat hoort iemand te weten voordat hij het aan
 * de atleet uitlegt, en niet erna.
 *
 * Het moet zeggen dat het over de PERSOON gaat en niet over deze intake. De
 * knop staat op het atleetprofiel en niet op een dossier, en de opsomming noemt
 * elke intake die meegaat. Een coach die vanaf een intakescherm op wissen drukt
 * denkt aan die intake.
 *
 * En het vraagt om de naam, niet om een klik. Geen window.confirm: dat is een
 * dialoog die je wegklikt zonder te lezen, en dit is de enige handeling in deze
 * applicatie die niet terug te draaien is.
 */

export function PurgeAthlete({
  athleteId,
  athleteName,
  intakeCount,
  hasAccount,
}: {
  athleteId: string;
  athleteName: string | null;
  intakeCount: number;
  hasAccount: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Zonder naam valt er niets te typen; dan is de bevestiging het openen van
  // het blok plus de knop, en de server laat het ook door.
  const nameRequired = (athleteName ?? "").trim() !== "";
  const matches =
    !nameRequired || typed.trim().toLowerCase() === athleteName!.trim().toLowerCase();

  async function purge() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, confirmName: typed }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "verwijderen mislukt");

      const counts = (payload.counts ?? {}) as Record<string, number>;
      const rows = Object.values(counts).reduce((sum, n) => sum + Number(n), 0);
      setResult(
        `Verwijderd: ${rows} rijen, ${payload.storage?.removed ?? 0} bestanden${
          payload.account?.userDeleted ? ", en het inlogaccount" : ""
        }.`,
      );
      // De atleet bestaat niet meer, dus deze pagina ook niet. Naar de lijst.
      setTimeout(() => router.push("/coach"), 1500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "verwijderen mislukt");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <section className="mt-8 rounded-lg border border-hairline p-4">
        <h2 className="text-sm font-medium">Verwijderd</h2>
        <p className="mt-1 text-xs text-ink-muted">{result}</p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-lg border border-danger/40 bg-danger/5 p-4">
      <h2 className="text-sm font-medium text-danger">Atleet verwijderen</h2>

      {!open ? (
        <>
          <p className="mt-1 text-xs text-ink-muted">
            Op verzoek van de atleet, of wanneer de bewaartermijn verstreken is.
            Dit gaat over de persoon en niet over één intake.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 rounded-md px-3 py-1.5 text-xs font-medium text-danger ring-1 ring-danger/40 ring-inset transition-colors hover:bg-danger/10"
          >
            Verwijderen voorbereiden
          </button>
        </>
      ) : (
        <>
          <div className="mt-2 space-y-2 text-xs">
            <p className="font-medium text-ink">Wat verdwijnt</p>
            <ul className="list-disc space-y-0.5 pl-4 text-ink-muted">
              <li>
                {intakeCount === 1
                  ? "de intake van deze atleet"
                  : `alle ${intakeCount} intakes van deze atleet`}
                , met het dossier, de voorstellen en de rapportversies
              </li>
              <li>alle aangeleverde documenten en de tekst die eruit gehaald is</li>
              <li>de blessuretijdlijn, testmetingen en het gesprek</li>
              <li>de toestemmingsregistratie</li>
              {hasAccount && <li>het inlogaccount van de atleet</li>}
              <li>
                de kaart in Notion wordt leeggemaakt en gearchiveerd; Notion kent
                geen definitief verwijderen via de API
              </li>
            </ul>

            <p className="pt-1 font-medium text-ink">Wat blijft</p>
            <ul className="list-disc space-y-0.5 pl-4 text-ink-muted">
              <li>
                het audit-spoor: wie wat wanneer deed, met aantallen en zonder
                waarden. Zonder dat is niet aan te tonen dat er verwijderd is.
              </li>
            </ul>

            <p className="pt-1 text-ink-muted">Dit is niet terug te draaien.</p>
          </div>

          {nameRequired && (
            <label className="mt-3 block">
              <span className="text-xs text-ink-muted">
                Typ de naam van de atleet om te bevestigen:{" "}
                <strong className="text-ink">{athleteName}</strong>
              </span>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                className="mt-1 w-full max-w-sm rounded-md border border-hairline bg-surface px-3 py-2 text-sm outline-none focus-visible:border-danger"
                autoComplete="off"
              />
            </label>
          )}

          {error && <p className="mt-2 text-xs text-danger">{error}</p>}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={purge}
              disabled={busy || !matches}
              className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-40"
            >
              {busy ? "Bezig" : "Definitief verwijderen"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas disabled:opacity-40"
            >
              Annuleren
            </button>
          </div>
        </>
      )}
    </section>
  );
}
