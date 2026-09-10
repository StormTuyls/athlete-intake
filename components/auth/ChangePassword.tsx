"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/browser";
import { SectionLabel } from "@/components/intake/SectionLabel";
import { CheckIcon } from "@/components/intake/icons";

/**
 * Je wachtwoord wijzigen terwijl je ingelogd bent.
 *
 * Het huidige wachtwoord wordt eerst gecontroleerd, en dat is geen formaliteit:
 * `updateUser({ password })` van Supabase vraagt er niet naar. Zonder die stap
 * is een onbeheerd open laptop genoeg om iemand buiten zijn eigen account te
 * zetten. Controleren gebeurt met een signInWithPassword op hetzelfde adres:
 * lukt dat niet, dan gebeurt er verder niets.
 *
 * Een eigen component en geen sectie in ProfileScreen, want dit praat met Auth
 * en niet met het profiel-endpoint, het heeft zijn eigen foutgevallen, en het
 * hoort niet mee te gaan met de opslaan-knop van het formulier eromheen: één
 * knop die twee verschillende dingen half kan doen is precies wat je hier niet
 * wil.
 */
export function ChangePassword({ email }: { email: string | null }) {
  const t = useTranslations("password");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = "text-label uppercase text-ink-muted";
  const field =
    "mt-1.5 w-full rounded-md border border-hairline bg-surface px-3.5 py-2.5 text-base text-ink outline-none focus-visible:border-brand-600";

  const longEnough = next.length >= 8;
  const matches = next === confirm;
  const canSubmit = Boolean(email) && current.length > 0 && longEnough && matches && !busy;

  async function submit() {
    if (!email) return;
    setBusy(true);
    setError(null);
    setDone(false);

    try {
      const supabase = createClient();

      // Eerst bewijzen dat je het oude wachtwoord kent. Dit vervangt de sessie
      // door een nieuwe van dezelfde gebruiker, dus er verandert niets aan wie
      // je bent.
      const { error: reauth } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (reauth) throw new Error(t("wrongCurrent"));

      const { error: update } = await supabase.auth.updateUser({ password: next });
      if (update) throw new Error(update.message);

      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("changeFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <SectionLabel>{t("changeTitle")}</SectionLabel>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void submit();
        }}
        className="mt-2 rounded-card bg-surface p-4 shadow-card ring-1 ring-hairline ring-inset"
      >
        <p className="text-xs text-ink-faint">{t("changeIntro")}</p>

        <label className="mt-3 block">
          <span className={label}>{t("current")}</span>
          <input
            value={current}
            onChange={(event) => {
              setCurrent(event.target.value);
              setDone(false);
              setError(null);
            }}
            type="password"
            autoComplete="current-password"
            className={field}
          />
        </label>

        <label className="mt-4 block">
          <span className={label}>{t("new")}</span>
          <input
            value={next}
            onChange={(event) => {
              setNext(event.target.value);
              setDone(false);
              setError(null);
            }}
            type="password"
            minLength={8}
            autoComplete="new-password"
            className={field}
          />
        </label>

        <label className="mt-4 block">
          <span className={label}>{t("confirm")}</span>
          <input
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value);
              setDone(false);
              setError(null);
            }}
            type="password"
            minLength={8}
            autoComplete="new-password"
            className={field}
          />
        </label>

        {/* Pas melden als er iets staat om over te melden. Een formulier dat
            "minstens 8 tekens" roept voordat je het eerste teken typt, leest
            als een fout in plaats van als uitleg. */}
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
          className="mt-4 flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium text-ink ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas disabled:opacity-40"
        >
          {busy ? t("changing") : done ? t("changed") : t("change")}
          {done && !busy && <CheckIcon className="size-4 text-ok" />}
        </button>
      </form>
    </section>
  );
}
