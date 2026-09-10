"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/browser";
import { LocaleToggle } from "@/components/LocaleToggle";
import { PRACTICE_NAME } from "@/lib/report/branding";

/**
 * Een herstelmail aanvragen.
 *
 * Eén scherm voor atleten en behandelaars. Het verschil zit in waar je daarna
 * uitkomt, en dat regelt de voordeur op basis van je rol; een tweede pagina
 * met dezelfde inhoud zou alleen betekenen dat er straks een van de twee
 * achterloopt.
 *
 * De bevestiging is altijd dezelfde, ook als er geen account op dit adres
 * staat, en ook als Supabase een fout teruggeeft. Anders is dit formulier een
 * manier om te vragen of iemand hier patiënt is, en bij een praktijk die
 * eliteatleten begeleidt is het bestaan van een account op zichzelf al
 * informatie.
 *
 * `signInWithOtp` zou hetzelfde effect hebben met minder stappen, maar dat
 * maakt van een vergeten wachtwoord een permanente inlog-per-mail. Dit blijft
 * expliciet herstel: één link, en aan het eind kies je een nieuw wachtwoord.
 */
export function ForgotPassword({ backTo }: { backTo: string }) {
  const t = useTranslations("password");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const supabase = createClient();
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        // De link landt op de callback, die de sessie opzet en daarna
        // doorstuurt. Zelfde pad als een magic link, dus één plek waar de
        // twee vormen van Supabase-links worden afgehandeld.
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset`,
      });
    } catch {
      // Bewust stil. Zie de toelichting hierboven: het antwoord mag niet
      // afhangen van of dit adres bestaat.
    } finally {
      setSent(true);
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

      <h2 className="mt-6 text-lg font-semibold tracking-tight">{t("forgotTitle")}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t("forgotIntro")}</p>

      {sent ? (
        <p className="mt-6 rounded-card bg-surface p-4 text-sm text-ink ring-1 ring-hairline ring-inset">
          {t("sent")}
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim().length > 3 && !busy) void submit();
          }}
          className="mt-6"
        >
          <label className="block">
            <span className="text-label uppercase text-ink-faint">{t("email")}</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              autoComplete="email"
              autoFocus
              className={field}
            />
          </label>

          <button
            type="submit"
            disabled={busy || email.trim().length < 4}
            className="mt-5 w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
          >
            {busy ? t("sending") : t("send")}
          </button>
        </form>
      )}

      <Link
        href={backTo}
        className="mt-5 text-center text-xs text-ink-muted underline-offset-2 hover:underline"
      >
        {t("backToSignIn")}
      </Link>
    </main>
  );
}
