"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { translator } from "@/lib/i18n/translator";
import { documentError } from "@/lib/intake/format";
import { sectionLabel } from "@/lib/intake/sections";
import { toLocale, type Locale } from "@/lib/i18n/locale";
import { enumLabel } from "@/lib/dossier/enumLabels";
import { toSummaryBlocks } from "@/lib/report/summaryBlocks";
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


const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-500/10 text-emerald-700",
  medium: "bg-amber-500/10 text-amber-700",
  low: "bg-red-500/10 text-red-700",
};

/**
 * Het label zegt WAAROM een waarde hard of zacht is, niet alleen hoe zeker.
 *
 * "Niet verifieerbaar" bij een naam die de atleet zelf intypte zet een coach aan
 * het zoeken naar een origineel dat niet bestaat. Dat is erger dan geen label.
 */
type T = ReturnType<typeof useTranslations<"review">>;

function badge(field: Field, t: T): { text: string; style: string } {
  if (field.status === "conflicting") {
    return { text: t("badgeConflicting"), style: CONFIDENCE_STYLE.low };
  }
  if (field.proposedBy === "coach") {
    return { text: t("badgeCoachConfirmed"), style: CONFIDENCE_STYLE.high };
  }
  if (field.proposedBy === "athlete") {
    // Uit het profiel is ook "door de atleet", maar het is niet vandaag gezegd:
    // het staat in zijn profiel en is sindsdien misschien niet meer bekeken.
    // Voor een behandelaar die beoordeelt of een gegeven actueel is, is dat het
    // verschil dat telt.
    return field.fromProfile
      ? { text: t("badgeFromProfile"), style: CONFIDENCE_STYLE.medium }
      : { text: t("badgeAthleteReported"), style: CONFIDENCE_STYLE.medium };
  }
  if (field.confidence === "high") {
    return { text: t("badgeQuoteVerified"), style: CONFIDENCE_STYLE.high };
  }
  return { text: t("badgeQuoteNotFound"), style: CONFIDENCE_STYLE.medium };
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
  fromProfile: boolean;
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
  notAsked: Array<{
    fieldKey: string;
    section: string;
    label: string;
    required: boolean;
    reason: "skipped" | "practitioner";
    skipReason: "unknown" | "declined" | null;
  }>;
  documents: Array<{
    id: string;
    originalFilename: string;
    kind: string;
    pageCount: number | null;
    processingError: string | null;
    summary: string | null;
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
function show(
  value: unknown,
  locale: Locale,
  dataType?: string,
  fieldKey?: string,
): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") {
    return translator(locale, "format")(value ? "yes" : "no");
  }
  if (Array.isArray(value)) return value.join(", ");
  // De veldsleutel hoort erbij: enum-labels zijn per veld, want 'other' en
  // 'competition' komen in meer dan één enum voor.
  if (dataType === "enum" && fieldKey) return enumLabel(fieldKey, value, locale);
  return String(value);
}

