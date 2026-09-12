"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/browser";
import { LocaleToggle } from "@/components/LocaleToggle";
import { PRACTICE_NAME } from "@/lib/report/branding";

/**
 * Een nieuw wachtwoord kiezen na een herstelmail.
 *
 * De sessie is er al: de link ging langs /auth/callback en die heeft hem
 * opgezet. Hier wordt dus geen token uit de URL gelezen, en er staat er ook
 * geen in; dat scheelt een tweede plek waar een linkformaat afgehandeld moet
 * worden, en het houdt de token uit de adresbalk en uit de logs.
 *
 * Geen huidig wachtwoord, in tegenstelling tot het wijzigscherm op het profiel.
 * Wie hier komt is per definitie iemand die het niet meer weet; de mail is het
 * bewijs.
 *
 * Daarna naar de voordeur en niet naar een vast scherm: die stuurt een atleet
 * naar zijn thuisscherm en een behandelaar naar de werklijst.
 */
export function ResetPassword({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("password");
  const router = useRouter();

  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const longEnough = next.length >= 8;
  const matches = next === confirm;
  const canSubmit = longEnough && matches && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { error: update } = await createClient().auth.updateUser({ password: next });
      if (update) throw new Error(update.message);

      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("changeFailed"));
      setBusy(false);
    }
  }

  const field =
    "mt-1.5 w-full rounded-md border border-hairline bg-surface px-3.5 py-2.5 text-base outline-none focus-visible:border-brand-600";

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{PRACTICE_NAME}</h1>
        <LocaleToggle />
      </div>

      <h2 className="mt-6 text-lg font-semibold tracking-tight">{t("resetTitle")}</h2>

      {!signedIn ? (
        <>
          {/* Een verlopen of al gebruikte link levert geen sessie op. Dan is
              een wachtwoordveld tonen wreed: je typt iets in en het werkt
              niet, zonder te zeggen waarom. */}
          <p className="mt-1 text-sm text-ink-muted">{t("resetExpired")}</p>
          <Link
            href="/auth/forgot"
            className="mt-5 w-full rounded-md bg-brand-600 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            {t("requestNew")}
          </Link>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-muted">{t("resetIntro")}</p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void submit();
            }}
            className="mt-6"
          >
            <label className="block">
              <span className="text-label uppercase text-ink-faint">{t("new")}</span>
              <input
                value={next}
                onChange={(event) => setNext(event.target.value)}
                type="password"
                minLength={8}
                autoComplete="new-password"
                autoFocus
                className={field}
              />
            </label>

            <label className="mt-4 block">
              <span className="text-label uppercase text-ink-faint">{t("confirm")}</span>
              <input
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                type="password"
                minLength={8}
                autoComplete="new-password"
                className={field}
              />
            </label>

            {next.length > 0 && !longEnough && (
              <p className="mt-2 text-xs text-danger">{t("tooShort")}</p>
            )}
            {confirm.length > 0 && !matches && (
              <p className="mt-2 text-xs text-danger">{t("mismatch")}</p>
            )}
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-5 w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
            >
              {busy ? t("resetSaving") : t("resetSave")}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
