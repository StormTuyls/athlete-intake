"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

/**
 * De intake zoals de atleet hem doorloopt.
 *
 * Vier stappen, in deze volgorde en niet anders: toestemming, uploaden,
 * gesprek, indienen. Toestemming eerst omdat er zonder toestemming niets
 * verwerkt mag worden, en uploaden voor het gesprek omdat de assistent daarna
 * alleen nog hoeft te vragen wat niet in de documenten stond. Dat is waar de
 * tijdswinst zit: wie zijn verslagen al aanleverde, krijgt die vragen niet meer.
 */

type Step = "consent" | "upload" | "chat" | "done";

interface Completeness {
  total: number;
  filled: number;
  requiredTotal: number;
  requiredFilled: number;
  conflicts: number;
  readyToSubmit: boolean;
}

interface DocumentRow {
  filename: string;
  kind: string;
  fieldsProposed: number;
  quotesVerified: number;
  injuriesFound: number;
  error?: string;
}

interface ChatLine {
  role: "user" | "assistant";
  content: string;
}

const CONSENT_ITEMS = [
  {
    key: "medical_processing",
    required: true,
    label: "Ik geef toestemming om mijn medische gegevens te verwerken",
    detail:
      "Nodig om je blessurehistoriek, klachten en testgegevens te kunnen opnemen in je dossier.",
  },
  {
    key: "share_with_practitioners",
    required: false,
    label: "Mijn gegevens mogen gedeeld worden met mijn behandelaars",
    detail:
      "Je kinesist of sportarts krijgt dan een samenvatting van je intake in de beveiligde werkomgeving waarin hij werkt. Zonder dit vinkje blijft je medische informatie alleen bij je coach, en krijgt je behandelaar enkel je contactgegevens.",
  },
  {
    key: "retention_acknowledged",
    required: true,
    label: "Ik weet hoe lang mijn dossier bewaard blijft",
    detail:
      "Je dossier blijft bewaard zolang de begeleiding loopt en daarna als zorgdossier. Je kunt op elk moment vragen om het te verwijderen.",
  },
] as const;