export function ReviewScreen({ intakeId }: { intakeId: string }) {
  // De taal van de coach en niet die van de intake: wie tien dossiers per week
  // nakijkt wil niet dat de kop van taal wisselt bij het openen van een dossier
  // van een Engelstalige atleet. De waarden in het dossier blijven staan zoals
  // ze opgeschreven zijn.
  const locale = toLocale(useLocale());
  const t = useTranslations("review");
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
  // De coach heeft gezien dat er verplichte velden ontbreken en keurt toch goed.
  // Bewust geen harde blokkade: een veld dat niemand kan invullen zou het
  // dossier voorgoed vastzetten. Wel een handeling, en die belandt in het spoor.
  const [acceptGaps, setAcceptGaps] = useState(false);

  // Het hele dossier opnieuw ophalen na een correctie, in plaats van de ene rij
  // bijwerken die de coach net wijzigde. Dat is opzet: een correctie kan een
  // tegenstrijdigheid oplossen, en dan verandert ook de balk bovenaan, het
  // conflictblok en de teller. Lokaal bijwerken betekent die afleidingen hier
  // nog een keer uitrekenen, naast getReviewData, en dan lopen ze uit elkaar.
  const load = useCallback(async () => {
    const response = await fetch(`/api/review/${intakeId}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? t("loadFailed"));
    return payload as ReviewData;
  }, [intakeId, t]);

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
        setError(caught instanceof Error ? caught.message : t("loadFailed"));
      });

    return () => {
      ignore = true;
    };
  }, [load, t]);

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
      if (!response.ok) throw new Error(payload.error ?? t("saveFailed"));
      setData(await load());
      setEditing(null);
    } catch (caught) {
      setFieldError(caught instanceof Error ? caught.message : t("saveFailed"));
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
      if (!response.ok) throw new Error(payload.error ?? t("summaryFailed"));
      setSummary(payload.summary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("summaryFailed"));
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
      const response = await fetch(`/api/review/${intakeId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgeGaps: acceptGaps }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? t("approveFailed"));
      setData(await load());
    } catch (caught) {
      setApproveError(caught instanceof Error ? caught.message : t("approveFailed"));
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
        <p className="text-sm text-red-700">{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm opacity-60">{t("loading")}</p>
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

  // Verplichte velden die gevraagd zijn en geen antwoord kregen. Niet de velden
  // die voor de behandelaar bedoeld zijn: die zijn met opzet aan hem gelaten en
  // zijn geen gat dat iemand over het hoofd zag.
  const skippedRequired = (data.notAsked ?? []).filter(
    (entry) => entry.reason === "skipped" && entry.required,
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:max-w-6xl">
      {/* Een dossier is altijd het dossier VAN iemand, dus de weg terug gaat
          naar die persoon en niet naar de lijst. Niet de naam als linktekst: die
          staat een regel lager als kop, en twee keer dezelfde naam onder elkaar
          leest als een fout. */}
      <a
        href={`/coach/athletes/${data.athleteId}`}
        className="text-xs underline opacity-60"
      >
        {t("backToProfile")}
      </a>

      <header className="mt-3 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {data.athleteName ?? t("nameUnknown")}
        </h1>
        <p className="mt-1 text-sm opacity-60">
          {t("fieldsKnown", {
            filled: data.completeness.filled,
            total: data.completeness.total,
          })}{" · "}
          {t("requiredCount", {
            filled: data.completeness.requiredFilled,
            total: data.completeness.requiredTotal,
          })}{" · "}
          {t("documentCount", { count: data.documents.length })}
          {data.submittedAt &&
            ` · ${t("submittedOn", { date: data.submittedAt.slice(0, 10) })}`}
        </p>
        {locked && (
          <p className="mt-2 inline-block rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700">
            {t("approvedOn", { date: data.approvedAt?.slice(0, 10) ?? "" })}
            {data.approvedBy && ` ${t("approvedBy", { name: data.approvedBy })}`}
            {data.reportVersion !== null &&
              ` · ${t("reportVersion", { version: data.reportVersion })}`}
          </p>
        )}
      </header>

      {/* Vanaf lg twee kolommen. Links wat de behandelaar leest en
          corrigeert: tegenstrijdigheden, de samenvatting, de tijdlijn en de
          velden zelf. Rechts wat hij erbij nodig heeft maar niet regel voor
          regel doorloopt: de bijlagen, het aftekenen en de export.

          Waarom een rail en geen bredere kolom: de velden zijn een lijst die
          je van boven naar beneden leest, en die wordt niet beter van 1100
          pixels leesbreedte. Wat wel beter wordt is dat 'goedkeuren' niet
          meer achter drie schermen scrollen ligt.

          Onder lg staat alles onder elkaar in precies dezelfde volgorde als
          hiervoor, want de twee kolommen zijn in bronvolgorde geschreven. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-10">
        <div className="min-w-0">
        {conflicting.length > 0 && (
          <section className="mb-8 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <h2 className="text-sm font-medium text-amber-800">
              {t("conflictsTitle", { count: conflicting.length })}
            </h2>
            <p className="mt-1 text-xs opacity-70">
              {t("conflictsBody")}
            </p>
            <ul className="mt-3 space-y-3 text-sm">
              {conflicting.map((field) => (
                <li key={field.key}>
                  <span className="font-medium">{field.label}</span>
                  <div className="mt-1 space-y-1 text-xs">
                    <div>
                      {t("chosenCandidate")} <strong>{show(field.value, locale, field.dataType, field.key)}</strong>
                    </div>
                    {field.conflicts.map((rival, index) => (
                      <div key={index} className="opacity-80">
                        {t("alsoFound")} <strong>{show(rival.value, locale, field.dataType, field.key)}</strong>
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

        <section className="mb-8 rounded-lg border border-black/10 p-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-medium">{t("summaryTitle")}</h2>
            <button
              onClick={generateSummary}
              disabled={summarising}
              className="rounded-md bg-black px-3 py-1.5 text-xs text-white disabled:opacity-40"
            >
              {summarising ? t("summaryBusy") : summary ? t("summaryRegenerate") : t("summaryGenerate")}
            </button>
          </div>

          {summary ? (
            <>
              {/* Dezelfde parser als het rapport, want het is dezelfde tekst uit
                  dezelfde prompt. Zonder dit las een behandelaar op zijn scherm
                  `**Wat er staat**` met sterretjes, terwijl de PDF van hetzelfde
                  dossier het wel als kop toonde. */}
              <div className="mt-3 space-y-2 text-sm">
                {toSummaryBlocks(summary).map((block, index) =>
                  block.kind === "heading" ? (
                    <p key={index} className="mt-4 font-semibold first:mt-0">
                      {block.text}
                    </p>
                  ) : block.kind === "item" ? (
                    <p key={index} className="pl-4 -indent-4 before:mr-1.5 before:content-['·']">
                      {block.text}
                    </p>
                  ) : (
                    <p key={index}>{block.text}</p>
                  ),
                )}
              </div>
              <p className="mt-3 text-xs opacity-50">
                {t("summaryDisclaimer")}
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs opacity-60">
              {t("summaryEmpty")}
            </p>
          )}
        </section>

        {data.injuries.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-2 text-sm font-medium">{t("timelineTitle")}</h2>
            <ul className="space-y-2 text-sm">
              {data.injuries.map((injury) => (
                <li
                  key={injury.id}
                  className="rounded-md border border-black/10 p-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{injury.bodyRegion}</span>
                    {injury.side !== "unknown" && <span className="opacity-70">{injury.side}</span>}
                    {injury.diagnosis && <span className="opacity-70">· {injury.diagnosis}</span>}
                    {/* Historie apart benoemen, anders leest een blessure uit een
                        eerdere intake als iets wat in deze documenten stond. */}
                    {injury.fromEarlierIntake && (
                      <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] whitespace-nowrap opacity-70">
                        {t("fromEarlierIntake")}
                        {injury.recordedAt && ` · ${injury.recordedAt}`}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs opacity-60">
                    {injury.onsetDate ?? t("dateUnknown")}
                    {injury.endDate && ` ${t("until", { date: injury.endDate })}`}
                    {!injury.quoteVerified && ` · ${t("quoteUnverifiable")}`}
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
              {sectionLabel(section.section, locale, "clinical")}
            </h2>
            <ul className="divide-y divide-black/5">
              {section.fields.map((field) => {
                const isOpen = open.has(field.key);
                const missing = field.status === "missing";
                // Vrije tekst krijgt een eigen regel; korte waarden blijven in de
                // kolom staan, want daar leest een rij per veld het snelst.
                const longValue = field.dataType === "long_text" && !missing;
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
                      {/* Een long_text-waarde past niet in de waardekolom. Die
                          kolom is zo breed als wat ernaast staat toelaat, en een
                          trainingsschema van vijfhonderd tekens werd daar over
                          vijfentwintig regels uitgesmeerd, een handvol woorden per
                          regel. Onleesbaar, en het duwde de rest van het dossier
                          van het scherm. Zulke velden krijgen daarom hun eigen
                          regel onder de kop, uitgelijnd met de andere waarden. */}
                      {longValue ? (
                        <span className="sm:flex-1" aria-hidden />
                      ) : (
                        <span className={missing ? "opacity-40 sm:flex-1" : "sm:flex-1"}>
                          {show(field.value, locale, field.dataType, field.key)}
                        </span>
                      )}
                      <span className="flex flex-wrap items-baseline gap-3">
                      {!missing &&
                        (() => {
                          const { text, style } = badge(field, t);
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
                          {isOpen ? t("provenanceHide") : t("provenance")}
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
                          {t("confirm")}
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
                            ? t("close")
                            : missing
                              ? t("fill")
                              : t("correct")}
                        </button>
                      )}
                      </span>
                    </div>

                    {longValue && (
                      <p className="mt-1.5 text-sm whitespace-pre-wrap sm:ml-52">
                        {show(field.value, locale, field.dataType, field.key)}
                      </p>
                    )}

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
                            <strong>{show(proposal.value, locale, field.dataType, field.key)}</strong>
                            <span className="opacity-70">
                              {" "}
                              · {proposal.proposedBy === "model" ? t("fromDocument") : proposal.proposedBy === "athlete" ? t("fromAthlete") : t("fromCoach")}
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

        {data.notAsked?.length > 0 && (
          <section className="mt-8 border-t border-black/10 pt-6">
            <h2 className="mb-1 text-sm font-medium">
              {t("notAskedTitle", { count: data.notAsked.length })}
            </h2>
            <p className="mb-3 text-xs opacity-60">{t("notAskedBody")}</p>
            <ul className="space-y-1.5 text-sm">
              {data.notAsked.map((entry) => (
                <li key={entry.fieldKey} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span>{entry.label}</span>
                  {entry.required && (
                    <span className="text-xs text-red-700">
                      {t("notAskedRequired")}
                    </span>
                  )}
                  {/* Overgeslagen en "voor jou" zijn verschillende dingen, en het
                      verschil bepaalt wat de behandelaar ermee moet. Het eerste is
                      een vraag die gesteld is en geen antwoord kreeg; het tweede
                      is een vraag die met opzet aan hem overgelaten is. */}
                  <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] opacity-70">
                    {entry.reason === "practitioner"
                      ? t("notAskedPractitioner")
                      : entry.skipReason === "declined"
                        ? t("notAskedDeclined")
                        : t("notAskedSkipped")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        </div>

        {/* Eigen scroll vanaf lg: de bijlagenlijst kan langer zijn dan het
            scherm, en dan hoort hij te scrollen zonder de veldenlijst
            ernaast mee te nemen. */}
        <aside className="min-w-0 lg:sticky lg:top-10 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto">
        <section className="mt-8 border-t border-black/10 pt-6 lg:mt-0 lg:border-t-0 lg:pt-0">
          <h2 className="mb-2 text-sm font-medium">{t("documentsTitle")}</h2>
          {/* Was een regel per bestand op xs met 70 procent dekking: een
              bijlagenlijst om te controleren dat er iets binnengekomen is. Sinds
              er een beschrijving bij zit is dat te klein. Een trainingsschema
              levert nauwelijks velden op, dus voor zo'n document IS deze alinea
              wat de coach ervan te zien krijgt. De bestandsnaam blijft klein,
              want die is nog steeds alleen een label. */}
          <ul className="space-y-4">
            {data.documents.map((document) => (
              <li key={document.id}>
                <p className="text-xs opacity-70">
                  {document.originalFilename} · {document.kind}
                  {document.pageCount && ` · ${t("pageCount", { count: document.pageCount })}`}
                  {document.processingError && (
                    <span className="text-red-700">
                      {" "}
                      · {documentError(document.processingError, locale)}
                    </span>
                  )}
                </p>
                {document.summary && (
                  <div className="mt-1.5">
                    <p className="text-sm">{document.summary}</p>
                    {/* Hetzelfde label als boven de klinische samenvatting, en om
                        dezelfde reden: het verschil tussen wat er staat en wat
                        een model eruit maakt hoort zichtbaar te blijven. Per
                        document en niet een keer onder de lijst, want bij drie
                        bijlagen heeft niet elke bijlage er een. */}
                    <p className="mt-1 text-xs opacity-50">{t("documentSummaryLabel")}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs opacity-50">
            {t("documentsNote")}
          </p>
        </section>

        {!locked && (
          <section className="mt-8 rounded-lg border border-black/10 p-4">
            <div className="flex items-center justify-between gap-4 lg:flex-col lg:items-stretch lg:gap-3">
              <div>
                <h2 className="text-sm font-medium">{t("approveTitle")}</h2>
                <p className="mt-1 text-xs opacity-70">
                  {conflicting.length > 0
                    ? t("approveBlocked")
                    : data.submittedAt
                      ? t("approveBody")
                      : t("approveNotSubmitted")}
                </p>
              </div>
              <button
                onClick={approve}
                disabled={
                  approving ||
                  conflicting.length > 0 ||
                  !data.submittedAt ||
                  (skippedRequired.length > 0 && !acceptGaps)
                }
                className="shrink-0 rounded-md bg-black px-3 py-1.5 text-xs text-white disabled:opacity-40"
              >
                {approving ? t("approveBusy") : t("approveButton")}
              </button>
            </div>

            {/* Een overgeslagen verplicht veld mag niet stilzwijgend meeglijden,
                maar het hard blokkeren zou het dossier voorgoed vastzetten: de
                atleet wist het niet, en soms weet de coach het ook niet. Dus een
                vinkje. Wat er ontbrak en dat de coach het wist, staat daarna in
                het auditspoor onder approvedWithGaps. */}
            {skippedRequired.length > 0 && (
              <div className="mt-3 rounded-md bg-amber-500/10 p-3">
                <p className="text-xs text-amber-800">
                  {t("approveGapsTitle", { count: skippedRequired.length })}
                </p>
                <ul className="mt-1.5 space-y-0.5 text-xs opacity-80">
                  {skippedRequired.map((entry) => (
                    <li key={entry.fieldKey}>
                      {entry.label}
                      {" · "}
                      {entry.skipReason === "declined"
                        ? t("notAskedDeclined")
                        : t("notAskedSkipped")}
                    </li>
                  ))}
                </ul>
                <label className="mt-2.5 flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={acceptGaps}
                    onChange={(event) => setAcceptGaps(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>{t("approveGapsAccept")}</span>
                </label>
              </div>
            )}

            {approveError && (
              <p className="mt-2 text-xs text-red-700">{approveError}</p>
            )}
          </section>
        )}

        <ExportBar intakeId={intakeId} />
        </aside>
      </div>
    </main>
  );
}
