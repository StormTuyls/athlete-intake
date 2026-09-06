"use client";

import { useEffect, useState } from "react";
import { label as enumLabel } from "@/lib/dossier/labels";

/**
 * Het reviewscherm van de coach. Eén pagina, zoals afgesproken.
 *
 * Wat dit scherm moet oplossen: de coach wil in dertig seconden weten of dit
 * dossier bruikbaar is en waar hij moet kijken. Daarom staat de klinische
 * samenvatting bovenaan, staan tegenstrijdigheden erboven in plaats van ertussen,
 * en is bij elk veld de herkomst één klik weg: welk document, welke pagina, welk
 * letterlijk citaat.
 *
 * De samenvatting is expliciet gelabeld als gegenereerd. Dat is geen
 * disclaimer-ritueel: de klant vroeg om onderscheid tussen wat er staat en wat
 * iemand eruit concludeert, en zonder dat label vervaagt dat verschil.
 */

const SECTION_LABELS: Record<string, string> = {
  consent: "Toestemming",
  identity: "Identiteit en administratie",
  biometrics: "Biometrie",
  training: "Training en wedstrijden",
  medical_history: "Medische historiek",
  current_status: "Huidige status en doelen",
  uploads: "Aangeleverd materiaal",
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  low: "bg-red-500/10 text-red-700 dark:text-red-400",
};

/**
 * Het label zegt WAAROM een waarde hard of zacht is, niet alleen hoe zeker.
 *
 * "Niet verifieerbaar" bij een naam die de atleet zelf intypte zet een coach aan
 * het zoeken naar een origineel dat niet bestaat. Dat is erger dan geen label.
 */
function badge(field: Field): { text: string; style: string } {
  if (field.status === "conflicting") {
    return { text: "tegenstrijdig", style: CONFIDENCE_STYLE.low };
  }
  if (field.proposedBy === "coach") {
    return { text: "door coach bevestigd", style: CONFIDENCE_STYLE.high };
  }
  if (field.proposedBy === "athlete") {
    return { text: "door atleet opgegeven", style: CONFIDENCE_STYLE.medium };
  }
  if (field.confidence === "high") {
    return { text: "citaat geverifieerd", style: CONFIDENCE_STYLE.high };
  }
  return { text: "citaat niet terugvindbaar", style: CONFIDENCE_STYLE.medium };
}

interface Proposal {
  id: number;
  value: unknown;
  proposedBy: string;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  quoteVerified: boolean;
}

interface Field {
  key: string;
  label: string;
  dataType: string;
  required: boolean;
  isMedical: boolean;
  value: unknown;
  status: string;
  confidence: string;
  proposedBy: string | null;
  conflicts: Array<{
    value: unknown;
    sourceDocumentId: string | null;
    sourcePage: number | null;
    sourceQuote: string | null;
  }>;
  proposals: Proposal[];
}

interface ReviewData {
  intakeId: string;
  athleteName: string | null;
  status: string;
  submittedAt: string | null;
  sections: Array<{ section: string; fields: Field[] }>;
  injuries: Array<{
    id: string;
    bodyRegion: string;
    side: string;
    diagnosis: string | null;
    onsetDate: string | null;
    endDate: string | null;
    sourceQuote: string | null;
    quoteVerified: boolean;
  }>;
  documents: Array<{
    id: string;
    originalFilename: string;
    kind: string;
    pageCount: number | null;
    processingError: string | null;
  }>;
  completeness: {
    total: number;
    filled: number;
    requiredTotal: number;
    requiredFilled: number;
    conflicts: number;
    readyToSubmit: boolean;
  };
}

/**
 * Enum-sleutels zijn stabiel maar niet leesbaar. "right" en "specific_prep"
 * horen niet op het scherm van een coach.
 */
function show(value: unknown, dataType?: string): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "ja" : "nee";
  if (Array.isArray(value)) return value.join(", ");
  if (dataType === "enum") return enumLabel(value);
  return String(value);
}

