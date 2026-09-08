"use client";

import { useCallback, useEffect, useState } from "react";
import { label as enumLabel } from "@/lib/dossier/labels";
import { ExportBar } from "@/components/review/ExportBar";
import { FieldEditor } from "@/components/review/FieldEditor";

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
  enumOptions: string[] | null;
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
  athleteId: string;
  athleteName: string | null;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  reportVersion: number | null;
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
    fromEarlierIntake: boolean;
    recordedAt: string | null;
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
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // Het hele dossier opnieuw ophalen na een correctie, in plaats van de ene rij
  // bijwerken die de coach net wijzigde. Dat is opzet: een correctie kan een
  // tegenstrijdigheid oplossen, en dan verandert ook de balk bovenaan, het
  // conflictblok en de teller. Lokaal bijwerken betekent die afleidingen hier
  // nog een keer uitrekenen, naast getReviewData, en dan lopen ze uit elkaar.
  const load = useCallback(async () => {
    const response = await fetch(`/api/review/${intakeId}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "kon dossier niet laden");
    return payload as ReviewData;
  }, [intakeId]);

  // Het resultaat landt in een callback, met een vlag tegen een antwoord dat
  // binnenkomt nadat het scherm weg is of nadat een nieuwere aanvraag al geland
  // is. Dat is het patroon uit de React-documentatie; setState rechtstreeks in
  // de body van een effect geeft cascaderende renders.
  useEffect(() => {
    let ignore = false;

    load()
      .then((payload) => {
        if (!ignore) setData(payload);
      })
      .catch((caught: unknown) => {
        if (ignore) return;
        setError(caught instanceof Error ? caught.message : "kon dossier niet laden");
      });

    return () => {
      ignore = true;
    };
  }, [load]);

  /**
   * Corrigeren en bevestigen lopen langs hetzelfde endpoint. Het verschil is of
   * er een waarde meegaat: zonder waarde bepaalt de server welke waarde bevestigd
   * wordt, uit het winnende voorstel. Zou de client die waarde meesturen, dan
   * bepaalt de client wat er afgetekend wordt.
   */
  async function saveField(fieldKey: string, value?: string) {
    setSaving(true);
    setFieldError(null);
    try {
      const response = await fetch(`/api/review/${intakeId}/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value === undefined ? { fieldKey } : { fieldKey, value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "opslaan mislukt");
      setData(await load());
      setEditing(null);
    } catch (caught) {
      setFieldError(caught instanceof Error ? caught.message : "opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

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

  /**
   * Goedkeuren. De uitkomst wordt niet lokaal ingevuld maar opnieuw opgehaald:
   * na een goedkeuring verandert ook de status, de rapportversie en of de
   * correctieknoppen er nog horen te staan.
   */
  async function approve() {
    setApproving(true);
    setApproveError(null);
    try {
      const response = await fetch(`/api/review/${intakeId}/approve`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "goedkeuren mislukt");
      setData(await load());
    } catch (caught) {
      setApproveError(caught instanceof Error ? caught.message : "goedkeuren mislukt");
    } finally {
      setApproving(false);
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

  // Een goedgekeurd dossier is bevroren, dus dan verdwijnen de knoppen. De route
  // weigert het ook, maar een knop aanbieden die daarna een foutmelding geeft is
  // een slechtere uitleg dan geen knop.
  const locked = data.status === "approved";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {/* Een dossier is altijd het dossier VAN iemand, dus de weg terug gaat
          naar die persoon en niet naar de lijst. Niet de naam als linktekst: die
          staat een regel lager als kop, en twee keer dezelfde naam onder elkaar
          leest als een fout. */}
      <a
        href={`/coach/athletes/${data.athleteId}`}
        className="text-xs underline opacity-60"
      >
        Terug naar het profiel
      </a>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {data.athleteName ?? "Naam onbekend"}
        </h1>
        <p className="mt-1 text-sm opacity-60">
          {data.completeness.filled} van {data.completeness.total} velden bekend ·{" "}
          {data.completeness.requiredFilled}/{data.completeness.requiredTotal} verplicht ·{" "}
          {data.documents.length} document{data.documents.length === 1 ? "" : "en"}
          {data.submittedAt && ` · ingediend ${data.submittedAt.slice(0, 10)}`}
        </p>
        {locked && (
          <p className="mt-2 inline-block rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-400">
            Goedgekeurd op {data.approvedAt?.slice(0, 10)}
            {data.approvedBy && ` door ${data.approvedBy}`}
            {data.reportVersion !== null && ` · rapportversie ${data.reportVersion}`}
          </p>
        )}
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
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{injury.bodyRegion}</span>
                  {injury.side !== "unknown" && <span className="opacity-70">{injury.side}</span>}
                  {injury.diagnosis && <span className="opacity-70">· {injury.diagnosis}</span>}
                  {/* Historie apart benoemen, anders leest een blessure uit een
                      eerdere intake als iets wat in deze documenten stond. */}
                  {injury.fromEarlierIntake && (
                    <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] whitespace-nowrap opacity-70 dark:bg-white/10">
                      uit een eerdere intake
                      {injury.recordedAt && ` · ${injury.recordedAt}`}
                    </span>
                  )}
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
                  {/* Op een telefoon staan label, waarde en knoppen onder
                      elkaar. In één regel is er bij 375 breed geen ruimte: het
                      label at de helft op, het badge brak over drie regels en
                      "corrigeren" viel buiten het scherm. Vanaf sm is er wel
                      plaats en blijft het de compacte tabel die snel te scannen
                      is. */}
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
                    <span className="text-xs opacity-60 sm:w-52 sm:shrink-0">
                      {field.label}
                      {field.required && <span className="text-red-600"> *</span>}
                    </span>
                    <span className={missing ? "opacity-40 sm:flex-1" : "sm:flex-1"}>
                      {show(field.value, field.dataType)}
                    </span>
                    <span className="flex flex-wrap items-baseline gap-3">
                    {!missing &&
                      (() => {
                        const { text, style } = badge(field);
                        return (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap ${style}`}
                          >
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
                    {!locked && !missing && field.proposedBy !== "coach" && (
                      <button
                        onClick={() => saveField(field.key)}
                        disabled={saving}
                        // Aftekenen zonder de waarde opnieuw in te tikken. Dit is
                        // de meest gebruikte handeling in dit scherm, dus die
                        // hoort niet achter een formulier te zitten.
                        className="text-[10px] underline opacity-50 disabled:opacity-25"
                      >
                        bevestigen
                      </button>
                    )}
                    {!locked && (
                      <button
                        onClick={() => {
                          setFieldError(null);
                          setEditing(editing === field.key ? null : field.key);
                        }}
                        className="text-[10px] underline opacity-50"
                      >
                        {editing === field.key
                          ? "sluiten"
                          : missing
                            ? "invullen"
                            : "corrigeren"}
                      </button>
                    )}
                    </span>
                  </div>

                  {editing === field.key && (
                    <FieldEditor
                      field={field}
                      busy={saving}
                      error={fieldError}
                      onSave={(value) => saveField(field.key, value)}
                      onCancel={() => {
                        setEditing(null);
                        setFieldError(null);
                      }}
                    />
                  )}

                  {isOpen && (
                    <ul className="mt-2 space-y-1.5 text-xs opacity-75 sm:ml-52">
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

      {!locked && (
        <section className="mt-8 rounded-lg border border-black/10 p-4 dark:border-white/15">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium">Goedkeuren</h2>
              <p className="mt-1 text-xs opacity-70">
                {conflicting.length > 0
                  ? "Los eerst de tegenstrijdigheden hierboven op."
                  : data.submittedAt
                    ? "Legt een rapportversie vast met jouw naam eronder. Daarna staat het dossier vast en kan de atleet er niets meer aan wijzigen."
                    : "Kan pas als de atleet de intake heeft ingediend."}
              </p>
            </div>
            <button
              onClick={approve}
              disabled={approving || conflicting.length > 0 || !data.submittedAt}
              className="shrink-0 rounded-md bg-black px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-black"
            >
              {approving ? "Bezig" : "Goedkeuren"}
            </button>
          </div>
          {approveError && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-400">{approveError}</p>
          )}
        </section>
      )}

      <ExportBar intakeId={intakeId} />
    </main>
  );
}
