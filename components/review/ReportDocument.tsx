import { sectionLabel } from "@/lib/intake/sections";
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


/** Wat er onder een waarde staat: waar hij vandaan komt en hoe hard hij is. */
function provenanceLine(field: SnapshotField): string {
  if (field.status === "missing") return "Not stated";

  const parts: string[] = [];

  if (field.proposedBy === "coach") parts.push("confirmed by coach");
  else if (field.proposedBy === "athlete") {
    parts.push(
      field.provenance?.documentId
        ? "confirmed by athlete"
        : "stated by athlete",
    );
  } else if (field.provenance?.documentFilename) {
    parts.push(
      `${field.provenance.documentFilename}${
        field.provenance.page ? `, page ${field.provenance.page}` : ""
      }`,
    );
    parts.push(field.provenance.quoteVerified ? "quote verified" : "quote not found");
  }

  if (field.status === "conflicting") parts.push("sources disagree");
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
          <p className="text-label uppercase text-ink-muted">Intake report</p>
          <p className="text-xl font-semibold tracking-tight">{practiceName}</p>
        </div>
        <div className="text-right text-xs text-ink-muted">
          <p className="font-mono">REF {reference}</p>
          <p>{dated ? dated.slice(0, 10) : "not submitted"}</p>
          <p>version {version}</p>
        </div>
      </header>

      <dl className="mt-4 grid grid-cols-3 gap-4 border-b border-hairline pb-4 text-sm">
        <div>
          <dt className="text-label uppercase text-ink-faint">Athlete</dt>
          <dd>{snapshot.athlete.fullName ?? fromDossier("identity.full_name") ?? "Name unknown"}</dd>
        </div>
        <div>
          <dt className="text-label uppercase text-ink-faint">Club</dt>
          <dd>{snapshot.athlete.club ?? fromDossier("identity.club") ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-label uppercase text-ink-faint">Federation</dt>
          <dd>{snapshot.athlete.federation ?? fromDossier("identity.federation") ?? "-"}</dd>
        </div>
      </dl>

      <section className="mt-4 flex items-baseline gap-6 border-b border-hairline pb-4 text-sm">
        <p>
          <strong>
            {snapshot.completeness.requiredFilled} of {snapshot.completeness.requiredTotal}
          </strong>{" "}
          required fields complete
        </p>
        <p className="text-ink-muted">
          {snapshot.completeness.filled} of {snapshot.completeness.total} fields known
        </p>
        {snapshot.completeness.conflicts > 0 && (
          <p className="text-warn">
            {snapshot.completeness.conflicts} unresolved contradiction
            {snapshot.completeness.conflicts === 1 ? "" : "s"}
          </p>
        )}
      </section>

      {flagged.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="text-label uppercase text-ink-faint">Needs review</h2>
          <ul className="mt-1.5 space-y-1 text-sm">
            {flagged.map((item) => (
              <li key={item.fieldKey}>
                <strong>{item.labelEn}</strong>
                <span className="text-ink-muted">
                  {" "}
                  {item.reason === "conflicting" ? "sources disagree" : "missing"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {snapshot.summary && (
        <section className="mt-5 break-inside-avoid border-l-2 border-hairline pl-3">
          <h2 className="text-label uppercase text-ink-faint">
            Generated summary ({snapshot.summary.kind})
          </h2>
          {/* Het label moet zeggen DAT dit machinewerk is, want de klant vroeg
              expliciet om onderscheid tussen wat er staat en wat iemand eruit
              concludeert. Welk model het schreef hoort daar niet bij: dat is een
              technisch gegeven en het staat in het snapshot en in het
              auditspoor, waar het reproduceerbaar is. Op papier zegt een
              modelnaam een kinesist niets en suggereert hij precisie over de
              inhoud die er niet is. */}
          <p className="mt-1 text-xs text-ink-muted">
            Automatically generated, not written by a clinician. Facts come from the
            documents provided; observations are interpretation, not diagnosis.
          </p>
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
                  <dt className="text-ink-muted">{field.labelEn}</dt>
                  <dd>
                    <p className={field.status === "missing" ? "text-ink-faint italic" : ""}>
                      {field.status === "missing" ? "Not stated" : field.displayValue}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">{provenanceLine(field)}</p>

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
            Injury timeline
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
                  <span className="text-ink-muted"> · from an earlier intake</span>
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
          Attachments
        </h2>
        {snapshot.documents.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint italic">No documents provided.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {snapshot.documents.map((document) => (
              <li key={document.id} className="break-inside-avoid">
                {document.filename}
                <span className="text-ink-faint">
                  {" · "}
                  {document.kind}
                  {document.pageCount ? ` · ${document.pageCount} pages` : ""}
                </span>
                {document.processingError && (
                  <span className="text-danger"> · {document.processingError}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-8 border-t border-hairline pt-3 text-xs text-ink-faint">
        <p>
          Generated from frozen version {version} (
          <span className="font-mono">{snapshot.contentHash.slice(0, 16)}</span>) on{" "}
          {snapshot.generatedAt.slice(0, 16).replace("T", " ")}.
        </p>
        <p className="mt-0.5">
          Corrections belong in the intake system, not on this printout. Consent version{" "}
          {snapshot.consent.version ?? "unknown"}
          {snapshot.consent.sharingAllowed
            ? "; the athlete consented to sharing with practitioners."
            : "; the athlete did not consent to sharing with practitioners."}
        </p>
      </footer>
    </article>
  );
}
