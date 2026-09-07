"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { PRACTICE_NAME } from "@/lib/report/branding";
import {
  ArrowRightIcon,
  BrandMark,
  CheckIcon,
  LockIcon,
} from "@/components/athlete/icons";

/**
 * Scherm 01 uit het ontwerp: aanmelden of inloggen, donker.
 *
 * Het ontwerp toont e-mail, wachtwoord en één consentvinkje op één scherm. Dat
 * is een aanmeldscherm: toestemming geef je één keer, bij het aanmaken van je
 * account. Een terugkerende atleet ziet dat vinkje dus niet meer, en daarom zit
 * er een schakelaar tussen aanmelden en inloggen.
 *
 * Het vinkje dekt de twee verplichte doelen: verwerken van gezondheidsgegevens
 * en de bewaartermijn. Het optionele doel, delen met behandelaars, staat niet
 * hier maar in de intake zelf: dat is de toestemming waar de samenvatting naar
 * de kinesist op berust, en die hoort een eigen, aparte keuze te zijn en niet
 * een bijzin in een aanmeldformulier.
 */
export function AthleteAuth({
  retention,
  next,
}: {
  retention: string;
  next: string;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<"register" | "signin">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    email.trim().length > 3 &&
    password.length >= 8 &&
    (mode === "signin" || consented) &&
    !busy;

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      const supabase = createClient();

      if (mode === "register") {
        const { error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw new Error(signUpError.message);

        // Profiel en atleetrij kan de browser niet zelf maken: er is geen
        // insert-policy op profiles en athletes_write is alleen voor staf.
        const response = await fetch("/api/athlete/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: "en", consented: true }),
        });
        if (!response.ok) {
          throw new Error((await response.json()).error ?? "could not finish signing up");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        // Niet uitsplitsen welk deel fout was: dat vertelt of een adres bestaat.
        if (signInError) throw new Error("Those details do not match an account.");
      }

      router.replace(next);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const label = "text-label uppercase text-night-muted";
  const field =
    "mt-1.5 w-full rounded-md border border-night-line bg-night-raised px-3.5 py-2.5 text-base text-night-ink outline-none placeholder:text-night-muted/60 focus-visible:border-brand-500";

  return (
    <main className="flex min-h-dvh flex-col bg-night px-6 py-10 text-night-ink">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
        <div className="flex items-center gap-2">
          <BrandMark className="size-5 text-brand-500" />
          <span className="text-base font-semibold tracking-tight">{PRACTICE_NAME}</span>
        </div>

        <h1 className="mt-8 text-2xl leading-tight font-semibold tracking-tight">
          Structured intake,
          <br />
          guided by AI.
        </h1>
        <p className="mt-2.5 text-sm text-night-muted">
          Tell us how you feel. The assistant builds a complete, review-ready
          record for your coach.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void submit();
          }}
          className="mt-7"
        >
          <label className="block">
            <span className={label}>Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className={field}
            />
          </label>

          <label className="mt-4 block">
            <span className="flex items-baseline justify-between">
              <span className={label}>Password</span>
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="text-xs font-medium text-brand-500"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder="At least 8 characters"
              className={field}
            />
          </label>

          {mode === "register" && (
            <label className="mt-5 flex cursor-pointer gap-3 rounded-card border border-night-line bg-night-raised p-3.5">
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border ${
                  consented
                    ? "border-brand-500 bg-brand-500 text-night"
                    : "border-night-line"
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
                I consent to my health data being processed for the purpose of this
                intake. {retention}
              </span>
            </label>
          )}

          {error && <p className="mt-4 text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
          >
            {busy ? "Working" : "Continue"}
            {!busy && <ArrowRightIcon className="size-4" />}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode((value) => (value === "register" ? "signin" : "register"));
            setError(null);
          }}
          className="mt-5 text-center text-xs text-night-muted underline-offset-2 hover:underline"
        >
          {mode === "register"
            ? "I already have an account"
            : "I am new here"}
        </button>

        <footer className="mt-auto flex items-center justify-center gap-1.5 pt-10 text-xs text-night-muted">
          <LockIcon className="size-3.5" />
          <span>GDPR-compliant · Auto-logout · Privacy</span>
        </footer>
      </div>
    </main>
  );
}
