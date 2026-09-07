"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { PRACTICE_NAME } from "@/lib/report/branding";

/**
 * Het inlogscherm van de behandelaar.
 *
 * Zegt met opzet niet of een adres bestaat. "Als dit adres bij ons bekend is,
 * ligt er een link in je mailbox" is de enige melding die geen ledenlijst
 * weggeeft, en dat is hier geen formaliteit: wie hier staat, staat bij een
 * praktijk voor eliteatleten.
 */
export function CoachLogin({
  next,
  linkFailed,
}: {
  next: string | null;
  linkFailed: boolean;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send() {
    setBusy(true);
    setFailed(false);
    try {
      const supabase = createClient();
      const callback = new URL("/auth/callback", window.location.origin);
      if (next) callback.searchParams.set("next", next);

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: callback.toString(),
          // Geen accounts uit een inlogpoging. Een coach wordt aangemaakt door
          // de praktijk, niet door wie het formulier vindt.
          shouldCreateUser: false,
        },
      });

      // Ook bij een fout hetzelfde tonen: een foutmelding bij een onbekend
      // adres is een manier om te vragen wie hier werkt.
      if (error) console.error("[auth]", error.message);
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">{PRACTICE_NAME}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Sign in to review athlete intakes.
      </p>

      {linkFailed && (
        <p className="mt-5 rounded-card border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
          That link did not work. It may have expired or already been used.
          Request a new one below.
        </p>
      )}

      {sent ? (
        <p className="mt-5 rounded-card border border-hairline bg-canvas p-3 text-sm">
          If that address belongs to a practitioner here, a sign-in link is on its
          way. The link works once and expires shortly.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim() && !busy) void send();
          }}
          className="mt-5 space-y-3"
        >
          <label className="block text-sm">
            <span className="text-ink-muted">Work email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              autoComplete="email"
              autoFocus
              className="mt-1 w-full rounded-md border border-hairline bg-surface px-3 py-2 text-base outline-none focus-visible:border-brand-500"
            />
          </label>

          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
          >
            {busy ? "Sending" : "Send sign-in link"}
          </button>

          {failed && (
            <p className="text-sm text-danger">
              Could not reach the server. Please try again.
            </p>
          )}
        </form>
      )}

      <p className="mt-6 text-xs text-ink-faint">
        Accounts are created by the practice. There is no self-registration.
      </p>
    </main>
  );
}
