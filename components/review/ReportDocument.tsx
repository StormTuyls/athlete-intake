import { translator } from "@/lib/i18n/translator";
import { sectionLabel } from "@/lib/intake/sections";
import { documentError } from "@/lib/intake/format";
import type { Locale } from "@/lib/i18n/locale";
import type { ReportSnapshot, SnapshotField } from "@/lib/report/snapshot";
import { toSummaryBlocks } from "@/lib/report/summaryBlocks";

/**
 * Het intakerapport als document.
 *
 * Rendert uitsluitend uit een vastgelegd snapshot. Daarom staat de versie en de
 * hash in de voettekst: een uitdraai zonder die twee is niet terug te leiden
 * naar wat er goedgekeurd is, en dan is het een papiertje in plaats van een
 * document.
 *
 * De vormgeving is bewust rustig en print-eerst: geen kleurvlakken die inkt
 * kosten, geen kaartschaduwen die op papier grijs worden.
 */


type T = ReturnType<typeof translator<"report">>;

/** Wat er onder een waarde staat: waar hij vandaan komt en hoe hard hij is. */
function provenanceLine(field: SnapshotField, t: T): string {
  if (field.status === "missing") return t("notStated");

  const parts: string[] = [];

  if (field.proposedBy === "coach") parts.push(t("confirmedByCoach"));
  else if (field.proposedBy === "athlete") {
    parts.push(
      field.provenance?.documentId
        ? t("confirmedByAthlete")
        : t("statedByAthlete"),
    );
  } else if (field.provenance?.documentFilename) {
    parts.push(
      field.provenance.page
        ? t("documentPage", {
            filename: field.provenance.documentFilename,
            page: field.provenance.page,
          })
        : field.provenance.documentFilename,
    );
    parts.push(field.provenance.quoteVerified ? t("quoteVerified") : t("quoteNotFound"));
  }

  if (field.status === "conflicting") parts.push(t("sourcesDisagree"));
  return parts.join(" · ");
}

