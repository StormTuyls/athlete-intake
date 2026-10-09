"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PRACTICE_NAME } from "@/lib/report/branding";
import { NightShell } from "@/components/athlete/NightShell";
import { ArrowRightIcon, CheckIcon } from "@/components/athlete/icons";

/**
 * De poort voor een uitgenodigde atleet.
 *
 * Wie zich zelf aanmeldt, tikt het vinkje op het aanmeldscherm en komt hier
 * nooit. Wie door de praktijk is uitgenodigd, heeft een account dat iemand
 * anders heeft aangemaakt, en dan is dit het eerste scherm: de praktijk kan een
 * account klaarzetten, maar niet instemmen namens iemand anders.
 *
 * Bewust hetzelfde donkere scherm en dezelfde zin als bij aanmelden. Dit is niet
 * een tweede, zwaardere toestemming; het is dezelfde toestemming op het moment
 * dat hij gegeven kan worden. Een eigen ontwerp zou suggereren dat er iets extra
 * gevraagd wordt.
 *
 * Er is geen knop om verder te gaan zonder. Dat is geen drukmiddel maar de
 * werkelijkheid: zonder grond om gezondheidsgegevens te verwerken is er niets te
 * tonen achter dit scherm. Wel een afmeldknop, want een verkeerd bezorgde
 * uitnodiging hoort een uitgang te hebben.
 */
export function ConsentGate({
  retention,
  email,
}: {
  retention: string;
  email: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("consentGate");
  const tAuth = useTranslations("auth");

  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/athlete/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Geen locale mee: die komt uit het taalcookie, want dat is de taal
        // waarin deze zin op het scherm stond.
        body: JSON.stringify({ consented: true }),
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? t("failed"));
      }
      router.replace("/home");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("failed"));
      setBusy(false);
    }
  }

  return (
    <NightShell
      headline={t("title")}
      intro={
        <>
          <p>{t("body", { practice: PRACTICE_NAME })}</p>
          {email && <p className="mt-2 text-xs">{t("who", { email })}</p>}
        </>
      }
      footer={tAuth("footer")}
    >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (consented && !busy) void submit();
          }}
          className="mt-7"
        >
          <label className="flex cursor-pointer gap-3 rounded-card border border-night-line bg-night-raised p-3.5">
            <span
              className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border ${
                consented ? "border-brand-500 bg-brand-500 text-night" : "border-night-line"
              }`}
            >
              {consented && <CheckIcon className="size-3" />}
            </span>
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
              className="sr-only"
            />
            <span className="text-xs leading-relaxed text-night-muted">
              {tAuth("consent")} {retention}
            </span>
          </label>

          {error && <p className="mt-4 text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={!consented || busy}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
          >
            {busy ? t("busy") : t("continue")}
            {!busy && <ArrowRightIcon className="size-4" />}
          </button>
        </form>

        <form action="/auth/signout" method="post" className="mt-5 text-center">
          <button
            type="submit"
            className="text-xs text-night-muted underline-offset-2 hover:underline"
          >
            {t("signOut")}
          </button>
        </form>
    </NightShell>
  );
}
