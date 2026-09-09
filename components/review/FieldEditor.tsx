"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { enumLabel } from "@/lib/dossier/enumLabels";
import { toLocale } from "@/lib/i18n/locale";

/**
 * Een veld corrigeren in het coachscherm, met een invoer die bij het type past.
 *
 * Bewust niet EditValueForm hergebruikt, ook al lijkt het formulier erop. Dat
 * component is getypeerd op CaptureCard, waar `value` de weergavewaarde is
 * ("Specific prep", "Yes"), terwijl het reviewscherm de ruwe waarde uit het
 * dossier heeft (`specific_prep`, `true`). De twee laten samenvallen betekent
 * dat een van beide een string moet gaan doorgeven die de ander weer terug moet
 * parsen, en dat is precies het soort conversie waar een verkeerde waarde in het
 * dossier uit komt.
 *
 * Een select waar het kan, want validateValue keurt vrije tekst af bij een enum
 * of een datum en dan is het formulier een valstrik: de coach vult iets in en
 * krijgt een fout over iets wat hij niet kon weten.
 */

export interface EditableField {
  key: string;
  label: string;
  dataType: string;
  enumOptions: string[] | null;
  value: unknown;
}

function initialValue(field: EditableField): string {
  const { value } = field;
  if (value === null || value === undefined) return "";
  if (field.dataType === "boolean") return value === true ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (field.dataType === "enum" && field.enumOptions) {
    const raw = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
    return field.enumOptions.find((option) => option.toLowerCase() === raw) ?? "";
  }
  return String(value);
}

export function FieldEditor({
  field,
  busy,
  error,
  onSave,
  onCancel,
}: {
  field: EditableField;
  busy: boolean;
  error: string | null;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const locale = toLocale(useLocale());
  const [value, setValue] = useState(() => initialValue(field));

  const input =
    "w-full rounded-md border border-black/15 bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-black/50 dark:border-white/20 dark:focus-visible:border-white/60";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSave(value);
      }}
      className="mt-2 max-w-md space-y-2 sm:ml-52"
    >
      <label className="block">
        <span className="sr-only">{field.label}</span>

        {field.dataType === "enum" && field.enumOptions ? (
          <select
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={input}
            autoFocus
          >
            <option value="">-</option>
            {field.enumOptions.map((option) => (
              <option key={option} value={option}>
                {enumLabel(field.key, option, locale)}
              </option>
            ))}
          </select>
        ) : field.dataType === "boolean" ? (
          <select
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={input}
            autoFocus
          >
            <option value="">-</option>
            {/* De waarden blijven Yes en No omdat validateValue die leest; de
                coach ziet Nederlands. */}
            <option value="Yes">ja</option>
            <option value="No">nee</option>
          </select>
        ) : field.dataType === "long_text" ? (
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={3}
            className={`${input} resize-y`}
            autoFocus
          />
        ) : (
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            type={
              field.dataType === "number"
                ? "number"
                : field.dataType === "date"
                  ? "date"
                  : "text"
            }
            // Decimalen moeten kunnen: 76,5 kg is een echte waarde.
            step={field.dataType === "number" ? "any" : undefined}
            className={input}
            autoFocus
          />
        )}
      </label>

      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-black px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {busy ? "Bezig" : "Bewaren"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs ring-1 ring-black/15 ring-inset disabled:opacity-40 dark:ring-white/20"
        >
          Annuleren
        </button>
      </div>
    </form>
  );
}
