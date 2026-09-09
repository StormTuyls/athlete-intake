"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatScreen } from "@/components/intake/ChatScreen";
import { useTranslations } from "next-intl";

/**
 * De intake zoals de atleet hem doorloopt.
 *
 * Twee toestanden: het gesprek, en ingediend. De toestemmingsstap die hier
 * eerst voor stond is weg. Toestemming om gezondheidsgegevens te verwerken
 * hoort bij het account en wordt bij het aanmelden vastgelegd; hem bij elke
 * intake opnieuw vragen maakte het register niet sterker en leerde de atleet
 * vinkjes wegklikken.
 *
 * Wat wel per intake gevraagd wordt, is of een behandelaar een samenvatting mag
 * zien. Die vraag staat bij het indienen, want dat is het moment waarop het
 * dossier de deur uit gaat. Zie components/intake/SubmitConsent.tsx.
 *
 * Uploaden was ook een eigen stap. Dat zit nu in het gesprek zelf, zodat een
 * document er op elk moment bij kan in plaats van alleen vooraf.
 */

interface Completeness {
  total: number;
  filled: number;
  requiredTotal: number;
  requiredFilled: number;
  conflicts: number;
  readyToSubmit: boolean;
}

export function IntakeFlow() {
  const t = useTranslations("intake");
  const tError = useTranslations("errors");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notionCreated, setNotionCreated] = useState<boolean | null>(null);

  /**
   * Is deze intake al ingediend? Dan hoort er geen gesprek te openen.
   *
   * De sessie leeft dertig dagen, dus wie terugkomt op een ingediende intake
   * moet de bevestiging zien en niet opnieuw beginnen te typen.
   */
  useEffect(() => {
    let ignore = false;

    fetch("/api/intake/state")
      .then(async (response) => {
        if (ignore || !response.ok) return;
        const state = (await response.json()) as { status: string };
        if (!ignore && state.status !== "draft") setDone(true);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  const submit = useCallback(async (share: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/intake/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? t("notComplete"));

      setNotionCreated(payload.notion?.created ?? null);
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : tError("generic"));
    } finally {
      setBusy(false);
    }
  }, [t, tError]);

  // Niets tonen zolang niet vaststaat of dit een lopend of een ingediend
  // dossier is. Het gesprek laten opflitsen boven een ingediende intake leest
  // als "je moet opnieuw".
  if (loading) return null;

  if (done) {
    return (
      <main className="mx-auto max-w-[30rem] px-6 py-16 lg:min-h-dvh">
        <h1 className="text-xl font-semibold tracking-tight">{t("submitted")}</h1>
        <p className="mt-3 text-sm text-ink-muted">{t("submittedBody")}</p>
        {notionCreated && (
          <p className="mt-3 text-xs text-ink-faint">{t("submittedNotion")}</p>
        )}
        <a
          href="/home"
          className="mt-6 inline-block rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          Back to home
        </a>
      </main>
    );
  }

  return (
    <div className="lg:min-h-dvh lg:bg-backdrop">
      <ChatScreen onSubmit={submit} externalError={error} submitting={busy} />
    </div>
  );
}
