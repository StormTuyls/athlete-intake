"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * Indelen aan- of uitzetten. Een update op de regel, geen nieuwe versie: de
 * drempels veranderen niet, alleen of ze gebruikt mogen worden.
 *
 * Historische uitkomsten veranderen niet mee. Die staan met hun band en hun
 * regel-id in medical.derived_results, dus een rapport van vorig jaar blijft
 * zeggen wat het zei.
 */
export function ClassificationToggle({
  ruleId,
  enabled,
  canEnable,
}: {
  ruleId: number;
  enabled: boolean;
  canEnable: boolean;
}) {
  const t = useTranslations("library");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/coach/reference-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "classification", ruleId, enabled: !enabled }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? t("saveFailed"));
      setBusy(false);
      return;
    }
    router.refresh();
    setBusy(false);
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy || (!enabled && !canEnable)}
        className="rounded border border-hairline px-3 py-1.5 text-xs disabled:opacity-40"
      >
        {enabled ? t("turnOff") : t("turnOn")}
      </button>
      {/* Een reeks met gaten mag niet indelen; de databank weigert het ook. */}
      {!enabled && !canEnable && (
        <span className="ml-2 text-xs text-ink-faint">{t("coverageHint")}</span>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