export function IntakeFlow() {
  const [step, setStep] = useState<Step>("consent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [purposes, setPurposes] = useState<Record<string, boolean>>({});
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [completeness, setCompleteness] = useState<Completeness | null>(null);
  const [submitted, setSubmitted] = useState<{ notionCreated: boolean | null } | null>(
    null,
  );

  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const call = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "er ging iets mis");
      return payload as T;
    },
    [],
  );

  async function startAndConsent() {
    setBusy(true);
    setError(null);
    try {
      await call("/api/intake", { locale: "nl" });
      const result = await call<{ completeness: Completeness }>("/api/intake/consent", {
        purposes,
        fullName,
        email,
      });
      setCompleteness(result.completeness);
      setStep("upload");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "er ging iets mis");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(files: FileList) {
    setBusy(true);
    setError(null);

    for (const file of Array.from(files)) {
      try {
        // Signed URL opvragen, dan rechtstreeks naar de opslag. Het bestand gaat
        // dus niet door een route handler.
        const signed = await call<{ path: string; token: string; bucket: string }>(
          "/api/intake/documents/upload-url",
          {
            filename: file.name,
            mimeType: file.type || "text/plain",
            byteSize: file.size,
          },
        );

        const supabase = createClient();
        const upload = await supabase.storage
          .from(signed.bucket)
          .uploadToSignedUrl(signed.path, signed.token, file);

        if (upload.error) throw new Error(upload.error.message);

        const result = await call<{
          kind: string;
          fieldsProposed: number;
          quotesVerified: number;
          injuriesFound: number;
        }>("/api/intake/documents", {
          path: signed.path,
          filename: file.name,
          mimeType: file.type || "text/plain",
        });

        setDocuments((rows) => [
          ...rows,
          { filename: file.name, ...result },
        ]);
      } catch (caught) {
        setDocuments((rows) => [
          ...rows,
          {
            filename: file.name,
            kind: "-",
            fieldsProposed: 0,
            quotesVerified: 0,
            injuriesFound: 0,
            error: caught instanceof Error ? caught.message : "verwerking mislukt",
          },
        ]);
      }
    }

    try {
      const state = await call<{ completeness: Completeness }>("/api/intake/state");
      setCompleteness(state.completeness);
    } catch {
      // Niet fataal: de stand wordt bij de volgende stap opnieuw opgehaald.
    }

    setBusy(false);
  }

  async function chatTurn(message?: string) {
    setBusy(true);
    setError(null);
    if (message) setChat((lines) => [...lines, { role: "user", content: message }]);
    try {
      const result = await call<{
        reply: string;
        done: boolean;
        completeness: Completeness;
      }>("/api/intake/chat", message ? { message } : {});
      setChat((lines) => [...lines, { role: "assistant", content: result.reply }]);
      setCompleteness(result.completeness);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "er ging iets mis");
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
      setError(caught instanceof Error ? caught.message : "nog niet volledig");
    } finally {
      setBusy(false);
    }
  }

  const consentOk = CONSENT_ITEMS.filter((item) => item.required).every(
    (item) => purposes[item.key],
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Intake</h1>
        <p className="mt-2 text-sm opacity-70">
          Lever aan wat je hebt. De assistent leest het uit en vraagt alleen naar
          wat nog ontbreekt.
        </p>
      </header>

      {completeness && step !== "consent" && (
        <div className="mb-8 rounded-lg border border-black/10 p-4 text-sm dark:border-white/15">
          <div className="flex justify-between">
            <span>
              {completeness.filled} van {completeness.total} velden bekend
            </span>
            <span className="opacity-60">
              {completeness.requiredFilled}/{completeness.requiredTotal} verplicht
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-black/10 dark:bg-white/15">
            <div
              className="h-full bg-emerald-600"
              style={{
                width: `${Math.round((completeness.filled / Math.max(completeness.total, 1)) * 100)}%`,
              }}
            />
          </div>
          {completeness.conflicts > 0 && (
            <p className="mt-2 text-amber-700 dark:text-amber-400">
              {completeness.conflicts} tegenstrijdigheid
              {completeness.conflicts === 1 ? "" : "heden"} tussen je documenten. De
              assistent vraagt je welke waarde klopt.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mb-6 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {step === "consent" && (
        <section className="space-y-6">
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="opacity-70">Naam</span>
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
                autoComplete="name"
              />
            </label>
            <label className="block text-sm">
              <span className="opacity-70">E-mail</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
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
                  {item.required && <span className="text-red-600"> *</span>}
                  <span className="mt-0.5 block text-xs opacity-60">{item.detail}</span>
                </span>
              </label>
            ))}
          </div>

          <button
            onClick={startAndConsent}
            disabled={!consentOk || busy}
            className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {busy ? "Bezig" : "Verder"}
          </button>
        </section>
      )}

      {step === "upload" && (
        <section className="space-y-6">
          <div>
            <h2 className="text-sm font-medium">Documenten</h2>
            <p className="mt-1 text-xs opacity-60">
              Medische verslagen, scans, je trainingsschema, testrapporten,
              screenshots of een WhatsApp-export. PDF, JPEG, PNG, tekst of CSV.
            </p>
          </div>

          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(event) => {
              if (event.target.files?.length) void uploadFiles(event.target.files);
              event.target.value = "";
            }}
            className="block w-full text-sm"
          />

          {documents.length > 0 && (
            <ul className="space-y-2 text-sm">
              {documents.map((document, index) => (
                <li
                  key={`${document.filename}-${index}`}
                  className="rounded-md border border-black/10 p-3 dark:border-white/15"
                >
                  <div className="font-medium">{document.filename}</div>
                  {document.error ? (
                    <div className="mt-1 text-xs text-red-700 dark:text-red-400">
                      {document.error} (het bestand blijft bewaard)
                    </div>
                  ) : (
                    <div className="mt-1 text-xs opacity-60">
                      {document.kind} · {document.fieldsProposed} veld
                      {document.fieldsProposed === 1 ? "" : "en"} gevonden,{" "}
                      {document.quotesVerified} met geverifieerd citaat
                      {document.injuriesFound > 0 &&
                        ` · ${document.injuriesFound} blessure${document.injuriesFound === 1 ? "" : "s"}`}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => {
                setStep("chat");
                void chatTurn();
              }}
              disabled={busy}
              className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
            >
              {busy ? "Bezig" : "Verder naar de vragen"}
            </button>
          </div>
        </section>
      )}

      {step === "chat" && (
        <section className="space-y-4">
          <div className="space-y-3">
            {chat.map((line, index) => (
              <div
                key={index}
                className={
                  line.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10"
                    : "max-w-[85%] rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/15"
                }
              >
                {line.content}
              </div>
            ))}
            <div ref={chatEnd} />
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.trim() || busy) return;
              const message = draft.trim();
              setDraft("");
              void chatTurn(message);
            }}
            className="flex gap-2"
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Je antwoord"
              disabled={busy}
              className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
            >
              Stuur
            </button>
          </form>

          {completeness?.readyToSubmit && (
            <button
              onClick={submit}
              disabled={busy}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Intake afronden
            </button>
          )}
        </section>
      )}

      {step === "done" && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Ingediend</h2>
          <p className="text-sm opacity-70">
            Je coach kijkt je dossier na en neemt contact op. De documenten die je
            aanleverde blijven bewaard naast de gegevens die eruit gehaald zijn.
          </p>
          {submitted?.notionCreated && (
            <p className="text-xs opacity-50">
              Opvolgactie en factuurregel voor je coach zijn aangemaakt.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