export function ReviewScreen({ intakeId }: { intakeId: string }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarising, setSummarising] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Het resultaat landt in een callback, met een vlag tegen een antwoord dat
  // binnenkomt nadat het scherm weg is of nadat een nieuwere aanvraag al geland
  // is. Dat is het patroon uit de React-documentatie; setState rechtstreeks in
  // de body van een effect geeft cascaderende renders.
  useEffect(() => {
    let ignore = false;

    fetch(`/api/review/${intakeId}`)
      .then(async (response) => {
        const payload = await response.json();
        if (ignore) return;
        if (!response.ok) throw new Error(payload.error ?? "kon dossier niet laden");
        setData(payload);
      })
      .catch((caught: unknown) => {
        if (ignore) return;
        setError(caught instanceof Error ? caught.message : "kon dossier niet laden");
      });

    return () => {
      ignore = true;
    };
  }, [intakeId]);

  async function generateSummary() {
    setSummarising(true);
    setError(null);
    try {
      const response = await fetch(`/api/review/${intakeId}/summary`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "samenvatting mislukt");
      setSummary(payload.summary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "samenvatting mislukt");
    } finally {
      setSummarising(false);
    }
  }

  function toggle(key: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (error && !data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm opacity-60">Dossier laden</p>
      </main>
    );
  }

  const conflicting = data.sections
    .flatMap((section) => section.fields)
    .filter((field) => field.status === "conflicting");

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {/* Zichtbaar, niet alleen in een comment: wie dit scherm openslaat moet
          weten dat er geen login voor staat. Verdwijnt zodra requireCoach() er is. */}
      <p className="mb-6 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-400">
        Nog niet productieklaar: dit scherm heeft geen coach-login. Iedereen met
        de link ziet het volledige medische dossier.
      </p>

      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {data.athleteName ?? "Naam onbekend"}
        </h1>
        <p className="mt-1 text-sm opacity-60">
          {data.completeness.filled} van {data.completeness.total} velden bekend ·{" "}
          {data.completeness.requiredFilled}/{data.completeness.requiredTotal} verplicht ·{" "}
          {data.documents.length} document{data.documents.length === 1 ? "" : "en"}
          {data.submittedAt && ` · ingediend ${data.submittedAt.slice(0, 10)}`}
        </p>
      </header>

      {conflicting.length > 0 && (
        <section className="mb-8 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <h2 className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {conflicting.length} tegenstrijdigheid
            {conflicting.length === 1 ? "" : "heden"} tussen bronnen
          </h2>
          <p className="mt-1 text-xs opacity-70">
            Deze blokkeren goedkeuring. Het systeem heeft niet gekozen; dat is aan jou.
          </p>
          <ul className="mt-3 space-y-3 text-sm">
            {conflicting.map((field) => (
              <li key={field.key}>
                <span className="font-medium">{field.label}</span>
                <div className="mt-1 space-y-1 text-xs">
                  <div>
                    Gekozen kandidaat: <strong>{show(field.value, field.dataType)}</strong>
                  </div>
                  {field.conflicts.map((rival, index) => (
                    <div key={index} className="opacity-80">
                      Ook gevonden: <strong>{show(rival.value, field.dataType)}</strong>
                      {rival.sourceQuote && (
                        <span className="opacity-70">
                          {" "}
                          uit &ldquo;{rival.sourceQuote.slice(0, 90)}&rdquo;
                          {rival.sourcePage && ` (p${rival.sourcePage})`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Klinische samenvatting</h2>
          <button
            onClick={generateSummary}
            disabled={summarising}
            className="rounded-md bg-black px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {summarising ? "Bezig" : summary ? "Opnieuw" : "Genereren"}
          </button>
        </div>

        {summary ? (
          <>
            <div className="mt-3 space-y-2 text-sm whitespace-pre-wrap">{summary}</div>
            <p className="mt-3 text-xs opacity-50">
              Gegenereerd uit het dossier. Feiten komen uit de brondocumenten,
              observaties zijn interpretatie en geen diagnose. De ruwe documenten
              blijven bewaard en zijn hieronder per veld terug te vinden.
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs opacity-60">
            Vat de intake samen in wat er staat, wat opvalt en wat nog nagekeken
            moet worden.
          </p>
        )}
      </section>

      {data.injuries.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-medium">Blessuretijdlijn</h2>
          <ul className="space-y-2 text-sm">
            {data.injuries.map((injury) => (
              <li
                key={injury.id}
                className="rounded-md border border-black/10 p-3 dark:border-white/15"
              >
                <div>
                  <span className="font-medium">{injury.bodyRegion}</span>
                  {injury.side !== "unknown" && <span className="opacity-70"> {injury.side}</span>}
                  {injury.diagnosis && <span className="opacity-70"> · {injury.diagnosis}</span>}
                </div>
                <div className="mt-0.5 text-xs opacity-60">
                  {injury.onsetDate ?? "datum onbekend"}
                  {injury.endDate && ` tot ${injury.endDate}`}
                  {!injury.quoteVerified && " · citaat niet verifieerbaar"}
                </div>
                {injury.sourceQuote && (
                  <div className="mt-1 text-xs italic opacity-60">
                    &ldquo;{injury.sourceQuote.slice(0, 160)}&rdquo;
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.sections.map((section) => (
        <section key={section.section} className="mb-6">
          <h2 className="mb-2 text-sm font-medium">
            {SECTION_LABELS[section.section] ?? section.section}
          </h2>
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {section.fields.map((field) => {
              const isOpen = open.has(field.key);
              const missing = field.status === "missing";
              return (
                <li key={field.key} className="py-2 text-sm">
                  <div className="flex items-baseline gap-3">
                    <span className="w-52 shrink-0 text-xs opacity-60">
                      {field.label}
                      {field.required && <span className="text-red-600"> *</span>}
                    </span>
                    <span className={missing ? "flex-1 opacity-40" : "flex-1"}>
                      {show(field.value, field.dataType)}
                    </span>
                    {!missing &&
                      (() => {
                        const { text, style } = badge(field);
                        return (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${style}`}>
                            {text}
                          </span>
                        );
                      })()}
                    {field.proposals.length > 0 && (
                      <button
                        onClick={() => toggle(field.key)}
                        className="text-[10px] underline opacity-50"
                      >
                        {isOpen ? "verberg" : "herkomst"}
                      </button>
                    )}
                  </div>

                  {isOpen && (
                    <ul className="mt-2 ml-52 space-y-1.5 text-xs opacity-75">
                      {field.proposals.map((proposal) => (
                        <li key={proposal.id}>
                          <strong>{show(proposal.value, field.dataType)}</strong>
                          <span className="opacity-70">
                            {" "}
                            · {proposal.proposedBy === "model" ? "uit document" : proposal.proposedBy === "athlete" ? "door atleet" : "door coach"}
                            {proposal.sourcePage && ` · p${proposal.sourcePage}`}
                            {proposal.sourceQuote &&
                              (proposal.quoteVerified
                                ? " · citaat geverifieerd"
                                : " · citaat niet terugvindbaar")}
                          </span>
                          {proposal.sourceQuote && (
                            <div className="italic opacity-60">
                              &ldquo;{proposal.sourceQuote.slice(0, 200)}&rdquo;
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="mb-2 text-sm font-medium">Aangeleverde documenten</h2>
        <ul className="space-y-1 text-xs opacity-70">
          {data.documents.map((document) => (
            <li key={document.id}>
              {document.originalFilename} · {document.kind}
              {document.pageCount && ` · ${document.pageCount} pagina's`}
              {document.processingError && (
                <span className="text-red-700 dark:text-red-400">
                  {" "}
                  · {document.processingError}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs opacity-50">
          De ruwe bestanden blijven permanent bewaard naast de gegevens die eruit
          gehaald zijn.
        </p>
      </section>
    </main>
  );
}
