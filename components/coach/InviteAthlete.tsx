"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Een atleet uitnodigen vanaf de werklijst.
 *
 * De praktijk zet het account klaar, de atleet geeft zelf toestemming bij zijn
 * eerste keer inloggen. Dat is de hele reden dat dit "uitnodigen" heet en niet
 * "aanmaken": wat hier ontstaat is een account, geen dossier, en dat verschil
 * staat ook op het scherm zodat niemand denkt dat hij hier alvast iets kan
 * invullen voor iemand anders.
 *
 * De mail is de normale weg en de link is de uitweg. Beide tonen, want een
 * uitnodiging die in een spamfilter hangt terwijl de atleet naast je staat is
 * precies het geval waarin een scherm behulpzaam hoort te zijn.
 */
export function InviteAthlete({ onDone }: { onDone: () => void }) {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{
    name: string;
    link: string | null;
    mailed: boolean;
  } | null>(null);

  async function invite() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/coach/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), fullName: fullName.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "could not invite");

      setSent({ name: fullName.trim(), link: body.link ?? null, mailed: body.mailed });
      setFullName("");
      setEmail("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not invite");
    } finally {
      setBusy(false);
    }
  }

  const canInvite = email.trim().length > 3 && fullName.trim().length > 0 && !busy;
  const field =
    "mt-1 w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-600";

  return (
    <section className="mb-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canInvite) void invite();
        }}
        className="rounded-card bg-surface p-4 ring-1 ring-hairline ring-inset"
      >
        <p className="mb-3 text-xs text-ink-faint">
          Creates an account and emails them an invitation. They give consent
          themselves the first time they sign in, and nothing is recorded before
          that.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="text-xs text-ink-muted">Full name</span>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={120}
              className={field}
            />
          </label>
          <label className="min-w-0 flex-1">
            <span className="text-xs text-ink-muted">Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              maxLength={200}
              className={field}
            />
          </label>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="submit"
            disabled={!canInvite}
            className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
          >
            {busy ? "Working…" : "Send invitation"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-md px-3 py-2 text-sm font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
          >
            Close
          </button>
        </div>
      </form>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {sent && (
        <div className="mt-3 rounded-card border border-ok/30 bg-ok/5 p-4">
          <p className="text-sm font-medium">
            {sent.mailed
              ? `Invitation emailed to ${sent.name}.`
              : `Account created for ${sent.name}, but the email could not be sent.`}
          </p>
          {sent.link && (
            <>
              <p className="mt-1 text-xs text-ink-muted">
                {sent.mailed
                  ? "If it does not arrive, this link gets them in. It is shown only here."
                  : "This link is how they get in. It is shown only here."}
              </p>
              <code className="mt-1.5 block rounded bg-canvas px-2 py-1.5 font-mono text-xs break-all">
                {sent.link}
              </code>
            </>
          )}
          {!sent.link && !sent.mailed && (
            <p className="mt-1 text-xs text-ink-muted">
              No link could be generated either. They can use the forgotten
              password link on the sign-in page.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
