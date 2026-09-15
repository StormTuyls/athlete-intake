"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * De uitgang uit een vastgelopen intake.
 *
 * Waarom dit er is: het gesprek kende maar één einde, en dat was alles
 * beantwoorden. De assistent stopt pas als er geen enkel gat meer open staat,
 * een gat sluit alleen met een waarde, en "dat weet ik niet" is geen waarde.
 * Wie strandde op een vraag die hij niet kon beantwoorden had geen knop, alleen
 * de tab sluiten, en de volgende keer stond hetzelfde gesprek er weer.
 *
 * Twee handelingen en niet een, want het zijn echt twee dingen. Iemand die
 * opnieuw wil beginnen wil meteen door; iemand die er vandaag klaar mee is wil
 * het alleen weg hebben. Een van de twee weglaten dwingt de ander in een omweg.
 *
 * Bevestiging in twee stappen en geen `confirm()`: dit wist medische gegevens
 * en de bestanden die de atleet zelf aanleverde, dus er hoort te staan WAT er
 * weggaat voordat iemand ja zegt. Een browserdialoog kan dat niet tonen en ziet
 * er bovendien uit als iets dat niet bij deze app hoort.
 *
 * De knop staat alleen bij een concept. Een ingediende intake is mogelijk al
 * door een behandelaar gelezen; die laat de databankfunctie ook niet weggooien.
 */
export function DiscardIntake({
  onDone,
  disabled = false,
}: {
  /**
   * Wat er na het weggooien moet gebeuren. `restart` is waar als de atleet
   * meteen een nieuw gesprek wil; de aanroeper beslist wat dat betekent, want
   * een nieuwe intake starten hoort bij het thuisscherm en niet hier.
   */
  onDone: (restart: boolean) => Promise<void> | void;
  disabled?: boolean;
}) {
  const t = useTranslations("home.discard");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(restart: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/intake/discard", { method: "POST" });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? t("failed"));
      }
      await onDone(restart);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("failed"));
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <div className="mt-2 text-right">
        <button
          type="button"
          onClick={() => setAsking(true)}
          disabled={disabled}
          className="text-xs text-ink-faint underline underline-offset-2 transition-colors hover:text-ink-muted disabled:opacity-50"
        >
          {t("start")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-card bg-canvas p-3 ring-1 ring-hairline ring-inset">
      <p className="text-xs leading-relaxed text-ink-muted">{t("warning")}</p>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void run(true)}
          disabled={busy}
          className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("busy") : t("restart")}
        </button>
        <button
          type="button"
          onClick={() => void run(false)}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-danger ring-1 ring-danger/30 ring-inset transition-colors hover:bg-danger-soft disabled:opacity-50"
        >
          {t("deleteOnly")}
        </button>
        <button
          type="button"
          onClick={() => {
            setAsking(false);
            setError(null);
          }}
          disabled={busy}
          className="text-xs text-ink-muted underline underline-offset-2 disabled:opacity-50"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