export function ReportDocument({
  snapshot,
  version,
  practiceName,
  locale,
}: {
  snapshot: ReportSnapshot;
  version: number;
  practiceName: string;
  /**
   * Als prop en niet uit de aanvraag. Dit component rendert een document, en
   * een document dat zijn eigen taal uit de omgeving haalt is niet te
   * hergebruiken buiten een render: gaat archiveren ooit via een headless
   * browser of een worker, dan moet dit blijven werken.
   */
  locale: Locale;
}) {
  const t = translator(locale, "report");

  /**
   * Het veldlabel in de taal van de lezer.
   *
   * Het snapshot draagt labelNl EN labelEn, dus een bevroren rapport is in
   * beide talen te renderen zonder opnieuw te bevriezen. Dat was al zo; alleen
   * pikte deze renderer altijd het Engelse.
   */
  const fieldLabel = (field: SnapshotField): string =>
    locale === "nl" ? field.labelNl : field.labelEn;

  /**
   * Hetzelfde voor de lijst met openstaande punten.
   *
   * openItems draagt alleen labelEn, en dat is de enige eentalige plek in het
   * snapshot. Er labelNl aan toevoegen zou de canonieke JSON veranderen, dus de
   * hash, dus zou elke bestaande intake bij de eerstvolgende export een nieuwe
   * versie minten met een modelcall erbij. Opzoeken kan ook: elk openItem heeft
   * een fieldKey die ook in snapshot.fields staat, en daar staan beide labels.
   */
  const openItemLabel = (fieldKey: string): string => {
    const field = snapshot.fields.find((candidate) => candidate.key === fieldKey);
    return field ? fieldLabel(field) : fieldKey;
  };
  const sections = [...new Set(snapshot.fields.map((f) => f.section))];
  const reference = snapshot.intake.id.slice(0, 8);
  const dated = snapshot.intake.submittedAt ?? snapshot.intake.startedAt;

  /**
   * Administratieve gegevens die de intake wel vond, maar public.athletes niet
   * heeft. Zonder deze terugval stond er "Name unknown" op een rapport dat
   * verderop de naam met citaat toont.
   *
   * Met opzet hier en niet in lib/report/collect.ts: `athlete` zit in de
   * gehashte inhoud van het snapshot, dus daar terugvallen verandert de hash van
   * elk bestaand dossier en mint bij de eerstvolgende export een nieuwe versie
   * plus een modelcall. Het snapshot bevat deze velden al, dus de renderer kan
   * ze gewoon opzoeken en niets bevroren gaat schuiven.
   *
   * Niet bij 'conflicting': twee namen in een dossier is precies waar het
   * systeem niet stil mag kiezen.
   */
  const fromDossier = (key: string): string | null => {
    const field = snapshot.fields.find((f) => f.key === key);
    if (!field || field.status === "conflicting" || field.status === "missing") return null;
    return typeof field.value === "string" && field.value.trim() !== ""
      ? field.value
      : null;
  };

  const flagged = snapshot.openItems.filter(
    (item) => item.required || item.reason === "conflicting",
  );

  return (
    <article className="report mx-auto max-w-[46rem] px-8 py-10 text-ink">
      <header className="flex items-start justify-between border-b border-ink pb-3">
        <div>
          <p className="text-label uppercase text-ink-muted">{t("title")}</p>
          <p className="text-xl font-semibold tracking-tight">{practiceName}</p>
        </div>
        <div className="text-right text-xs text-ink-muted">
          <p className="font-mono">{t("reference", { reference })}</p>
          <p>{dated ? dated.slice(0, 10) : t("notSubmitted")}</p>
          <p>{t("version", { version })}</p>
        </div>
      </header>

      <dl className="mt-4 grid grid-cols-3 gap-4 border-b border-hairline pb-4 text-sm">
        <div>
          <dt className="text-label uppercase text-ink-faint">{t("athlete")}</dt>
          <dd>{snapshot.athlete.fullName ?? fromDossier("identity.full_name") ?? t("nameUnknown")}</dd>
        </div>
        <div>
          <dt className="text-label uppercase text-ink-faint">{t("club")}</dt>
          <dd>{snapshot.athlete.club ?? fromDossier("identity.club") ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-label uppercase text-ink-faint">{t("federation")}</dt>
          <dd>{snapshot.athlete.federation ?? fromDossier("identity.federation") ?? "-"}</dd>
        </div>
      </dl>

      <section className="mt-4 flex items-baseline gap-6 border-b border-hairline pb-4 text-sm">
        <p>
          <strong>
            {snapshot.completeness.requiredFilled}/{snapshot.completeness.requiredTotal}
          </strong>{" "}
          {t("requiredComplete")}
        </p>
        <p className="text-ink-muted">
          {t("fieldsKnown", {
            filled: snapshot.completeness.filled,
            total: snapshot.completeness.total,
          })}
        </p>
        {snapshot.completeness.conflicts > 0 && (
          <p className="text-warn">
            {t("conflictsUnresolved", { count: snapshot.completeness.conflicts })}
          </p>
        )}
      </section>

      {flagged.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="text-label uppercase text-ink-faint">{t("needsReview")}</h2>
          <ul className="mt-1.5 space-y-1 text-sm">
            {flagged.map((item) => (
              <li key={item.fieldKey}>
                <strong>{openItemLabel(item.fieldKey)}</strong>
                <span className="text-ink-muted">
                  {" "}
                  {item.reason === "conflicting" ? t("reasonConflicting") : t("reasonMissing")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {snapshot.summary && (
        <section className="mt-5 break-inside-avoid border-l-2 border-hairline pl-3">
          <h2 className="text-label uppercase text-ink-faint">
            {t("summaryTitle", {
              kind:
                snapshot.summary.kind === "clinical"
                  ? t("summaryKindClinical")
                  : t("summaryKindCommercial"),
            })}
          </h2>
          {/* Het label moet zeggen DAT dit machinewerk is, want de klant vroeg
              expliciet om onderscheid tussen wat er staat en wat iemand eruit
              concludeert. Welk model het schreef hoort daar niet bij: dat is een
              technisch gegeven en het staat in het snapshot en in het
              auditspoor, waar het reproduceerbaar is. Op papier zegt een
              modelnaam een kinesist niets en suggereert hij precisie over de
              inhoud die er niet is. */}
          <p className="mt-1 text-xs text-ink-muted">
            {t("summaryDisclaimer")}
          </p>
          {/* Staat de tekst in een andere taal dan de pagina, zeg dat dan. Een
              Nederlandse samenvatting onder een Engelse kop zonder uitleg leest
              als een fout in plaats van als een keuze; de samenvatting volgt de
              taal van de praktijk, zie PRACTICE_LOCALE. */}
          {(snapshot.summary.locale ?? "nl") !== locale && (
            <p className="mt-1 text-xs text-ink-faint">
              {t("summaryLanguageNote", {
                language:
                  (snapshot.summary.locale ?? "nl") === "nl"
                    ? t("languageNl")
                    : t("languageEn"),
              })}
            </p>
          )}
          <div className="mt-2 space-y-1 text-sm">
            {toSummaryBlocks(snapshot.summary.text).map((block, index) =>
              block.kind === "heading" ? (
                <p key={index} className="mt-2.5 font-semibold first:mt-0">
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
        </section>
      )}

      {sections.map((section) => {
        const fields = snapshot.fields
          .filter((field) => field.section === section)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        return (
          <section key={section} className="mt-6">
            <h2 className="border-b border-hairline pb-1 text-label uppercase text-ink-faint">
              {sectionLabel(section, locale, "clinical")}
            </h2>
            <dl className="mt-2 space-y-2.5">
              {fields.map((field) => (
                <div key={field.key} className="grid grid-cols-[12rem_1fr] gap-3 break-inside-avoid text-sm">
                  <dt className="text-ink-muted">{fieldLabel(field)}</dt>
                  <dd>
                    <p className={field.status === "missing" ? "text-ink-faint italic" : ""}>
                      {field.status === "missing" ? t("notStated") : field.displayValue}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">{provenanceLine(field, t)}</p>

                    {/* Het systeem kiest niet tussen tegenstrijdige bronnen, dus
                        doet het document dat ook niet: beide waarden staan er. */}
                    {field.conflicts.map((rival) => (
                      <p key={rival.proposalId} className="mt-0.5 text-xs text-warn">
                        also stated: {String(rival.value)}
                        {rival.sourcePage ? ` (page ${rival.sourcePage})` : ""}
                      </p>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}

      {snapshot.injuries.length > 0 && (
        <section className="mt-6">
          <h2 className="border-b border-hairline pb-1 text-label uppercase text-ink-faint">
            {t("timeline")}
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {snapshot.injuries.map((injury, index) => (
              <li key={index} className="break-inside-avoid">
                <strong>{injury.bodyRegion}</strong>
                {injury.side !== "unknown" && ` (${injury.side})`}
                {injury.diagnosis && ` — ${injury.diagnosis}`}
                {/* Voorgeschiedenis hoort niet te lezen als een vondst uit deze
                    intake. Op een klinisch document is dat verschil het punt. */}
                {injury.fromEarlierIntake && (
                  <span className="text-ink-muted"> · {t("fromEarlierIntake")}</span>
                )}
                <span className="text-ink-faint">
                  {injury.onsetDate ? ` from ${injury.onsetDate}` : ""}
                  {injury.endDate ? ` to ${injury.endDate}` : ""}
                  {injury.documentFilename ? ` · ${injury.documentFilename}` : ""}
                  {injury.quote ? (injury.quoteVerified ? " · quote verified" : " · quote not found") : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="border-b border-hairline pb-1 text-label uppercase text-ink-faint">
          {t("attachments")}
        </h2>
        {snapshot.documents.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint italic">{t("noDocuments")}</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {snapshot.documents.map((document) => (
              <li key={document.id} className="break-inside-avoid">
                {document.filename}
                <span className="text-ink-faint">
                  {" · "}
                  {document.kind}
                  {document.pageCount ? ` · ${t("pages", { count: document.pageCount })}` : ""}
                </span>
                {document.processingError && (
                  <span className="text-danger"> · {documentError(document.processingError, locale)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-8 border-t border-hairline pt-3 text-xs text-ink-faint">
        <p>
          {t("footerVersion", {
            version,
            hash: snapshot.contentHash.slice(0, 16),
            date: snapshot.generatedAt.slice(0, 16).replace("T", " "),
          })}
        </p>
        <p className="mt-0.5">
          {t("footerCorrections", {
            version: snapshot.consent.version ?? t("unknown"),
          })}
          {snapshot.consent.sharingAllowed
            ? t("footerSharingYes")
            : t("footerSharingNo")}
        </p>
      </footer>
    </article>
  );
}
