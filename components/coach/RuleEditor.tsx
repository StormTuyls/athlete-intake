"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Band } from "@/lib/screening/bands";

/**
 * Een nieuwe versie van een referentieregel invoeren.
 *
 * Geen vrij tekstveld met JSON erin, maar een rij per band. De vorm die de
 * databank verwacht (oplopend, halfopen, zonder overlap) is te moeilijk om
 * met de hand goed te typen, en een jsonb-kolom die de praktijk zelf vult is
 * precies waar een gesloten vorm voor bestaat.
 *
 * De server valideert opnieuw met dezelfde functie die de seed bewaakt. Dit
 * formulier maakt het invullen makkelijk, niet veilig.
 */

export interface RuleEditorProps {
  metricKey: string;
  unit: string;
  initial: {
    bands: Band[];
    coverage: "total" | "gapped";
    classificationEnabled: boolean;
    evidence: string;
    sourceCitation: string | null;
    sourceNote: string | null;
  };
}

type Row = { status: string; score: string; gte: string; lt: string };

const toRows = (bands: Band[]): Row[] =>
  bands.map((b) => ({
    status: b.status,
    score: b.score === null || b.score === undefined ? "" : String(b.score),
    gte: b.gte === undefined ? "" : String(b.gte),
    lt: b.lt === undefined ? "" : String(b.lt),
  }));

export function RuleEditor({ metricKey, unit, initial }: RuleEditorProps) {
  const t = useTranslations("library");
  const router = useRouter();

  const [rows, setRows] = useState<Row[]>(toRows(initial.bands));
  const [coverage, setCoverage] = useState(initial.coverage);
  const [enabled, setEnabled] = useState(initial.classificationEnabled);
  const [evidence, setEvidence] = useState(initial.evidence);
  const [citation, setCitation] = useState(initial.sourceCitation ?? "");
  const [note, setNote] = useState(initial.sourceNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (i: number, key: keyof Row, value: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: value } : row)));

  async function save() {
    setSaving(true);
    setError(null);

    const bands = rows.map((r) => ({
      status: r.status.trim(),
      // Leeg blijft leeg: een band zonder ondergrens is de onderste band, en
      // dat is iets anders dan een ondergrens van nul.
      ...(r.score.trim() === "" ? {} : { score: Number(r.score) }),
      ...(r.gte.trim() === "" ? {} : { gte: Number(r.gte) }),
      ...(r.lt.trim() === "" ? {} : { lt: Number(r.lt) }),
    }));

    const response = await fetch("/api/coach/reference-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "version",
        metricKey,
        bands,
        coverage,
        classificationEnabled: enabled,
        evidence,
        sourceCitation: citation.trim() === "" ? null : citation.trim(),
        sourceNote: note.trim() === "" ? null : note.trim(),
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? t("saveFailed"));
      setSaving(false);
      return;
    }
    router.refresh();
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">{t("bands")}</h3>
        <p className="mt-0.5 text-xs text-ink-faint">{t("boundaryHint")}</p>

        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-xs text-ink-muted">
              <th scope="col" className="py-1 text-left font-normal">{t("status")}</th>
              <th scope="col" className="py-1 text-left font-normal">{t("score")}</th>
              <th scope="col" className="py-1 text-left font-normal">
                {t("from")} <span className="text-ink-faint">{unit}</span>
              </th>
              <th scope="col" className="py-1 text-left font-normal">
                {t("to")} <span className="text-ink-faint">{unit}</span>
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-hairline">
                <td className="py-1 pr-2">
                  <input
                    aria-label={`${t("status")} ${i + 1}`}
                    value={row.status}
                    onChange={(e) => set(i, "status", e.target.value)}
                    className="w-full rounded border border-hairline bg-surface px-2 py-1 text-base"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`${t("score")} ${i + 1}`}
                    type="number" inputMode="numeric" min="0" max="3"
                    value={row.score}
                    onChange={(e) => set(i, "score", e.target.value)}
                    className="w-16 rounded border border-hairline bg-surface px-2 py-1 text-base"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`${t("from")} ${i + 1}`}
                    type="number" inputMode="decimal" step="any"
                    value={row.gte}
                    onChange={(e) => set(i, "gte", e.target.value)}
                    className="w-20 rounded border border-hairline bg-surface px-2 py-1 text-base"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`${t("to")} ${i + 1}`}
                    type="number" inputMode="decimal" step="any"
                    value={row.lt}
                    onChange={(e) => set(i, "lt", e.target.value)}
                    className="w-20 rounded border border-hairline bg-surface px-2 py-1 text-base"
                  />
                </td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                    className="text-xs text-ink-muted underline"
                  >
                    {t("removeBand")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button
          type="button"
          onClick={() => setRows((r) => [...r, { status: "", score: "", gte: "", lt: "" }])}
          className="mt-2 text-xs text-brand-700 underline"
        >
          {t("addBand")}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-muted">{t("coverage")}</span>
          <select
            value={coverage}
            onChange={(e) => setCoverage(e.target.value as "total" | "gapped")}
            className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
          >
            <option value="total">{t("total")}</option>
            <option value="gapped">{t("gapped")}</option>
          </select>
          <span className="mt-1 block text-xs text-ink-faint">{t("coverageHint")}</span>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-muted">{t("evidence")}</span>
          <select
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
          >
            <option value="source_sheet">{t("evidenceSourceSheet")}</option>
            <option value="published">{t("evidencePublished")}</option>
            <option value="internal">{t("evidenceInternal")}</option>
          </select>
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-xs text-ink-muted">{t("citation")}</span>
        <input
          value={citation}
          onChange={(e) => setCitation(e.target.value)}
          className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
        />
        <span className="mt-1 block text-xs text-ink-faint">{t("citationHint")}</span>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-xs text-ink-muted">{t("note")}</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
        />
        <span className="mt-1 block text-xs text-ink-faint">{t("noteHint")}</span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          {t("enable")}
          <span className="mt-0.5 block text-xs text-ink-faint">{t("enableHint")}</span>
        </span>
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving || rows.length === 0}
        className="rounded bg-brand-700 px-4 py-2 text-sm text-white disabled:opacity-40"
      >
        {saving ? t("saving") : t("saveVersion")}
      </button>
    </div>
  );
}
