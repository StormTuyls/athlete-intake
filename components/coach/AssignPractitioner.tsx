"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PractitionerKind } from "@/lib/db/practitioners";

/**
 * De behandelaar van een atleet, vanaf de coachkant.
 *
 * Een select en geen radiolijst zoals op het atleetprofiel: dit staat tussen
 * negen andere rijen op een overzichtspagina, en drie kaarten met initialen
 * zouden die pagina uit elkaar trekken voor een veld dat je zelden aanraakt.
 *
 * Opslaan gebeurt bij het wijzigen en niet met een knop ernaast. Het is één
 * waarde, de vorige staat er nog zichtbaar naast als het misgaat, en een
 * losse opslaan-knop voor één select is een knop die mensen vergeten.
 */
export function AssignPractitioner({
  athleteId,
  current,
  options,
}: {
  athleteId: string;
  current: string | null;
  options: Array<{ id: string; name: string | null; kind: PractitionerKind; archived: boolean }>;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(next: string) {
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch(`/api/coach/athletes/${athleteId}/practitioner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practitionerId: next }),
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? "could not save");
      }
      setSaved(true);
      router.refresh();
    } catch (caught) {
      // Terugzetten, anders toont het scherm een toewijzing die niet bestaat.
      setValue(previous);
      setError(caught instanceof Error ? caught.message : "could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        value={value}
        disabled={busy}
        onChange={(event) => void save(event.target.value)}
        aria-label="Assigned practitioner"
        className="rounded-md border border-hairline bg-surface px-2 py-1 text-sm text-ink disabled:opacity-50"
      >
        <option value="">Not assigned</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name ?? "Name unknown"} · {option.kind}
            {option.archived ? " (archived)" : ""}
          </option>
        ))}
      </select>
      {busy && <span className="text-xs text-ink-faint">saving…</span>}
      {saved && !busy && <span className="text-xs text-ok">saved</span>}
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
