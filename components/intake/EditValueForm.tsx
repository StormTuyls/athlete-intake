"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CaptureCard } from "@/lib/intake/transcriptTypes";

/**
 * Een waarde corrigeren, met een invoerveld dat bij het veldtype past.
 *
 * Het type doet echt werk. Een vrij tekstveld voor een datum of een enum laat de
 * atleet iets intypen dat validateValue daarna afkeurt, en dan is het formulier
 * een valstrik: hij ziet een invoerveld, vult het in, en krijgt een foutmelding
 * over iets wat hij niet kon weten. Een select met de toegestane opties kan die
 * fout niet maken.
 */
/**
 * De kaart draagt de weergavewaarde, niet de ruwe waarde: een enum staat er als
 * "Specific prep" en niet als "specific_prep", en een boolean als "Yes". Een
 * select moet echter een van zijn eigen option-waarden krijgen, anders staat hij
 * leeg terwijl er wel iets bekend is.
 *
 * Voor booleans lost dat zichzelf op door de opties "Yes" en "No" te noemen:
 * validateValue leest die toch. Voor enums wordt de bijbehorende sleutel
 * teruggezocht, met dezelfde normalisatie die validateValue gebruikt.
 */
function initialValue(card: CaptureCard): string {
  if (card.dataType !== "enum" || !card.enumOptions) return card.value;

  const normalised = card.value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return card.enumOptions.find((option) => option.toLowerCase() === normalised) ?? "";
}

export function EditValueForm({
  card,
  busy,
  error,
  onSave,
  onCancel,
}: {
  card: CaptureCard;
  busy: boolean;
  error: string | null;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("chat");
  const [value, setValue] = useState(() => initialValue(card));

  const field = "w-full rounded-md border border-hairline bg-surface px-3 py-2 text-base text-ink outline-none focus-visible:border-brand-500";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSave(value);
      }}
      className="mt-2 space-y-2"
    >
      <label className="block">
        <span className="sr-only">{card.label}</span>

        {card.dataType === "enum" && card.enumOptions ? (
          <select
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={field}
            autoFocus
          >
            <option value="">-</option>
            {card.enumOptions.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        ) : card.dataType === "boolean" ? (
          <select
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={field}
            autoFocus
          >
            <option value="">-</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        ) : card.dataType === "long_text" ? (
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={3}
            className={`${field} resize-y`}
            autoFocus
          />
        ) : (
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            type={
              card.dataType === "number"
                ? "number"
                : card.dataType === "date"
                  ? "date"
                  : "text"
            }
            // Getallen mogen decimalen hebben: 76,5 kg is een echte waarde.
            step={card.dataType === "number" ? "any" : undefined}
            className={field}
            autoFocus
          />
        )}
      </label>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
        >
          {t("save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas disabled:opacity-40"
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
