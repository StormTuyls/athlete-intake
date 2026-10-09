"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * Invoerscherm voor een screening.
 *
 * Twee keuzes die het gedrag bepalen:
 *
 * 1. Een leeg veld is NIET nul. Het wordt null, en dat betekent "hoorde bij deze
 *    sessie, niet gemeten". Spec §12.1 eist dat onderscheid, en een
 *    number-input die bij leegmaken 0 doorgeeft zou het meteen weggooien.
 *
 * 2. Niets is verplicht. Een behandelaar die alleen de enkel bekijkt hoort geen
 *    volledige screening te hoeven invullen; FR-03 noemt dat micro-entry. De
 *    server weigert alleen een sessie waarin helemaal niets staat.
 */

export interface EntryTest {
  testKey: string;
  block: string;
  label: string;
  metricKey: string;
  unit: string;
  perSide: boolean;
  decimals: number;
  /** Of deze test op dit moment een band kan opleveren. */
  classifies: boolean;
  protocolConfirmed: boolean;
  note: string | null;
}

/** Alleen de volgorde; de namen komen uit de berichtencatalogus. */
const BLOCK_ORDER = [
  "anthropometry", "mobility_ll", "mobility_ul", "core",
  "movement_ll", "forcedecks", "strength_ul",
];

const UNIT_LABELS: Record<string, string> = {
  deg: "°",
  cm: "cm",
  n: "N",
  xbw: "×BW",
  score: "0–3",
  hand_lengths: "hand lengths",
};

type Values = Record<string, string>;

/** Leeg blijft leeg. Alleen een echt getal wordt een getal. */
function toValue(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ScreeningEntry({
  athleteId,
  tests,
}: {
  athleteId: string;
  tests: EntryTest[];
}) {
  const router = useRouter();
  const t = useTranslations("screening");
  const [values, setValues] = useState<Values>({});
  const [occurredOn, setOccurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [bodyMass, setBodyMass] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocks = useMemo(() => {
    const grouped = new Map<string, EntryTest[]>();
    for (const test of tests) {
      const list = grouped.get(test.block) ?? [];
      list.push(test);
      grouped.set(test.block, list);
    }
    // In de volgorde van BLOCK_LABELS en niet die van de query. De databank
    // sorteert op bloknaam, en alfabetisch komt 'forcedecks' dan tussen 'core'
    // en 'mobility_ll' te staan. Een screening loopt van meten naar bewegen naar
    // kracht; dat is de volgorde waarin een behandelaar hem ook afwerkt.
    return [...grouped].sort(
      (a, b) =>
        (BLOCK_ORDER.indexOf(a[0]) + 1 || 99) - (BLOCK_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [tests]);

  const filled = Object.values(values).filter((v) => v.trim() !== "").length;

  async function save() {
    setSaving(true);
    setError(null);

    const entries = tests.flatMap((test) =>
      (test.perSide ? (["left", "right"] as const) : (["bilateral"] as const))
        .map((side) => ({
          metricKey: test.metricKey,
          side,
          value: toValue(values[`${test.metricKey}|${side}`]),
        }))
        // Alleen wat de tester aanraakte gaat mee. Een sessie waarin elke test
        // van de bibliotheek als "niet gemeten" staat is onleesbaar: 26 lege
        // rijen zeggen minder dan de drie die hij wel deed.
        .filter((entry) => entry.value !== null),
    );

    const response = await fetch("/api/coach/screening", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        athleteId,
        occurredOn,
        bodyMassKg: toValue(bodyMass),
        notes: notes.trim() === "" ? null : notes.trim(),
        entries,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? t("saveFailed"));
      setSaving(false);
      return;
    }

    const body = await response.json();
    router.push(`/coach/screening/${body.sessionId}`);
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-muted">{t("date")}</span>
          <input
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
          />
        </label>
        <label className="text-sm">
          {/* Spec §8: relatieve kracht gebruikt de massa van DIE dag. Hij wordt
              op de sessie gekopieerd, niet uit het profiel gelezen. */}
          <span className="mb-1 block text-xs text-ink-muted">{t("bodyMass")}</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={bodyMass}
            onChange={(e) => setBodyMass(e.target.value)}
            className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
          />
        </label>
        <label className="text-sm sm:col-span-1">
          <span className="mb-1 block text-xs text-ink-muted">{t("context")}</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("contextHint")}
            className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
          />
        </label>
      </section>

      {blocks.map(([block, items]) => (
        <section key={block}>
          <h2 className="mb-2 text-sm font-medium">{t(`blocks.${block}` as "blocks.core")}</h2>
          <ul className="divide-y divide-hairline border-t border-hairline">
            {items.map((test) => (
              <li
                key={test.metricKey}
                className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <span className="block text-sm">{test.label}</span>
                  <span className="text-xs text-ink-faint">
                    {UNIT_LABELS[test.unit] ?? test.unit}
                    {/* Eerlijk zijn over wat dit getal straks oplevert. Een
                        tester die weet dat een test niet scoort, weet ook
                        waarom er later geen band staat. */}
                    {!test.classifies && ` · ${t("noBandYet")}`}
                    {!test.protocolConfirmed && ` · ${t("protocolNotFixed")}`}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {(test.perSide ? (["left", "right"] as const) : (["bilateral"] as const)).map(
                    (side) => (
                      <label key={side} className="flex items-center gap-1">
                        {test.perSide && (
                          <span className="w-3 text-[10px] text-ink-faint uppercase">
                            {side === "left" ? "L" : "R"}
                          </span>
                        )}
                        {test.unit === "score" ? (
                          <select
                            value={values[`${test.metricKey}|${side}`] ?? ""}
                            onChange={(e) =>
                              setValues((v) => ({
                                ...v,
                                [`${test.metricKey}|${side}`]: e.target.value,
                              }))
                            }
                            className="w-20 rounded border border-hairline bg-surface px-2 py-1.5 text-base"
                          >
                            <option value="">-</option>
                            {[0, 1, 2, 3].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="number"
                            inputMode="decimal"
                            step={test.decimals === 0 ? "1" : "0.1"}
                            value={values[`${test.metricKey}|${side}`] ?? ""}
                            onChange={(e) =>
                              setValues((v) => ({
                                ...v,
                                [`${test.metricKey}|${side}`]: e.target.value,
                              }))
                            }
                            /* 16px, anders zoomt iOS bij focus in op het veld. */
                            className="w-20 rounded border border-hairline bg-surface px-2 py-1.5 text-base"
                          />
                        )}
                      </label>
                    ),
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-hairline bg-canvas py-3">
        <span className="text-xs text-ink-muted">
          {filled === 0 ? t("nothingEntered") : t("measurements", { count: filled })}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={saving || filled === 0}
          className="rounded bg-brand-700 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {saving ? t("saving") : t("save")}
        </button>
      </div>
    </div>
  );
}
