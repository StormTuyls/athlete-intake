"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { PRACTICE_NAME } from "@/lib/report/branding";

/**
 * Inloggen voor de behandelaar: e-mail en wachtwoord.
 *
 * Was eerst een magic link. Twee inlogmanieren voor twee soorten gebruikers is
 * twee keer onderhoud, twee keer testen en twee plekken waar iets kan misgaan,
 * en de winst was klein: een behandelaar logt in vanaf een werkplek en heeft
 * een wachtwoordmanager.
 *
 * Accounts worden door de praktijk aangemaakt (npm run coach:create). Er is dus
 * geen registratieformulier, en met opzet ook geen melding die het verschil
 * verraadt tussen een onbekend adres en een verkeerd wachtwoord: wie hier staat,
 * staat bij een praktijk voor eliteatleten.
 */
export function CoachLogin({ next }: { next: string | null }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw new Error("Those details do not match an account.");

      router.replace(next && next.startsWith("/") ? next : "/coach");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "mt-1.5 w-full rounded-md border border-hairline bg-surface px-3.5 py-2.5 text-base outline-none focus-visible:border-brand-500";

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">{PRACTICE_NAME}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Sign in to review athlete intakes.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim() && password && !busy) void submit();
        }}
        className="mt-6"
      >
        <label className="block">
          <span className="text-label uppercase text-ink-faint">Work email</span>
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

        <label className="mt-4 block">
          <span className="flex items-baseline justify-between">
            <span className="text-label uppercase text-ink-faint">Password</span>
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="text-xs font-medium text-brand-600"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            className={field}
          />
        </label>

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={busy || !email.trim() || !password}
          className="mt-6 w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
        >
          {busy ? "Signing in" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-xs text-ink-faint">
        Accounts are created by the practice. Ask an administrator to reset your
        password if you cannot sign in.
      </p>
    </main>
  );
}
