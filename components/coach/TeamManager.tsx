"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PractitionerKind, TeamMember } from "@/lib/db/practitioners";

/**
 * Het team van de praktijk beheren.
 *
 * Drie handelingen, en bewust niet meer: iemand toevoegen, zijn vakgebied
 * wijzigen, en hem archiveren als hij weggaat. Verwijderen staat er niet bij.
 * Een behandelaar staat op dossiers die hij behandeld heeft, en die naam moet
 * blijven kloppen; het echte verwijderpad loopt via het atleetdossier en niet
 * via een personeelslijst.
 *
 * Het wachtwoord van een nieuw account verschijnt hier één keer en wordt
 * nergens bewaard. Dat is geen tekortkoming maar het ontwerp: het staat in
 * geen enkele tabel en in geen enkele log, dus de admin geeft het door en wie
 * het kwijt is gebruikt de herstelmail.
 */
export function TeamManager({ team }: { team: TeamMember[] }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [kind, setKind] = useState<PractitionerKind>("physio");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const response = await fetch("/api/coach/practitioners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), fullName: fullName.trim(), kind }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "could not create");

      setCreated({ name: fullName.trim(), password: body.password });
      setEmail("");
      setFullName("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not create");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, change: { kind?: PractitionerKind; archived?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/coach/practitioners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...change }),
      });
      if (!response.ok) {
        throw new Error((await response.json()).error ?? "could not save");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not save");
    } finally {
      setBusy(false);
    }
  }

  const canAdd = email.trim().length > 3 && fullName.trim().length > 0 && !busy;
  const field =
    "mt-1 w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-600";

  return (
    <>
      <section className="mb-8">
        <h2 className="mb-1 text-sm font-medium">Practitioners</h2>
        {team.length === 0 ? (
          <p className="text-sm text-ink-faint">Nobody yet.</p>
        ) : (
          <ul className="divide-y divide-hairline border-t border-hairline">
            {team.map((member) => (
              <li
                key={member.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {member.fullName ?? "Name unknown"}
                    {member.role === "admin" && (
                      <span className="ml-2 rounded bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted">
                        admin
                      </span>
                    )}
                    {member.archivedAt && (
                      <span className="ml-2 rounded bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted">
                        archived
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {member.email ?? "no email"} ·{" "}
                    {member.athletes === 1 ? "1 athlete" : `${member.athletes} athletes`}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  {/* Het vakgebied blijft ook na archiveren te wijzigen: een
                      verkeerd label op een oud dossier hoort corrigeerbaar te
                      zijn. */}
                  <select
                    value={member.kind ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      void patch(member.id, {
                        kind: (event.target.value || null) as PractitionerKind,
                      })
                    }
                    aria-label={`Discipline for ${member.fullName ?? "this person"}`}
                    className="rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink disabled:opacity-50"
                  >
                    <option value="">no discipline</option>
                    <option value="physio">physio</option>
                    <option value="coach">coach</option>
                  </select>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void patch(member.id, { archived: member.archivedAt === null })
                    }
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas disabled:opacity-50"
                  >
                    {member.archivedAt ? "Restore" : "Archive"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-faint">
          Archiving takes someone out of the list athletes choose from. Athletes
          already assigned to them keep that assignment, and their discipline
          keeps showing on those files.
        </p>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium">Add a practitioner</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Creates an account that can sign in at /coach/login. The password is
          shown once, here, and is stored nowhere. Pass it on, or let them use
          the reset link on the sign-in page.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canAdd) void add();
          }}
          className="rounded-card bg-surface p-4 ring-1 ring-hairline ring-inset"
        >
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
              <span className="text-xs text-ink-muted">Work email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                maxLength={200}
                className={field}
              />
            </label>
            <label className="shrink-0">
              <span className="text-xs text-ink-muted">Discipline</span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as PractitionerKind)}
                className={field}
              >
                <option value="physio">physio</option>
                <option value="coach">coach</option>
              </select>
            </label>
          </div>

          <button
            type="submit"
            disabled={!canAdd}
            className="mt-3 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
          >
            {busy ? "Working…" : "Create account"}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {created && (
          <div className="mt-3 rounded-card border border-ok/30 bg-ok/5 p-4">
            <p className="text-sm font-medium">{created.name} can sign in now.</p>
            <p className="mt-1 text-xs text-ink-muted">
              One-time password, shown only here:
            </p>
            <code className="mt-1.5 block rounded bg-canvas px-2 py-1.5 font-mono text-sm break-all">
              {created.password}
            </code>
          </div>
        )}
      </section>
    </>
  );
}
