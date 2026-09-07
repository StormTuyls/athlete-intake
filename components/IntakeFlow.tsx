"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatScreen } from "@/components/intake/ChatScreen";
import {
  CONSENT_ITEMS,
  chat as chatCopy,
  consent as consentCopy,
  errors,
  intake,
} from "@/lib/intake/copy";

/**
 * De intake zoals de atleet hem doorloopt.
 *
 * Drie stappen: toestemming, gesprek, ingediend. Toestemming eerst, want zonder
 * toestemming mag er niets verwerkt worden.
 *
 * Uploaden was een eigen stap voor het gesprek. Dat is het niet meer: het zit nu
 * in het gesprek zelf. De reden om het ervoor te zetten was dat de assistent
 * daarna alleen nog hoeft te vragen wat niet in de documenten stond, en dat
 * klopt nog steeds, maar het dwong een keuze op het verkeerde moment. Wie zijn
 * verslagen pas bij de derde vraag terugvindt, moest opnieuw beginnen. In het
 * gesprek kan een document er op elk moment bij, en de assistent slaat over wat
 * eruit komt.
 */

type Step = "consent" | "chat" | "done";

interface Completeness {
  total: number;
  filled: number;
  requiredTotal: number;
  requiredFilled: number;
  conflicts: number;
  readyToSubmit: boolean;
}

export function IntakeFlow() {
  const [step, setStep] = useState<Step>("consent");
  const [resuming, setResuming] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [purposes, setPurposes] = useState<Record<string, boolean>>({});
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  const [completeness, setCompleteness] = useState<Completeness | null>(null);
  const [submitted, setSubmitted] = useState<{ notionCreated: boolean | null } | null>(
    null,
  );

  /**
   * Een lopende intake hervatten in plaats van opnieuw beginnen.
   *
   * De sessie zit dertig dagen in een cookie, dus wie zijn tab sluit en morgen
   * terugkomt heeft nog een intake. Zonder deze controle landt hij weer op het
   * toestemmingsscherm terwijl hij al toestemming gaf, en dan is de logische
   * conclusie dat zijn antwoorden weg zijn. Ze staan er gewoon nog.
   *
   * Geen sessie geeft een 401, en dat is geen fout maar de normale situatie voor
   * iemand die hier voor het eerst komt.
   */
  useEffect(() => {
    let ignore = false;

    fetch("/api/intake/state")
      .then(async (response) => {
        if (ignore) return;
        if (!response.ok) return;
        const state = (await response.json()) as {
          consentGrantedAt: string | null;
          status: string;
          completeness: Completeness;
        };
        if (ignore || !state.consentGrantedAt) return;
        setCompleteness(state.completeness);
        setStep(state.status === "draft" ? "chat" : "done");
      })
      .finally(() => {
        if (!ignore) setResuming(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  const call = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? errors.generic);
      return payload as T;
    },
    [],
  );

  async function startAndConsent() {
    setBusy(true);
    setError(null);
    try {
      // De interface is Engels, dus de intake ook: de locale stuurt de taal van
      // de assistent en welke labels de server teruggeeft. Staat hier "nl", dan
      // antwoordt een Engelstalig scherm in het Nederlands.
      await call("/api/intake", { locale: "en" });
      const result = await call<{ completeness: Completeness }>("/api/intake/consent", {
        purposes,
        fullName,
        email,
      });
      setCompleteness(result.completeness);
      setStep("chat");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : errors.generic);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await call<{
        notion: { created?: boolean; error?: string } | null;
      }>("/api/intake/submit");
      setSubmitted({ notionCreated: result.notion?.created ?? null });
      setStep("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : intake.notComplete);
    } finally {
      setBusy(false);
    }
  }

  const consentOk = CONSENT_ITEMS.filter((item) => item.required).every(
    (item) => purposes[item.key],
  );

  // Even niets tonen zolang niet vaststaat of er een lopende intake is. Het
  // toestemmingsscherm laten opflitsen bij iemand die al toestemming gaf leest
  // als "je moet opnieuw beginnen".
  if (resuming) return null;

  // Het gesprek is een eigen scherm op volle hoogte, geen sectie binnen de
  // kolom hierboven. Vandaar een aparte return in plaats van een tak in de JSX.
  if (step === "chat") {
    return <ChatScreen onSubmit={submit} externalError={error} submitting={busy} />;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{intake.title}</h1>
        <p className="mt-2 text-sm opacity-70">{intake.intro}</p>
      </header>

      {completeness && step !== "consent" && (
        <div className="mb-8 rounded-lg border border-hairline p-4 text-sm">
          <div className="flex justify-between">
            <span>{intake.fieldsKnown(completeness.filled, completeness.total)}</span>
            <span className="opacity-60">
              {intake.requiredCount(
                completeness.requiredFilled,
                completeness.requiredTotal,
              )}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-hairline">
            <div
              className="h-full bg-brand-600"
              style={{
                width: `${Math.round((completeness.filled / Math.max(completeness.total, 1)) * 100)}%`,
              }}
            />
          </div>
          {completeness.conflicts > 0 && (
            <p className="mt-2 text-warn">{intake.conflicts(completeness.conflicts)}</p>
          )}
        </div>
      )}

      {error && (
        <p className="mb-6 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {step === "consent" && (
        <section className="space-y-6">
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="opacity-70">{consentCopy.name}</span>
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="mt-1 w-full rounded-md border border-hairline bg-surface px-3 py-2 outline-none focus-visible:border-brand-500"
                autoComplete="name"
              />
            </label>
            <label className="block text-sm">
              <span className="opacity-70">{consentCopy.email}</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                className="mt-1 w-full rounded-md border border-hairline bg-surface px-3 py-2 outline-none focus-visible:border-brand-500"
                autoComplete="email"
              />
            </label>
          </div>

          <div className="space-y-4">
            {CONSENT_ITEMS.map((item) => (
              <label key={item.key} className="flex gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={purposes[item.key] ?? false}
                  onChange={(event) =>
                    setPurposes((current) => ({
                      ...current,
                      [item.key]: event.target.checked,
                    }))
                  }
                  className="mt-1 size-4 shrink-0"
                />
                <span>
                  {item.label}
                  {item.required && <span className="text-danger"> *</span>}
                  <span className="mt-0.5 block text-xs opacity-60">{item.detail}</span>
                </span>
              </label>
            ))}
          </div>

          <button
            onClick={startAndConsent}
            disabled={!consentOk || busy}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
          >
            {busy ? consentCopy.busy : consentCopy.continue}
          </button>
        </section>
      )}

      {step === "done" && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{intake.submitted}</h2>
          <p className="text-sm opacity-70">{intake.submittedBody}</p>
          {submitted?.notionCreated && (
            <p className="text-xs opacity-50">{intake.submittedNotion}</p>
          )}
        </section>
      )}
    </main>
  );
}
