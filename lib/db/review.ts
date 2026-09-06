import { query } from "@/lib/db/sql";
import { appDb } from "@/lib/supabase/service";
import { getFieldDefinitions, syncDossier } from "@/lib/db/dossier";
import { listDocuments, type DocumentSummary } from "@/lib/db/medical";
import { logAudit } from "@/lib/audit";
import { resolveInjuryTimeline, type TimelineEntry } from "@/lib/dossier/timeline";
import type { Proposal, ResolvedField } from "@/lib/types";

/**
 * Het volledige dossier voor het reviewscherm van de coach.
 *
 * Hier komt wel alles langs, inclusief herkomstcitaten. Dat is precies waarom
 * elke aanroep een audit-entry schrijft: leesacties op medische velden kunnen
 * databasetriggers niet zien.
 */

export interface InjuryRow {
  id: string;
  bodyRegion: string;
  side: string;
  diagnosis: string | null;
  onsetDate: string | null;
  endDate: string | null;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  quoteVerified: boolean;
}

/**
 * De ruwe vermeldingen. Elk document dat een blessure noemt staat hier apart,
 * met zijn eigen herkomst.
 */
export async function getInjuryEntries(intakeId: string): Promise<InjuryRow[]> {
  const rows = await query<{
    id: string;
    body_region: string;
    side: string;
    diagnosis: string | null;
    onset_date: Date | null;
    end_date: Date | null;
    source_document_id: string | null;
    source_page: number | null;
    source_quote: string | null;
    quote_verified: boolean;
  }>(
    `select id, body_region, side, diagnosis, onset_date, end_date,
            source_document_id, source_page, source_quote, quote_verified
     from medical.injury_events
     where intake_id = $1
     order by onset_date nulls last, id`,
    [intakeId],
  );

  return rows.map((row) => ({
    id: row.id,
    bodyRegion: row.body_region,
    side: row.side,
    diagnosis: row.diagnosis,
    onsetDate: row.onset_date ? row.onset_date.toISOString().slice(0, 10) : null,
    endDate: row.end_date ? row.end_date.toISOString().slice(0, 10) : null,
    sourceDocumentId: row.source_document_id,
    sourcePage: row.source_page,
    sourceQuote: row.source_quote,
    quoteVerified: row.quote_verified,
  }));
}

/**
 * De tijdlijn zoals de coach hem ziet: vermeldingen van dezelfde blessure
 * samengevoegd. Zie lib/dossier/timeline.ts voor de regel.
 */
export async function getInjuries(intakeId: string): Promise<TimelineEntry[]> {
  return resolveInjuryTimeline(await getInjuryEntries(intakeId));
}

/** Alle voorstellen per veld, zodat de coach ziet wat in welk document stond. */
export async function getProposalsByField(
  intakeId: string,
): Promise<Map<string, Proposal[]>> {
  const rows = await query<{
    id: string;
    field_key: string;
    value: unknown;
    proposed_by: Proposal["proposedBy"];
    source_document_id: string | null;
    source_page: number | null;
    source_quote: string | null;
    quote_verified: boolean;
    model_id: string | null;
    created_at: Date;
  }>(
    `select id, field_key, value, proposed_by, source_document_id, source_page,
            source_quote, quote_verified, model_id, created_at
     from medical.field_proposals where intake_id = $1 order by id desc`,
    [intakeId],
  );

  const byField = new Map<string, Proposal[]>();
  for (const row of rows) {
    const proposal: Proposal = {
      id: Number(row.id),
      fieldKey: row.field_key,
      value: row.value,
      proposedBy: row.proposed_by,
      sourceDocumentId: row.source_document_id,
      sourcePage: row.source_page,
      sourceQuote: row.source_quote,
      quoteVerified: row.quote_verified,
      modelId: row.model_id,
      createdAt: row.created_at.toISOString(),
    };
    const list = byField.get(row.field_key);
    if (list) list.push(proposal);
    else byField.set(row.field_key, [proposal]);
  }
  return byField;
}

export interface ReviewData {
  intakeId: string;
  athleteName: string | null;
  status: string;
  submittedAt: string | null;
  sections: Array<{
    section: string;
    fields: Array<{
      key: string;
      label: string;
      dataType: string;
      required: boolean;
      isMedical: boolean;
      enumOptions: string[] | null;
      value: unknown;
      status: ResolvedField["status"];
      confidence: ResolvedField["confidence"];
      proposedBy: ResolvedField["proposedBy"];
      conflicts: ResolvedField["conflicts"];
      proposals: Proposal[];
    }>;
  }>;
  injuries: TimelineEntry[];
  documents: DocumentSummary[];
  completeness: {
    total: number;
    filled: number;
    requiredTotal: number;
    requiredFilled: number;
    conflicts: number;
    readyToSubmit: boolean;
  };
}

type Embedded = { full_name: string | null } | Array<{ full_name: string | null }> | null;

function athleteNameFrom(embedded: unknown): string | null {
  const value = embedded as Embedded;
  if (!value) return null;
  if (Array.isArray(value)) return value[0]?.full_name ?? null;
  return value.full_name ?? null;
}

export async function getReviewData(intakeId: string): Promise<ReviewData | null> {
  const { data: intake, error } = await appDb()
    .from("intakes")
    .select("id, status, submitted_at, locale, athlete_id, athletes(full_name)")
    .eq("id", intakeId)
    .maybeSingle();

  if (error || !intake) return null;

  const [state, injuries, documents, proposals] = await Promise.all([
    syncDossier(intakeId, intake.locale as "nl" | "en"),
    getInjuries(intakeId),
    listDocuments(intakeId),
    getProposalsByField(intakeId),
  ]);

  await logAudit({
    action: "read",
    actorKind: "coach",
    entitySchema: "medical",
    entityTable: "dossier_fields",
    entityId: intakeId,
    detail: { screen: "review", fields: state.definitions.length },
  });

  const bySection = new Map<string, ReviewData["sections"][number]["fields"]>();
  for (const definition of state.definitions) {
    const field = state.resolved.get(definition.key);
    const entry = {
      key: definition.key,
      label: definition.labelNl,
      dataType: definition.dataType,
      required: definition.required,
      isMedical: definition.isMedical,
      enumOptions: definition.enumOptions,
      value: field?.value ?? null,
      status: field?.status ?? ("missing" as const),
      confidence: field?.confidence ?? ("low" as const),
      proposedBy: field?.proposedBy ?? null,
      conflicts: field?.conflicts ?? [],
      proposals: proposals.get(definition.key) ?? [],
    };
    const list = bySection.get(definition.section);
    if (list) list.push(entry);
    else bySection.set(definition.section, [entry]);
  }

  return {
    intakeId,
    // Een many-to-one embed komt als object terug, een one-to-many als array.
    // Beide vormen afhandelen is goedkoper dan erop vertrouwen.
    athleteName: athleteNameFrom(intake.athletes),
    status: intake.status as string,
    submittedAt: intake.submitted_at as string | null,
    sections: [...bySection.entries()].map(([section, fields]) => ({ section, fields })),
    injuries,
    documents,
    completeness: state.completeness,
  };
}

export { getFieldDefinitions };
