import { appDb } from "@/lib/supabase/service";
import { getProposals, syncDossier } from "@/lib/db/dossier";
import { listDocuments } from "@/lib/db/medical";
import { getInjuries } from "@/lib/db/review";
import { formatValue } from "@/lib/intake/format";
import {
  contentHashOf,
  SNAPSHOT_SCHEMA_VERSION,
  type FreezeReason,
  type ReportSnapshot,
  type SnapshotField,
} from "@/lib/report/snapshot";

/**
 * Bouwt een snapshot uit de huidige stand.
 *
 * Geeft met opzet de ONgemerkte ReportSnapshot terug: dit is live data, geen
 * bevroren versie. Alleen lib/report/freeze.ts mag er een gemerkte van maken, en
 * dan pas nadat hij is weggeschreven. Zo kan een export nooit per ongeluk op een
 * net berekende stand renderen.
 *
 * De samenvatting blijft hier leeg. Die kost een modelcall, en of die nodig is
 * hangt af van de vraag of het dossier veranderd is; dat weet freeze.ts pas na
 * het vergelijken van de hash.
 */
export async function collectReportData(
  intakeId: string,
  reason: FreezeReason,
): Promise<ReportSnapshot> {
  const { data: intake, error } = await appDb()
    .from("intakes")
    .select("id, status, locale, started_at, submitted_at, consent_granted_at, athlete_id")
    .eq("id", intakeId)
    .single();

  if (error || !intake) throw new Error(`intake niet gevonden: ${error?.message}`);

  const locale = (intake.locale as "nl" | "en") ?? "nl";

  const [state, proposals, documents, injuryRows, athleteRow, consentRow] =
    await Promise.all([
      syncDossier(intakeId, locale),
      getProposals(intakeId),
      listDocuments(intakeId),
      getInjuries(intakeId),
      appDb()
        .from("athletes")
        .select("full_name, email, phone, club, federation")
        .eq("id", intake.athlete_id)
        .single(),
      appDb()
        .from("consents")
        .select("consent_version, granted_at, withdrawn_at")
        .eq("intake_id", intakeId)
        .order("granted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const proposalById = new Map(proposals.map((p) => [p.id, p]));
  const filenameById = new Map(documents.map((d) => [d.id, d.originalFilename]));

  const fields: SnapshotField[] = state.definitions.map((definition) => {
    const resolved = state.resolved.get(definition.key);
    const winner =
      resolved?.winningProposalId === null || resolved?.winningProposalId === undefined
        ? undefined
        : proposalById.get(resolved.winningProposalId);

    return {
      key: definition.key,
      section: definition.section,
      sortOrder: definition.sortOrder,
      labelNl: definition.labelNl,
      labelEn: definition.labelEn,
      dataType: definition.dataType,
      required: definition.required,
      isMedical: definition.isMedical,
      value: resolved?.value ?? null,
      displayValue: formatValue(definition, resolved?.value ?? null),
      status: resolved?.status ?? "missing",
      confidence: resolved?.confidence ?? "low",
      proposedBy: resolved?.proposedBy ?? null,
      provenance: winner
        ? {
            proposalId: winner.id,
            proposedBy: winner.proposedBy,
            modelId: winner.modelId,
            documentId: winner.sourceDocumentId,
            documentFilename: winner.sourceDocumentId
              ? (filenameById.get(winner.sourceDocumentId) ?? null)
              : null,
            page: winner.sourcePage,
            quote: winner.sourceQuote,
            quoteVerified: winner.quoteVerified,
          }
        : null,
      conflicts: resolved?.conflicts ?? [],
    };
  });

  const snapshot: ReportSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    contentHash: "",
    reason,
    generatedAt: new Date().toISOString(),

    intake: {
      id: intakeId,
      status: intake.status as string,
      locale,
      startedAt: (intake.started_at as string | null) ?? null,
      submittedAt: (intake.submitted_at as string | null) ?? null,
    },

    athlete: {
      fullName: athleteRow.data?.full_name ?? null,
      email: athleteRow.data?.email ?? null,
      phone: athleteRow.data?.phone ?? null,
      club: athleteRow.data?.club ?? null,
      federation: athleteRow.data?.federation ?? null,
    },

    consent: {
      version: consentRow.data?.consent_version ?? null,
      grantedAt:
        consentRow.data?.granted_at ?? (intake.consent_granted_at as string | null) ?? null,
      withdrawnAt: consentRow.data?.withdrawn_at ?? null,
      // Dezelfde poort als lib/notion/sync.ts gebruikt, en met opzet uit het
      // dossierveld: dat veld is een spiegel van public.consents en de chat kan
      // er niet meer aankomen (zie de consentfilter in de chatroute).
      sharingAllowed:
        state.resolved.get("consent.share_with_practitioners")?.value === true,
    },

    fields,

    // De samengevoegde tijdlijn en niet de ruwe vermeldingen. Ruw stonden
    // dezelfde hamstring uit twee documenten als twee blessures in het rapport,
    // en met de historie van eerdere intakes erbij zou dat vier of zes regels
    // worden voor één klacht. Het reviewscherm toonde de samengevoegde versie
    // al; nu zegt het rapport hetzelfde.
    injuries: injuryRows.map((injury) => ({
      bodyRegion: injury.bodyRegion,
      side: injury.side,
      diagnosis: injury.diagnosis,
      onsetDate: injury.onsetDate,
      endDate: injury.endDate,
      documentFilename: injury.sourceDocumentId
        ? (filenameById.get(injury.sourceDocumentId) ?? null)
        : null,
      page: injury.sourcePage,
      quote: injury.sourceQuote,
      quoteVerified: injury.quoteVerified,
      fromEarlierIntake: injury.fromEarlierIntake,
    })),

    documents: documents.map((document) => ({
      id: document.id,
      filename: document.originalFilename,
      kind: document.kind,
      mimeType: document.mimeType,
      byteSize: document.byteSize,
      pageCount: document.pageCount,
      uploadedAt: document.uploadedAt,
      processedAt: document.processedAt,
      processingError: document.processingError,
    })),

    completeness: state.completeness,

    openItems: state.gaps.map((gap) => {
      const definition = state.definitions.find((d) => d.key === gap.fieldKey);
      return {
        fieldKey: gap.fieldKey,
        labelEn: definition?.labelEn ?? gap.fieldKey,
        required: gap.required,
        reason: gap.reason,
      };
    }),

    summary: null,
  };

  snapshot.contentHash = contentHashOf(snapshot);
  return snapshot;
}
