import { query, queryOne, transaction } from "@/lib/db/sql";
import type { DocumentPage } from "@/lib/extract/pages";
import type {
  ConflictCandidate,
  DocumentKind,
  Proposal,
  ProposedBy,
  ResolvedField,
} from "@/lib/types";

/**
 * jsonb `null` is niet hetzelfde als SQL `NULL`.
 *
 * JSON.stringify(null) geeft de string "null", en die landt als een geldige
 * jsonb-waarde in de kolom. `value is null` is dan false, en de constraint
 * dossier_fields_missing_has_no_value slaat toe, terecht: een veld met status
 * 'missing' dat toch een waarde bevat is een tegenstrijdigheid. De databank ving
 * dit tijdens de eerste evalrun, wat precies de bedoeling van die check was.
 */
function toJsonb(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

/**
 * Alle toegang tot het `medical`-schema, op één plek.
 *
 * Eén module zodat er precies één bestand is dat medische data aanraakt en er
 * dus precies één plek is om te reviewen. Alles hier loopt via de directe
 * Postgres-verbinding, nooit via PostgREST.
 */

export async function upsertDocument(input: {
  intakeId: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  kind: DocumentKind;
  pageCount: number | null;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `insert into medical.documents
       (intake_id, storage_path, original_filename, mime_type, byte_size, sha256, kind, page_count)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (storage_path) do update
       set original_filename = excluded.original_filename,
           mime_type = excluded.mime_type,
           byte_size = excluded.byte_size,
           sha256 = excluded.sha256,
           kind = excluded.kind,
           page_count = excluded.page_count
     returning id`,
    [
      input.intakeId,
      input.storagePath,
      input.originalFilename,
      input.mimeType,
      input.byteSize,
      input.sha256,
      input.kind,
      input.pageCount,
    ],
  );

  if (!row) throw new Error("document registreren gaf geen id terug");
  return row.id;
}

export async function savePages(
  documentId: string,
  pages: DocumentPage[],
): Promise<void> {
  if (pages.length === 0) return;

  await transaction(async (run) => {
    for (const page of pages) {
      await run(
        `insert into medical.document_pages (document_id, page_number, text)
         values ($1, $2, $3)
         on conflict (document_id, page_number) do update set text = excluded.text`,
        [documentId, page.pageNumber, page.text],
      );
    }
  });
}

export async function getPages(documentId: string): Promise<DocumentPage[]> {
  const rows = await query<{ page_number: number; text: string }>(
    `select page_number, text from medical.document_pages
     where document_id = $1 order by page_number`,
    [documentId],
  );
  return rows.map((row) => ({ pageNumber: row.page_number, text: row.text }));
}

export async function markProcessed(
  documentId: string,
  error: string | null,
): Promise<void> {
  await query(
    `update medical.documents
     set processed_at = case when $2::text is null then now() else processed_at end,
         processing_error = $2
     where id = $1`,
    [documentId, error],
  );
}

export interface DocumentSummary {
  id: string;
  originalFilename: string;
  mimeType: string;
  /** Nodig voor de regel "1.3 MB · scanned" onder een bestandsbubbel na een reload. */
  byteSize: number;
  kind: DocumentKind;
  pageCount: number | null;
  uploadedAt: string;
  processedAt: string | null;
  processingError: string | null;
}

export async function listDocuments(intakeId: string): Promise<DocumentSummary[]> {
  const rows = await query<{
    id: string;
    original_filename: string;
    mime_type: string;
    byte_size: string;
    kind: DocumentKind;
    page_count: number | null;
    uploaded_at: Date;
    processed_at: Date | null;
    processing_error: string | null;
  }>(
    `select id, original_filename, mime_type, byte_size, kind, page_count,
            uploaded_at, processed_at, processing_error
     from medical.documents where intake_id = $1 order by uploaded_at`,
    [intakeId],
  );

  return rows.map((row) => ({
    id: row.id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    // byte_size is bigint en komt als string uit pg.
    byteSize: Number(row.byte_size),
    kind: row.kind,
    pageCount: row.page_count,
    uploadedAt: row.uploaded_at.toISOString(),
    processedAt: row.processed_at?.toISOString() ?? null,
    processingError: row.processing_error,
  }));
}

export interface NewProposal {
  fieldKey: string;
  value: unknown;
  proposedBy: ProposedBy;
  sourceDocumentId?: string | null;
  sourcePage?: number | null;
  sourceQuote?: string | null;
  quoteVerified?: boolean;
  modelId?: string | null;
}

export async function addProposals(
  intakeId: string,
  proposals: NewProposal[],
): Promise<void> {
  if (proposals.length === 0) return;

  await transaction(async (run) => {
    for (const proposal of proposals) {
      await run(
        `insert into medical.field_proposals
           (intake_id, field_key, value, proposed_by,
            source_document_id, source_page, source_quote, quote_verified, model_id)
         values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)`,
        [
          intakeId,
          proposal.fieldKey,
          toJsonb(proposal.value),
          proposal.proposedBy,
          proposal.sourceDocumentId ?? null,
          proposal.sourcePage ?? null,
          proposal.sourceQuote ?? null,
          proposal.quoteVerified ?? false,
          proposal.modelId ?? null,
        ],
      );
    }
  });
}

export async function getProposals(intakeId: string): Promise<Proposal[]> {
  const rows = await query<{
    id: string;
    field_key: string;
    value: unknown;
    proposed_by: ProposedBy;
    source_document_id: string | null;
    source_page: number | null;
    source_quote: string | null;
    quote_verified: boolean;
    model_id: string | null;
    created_at: Date;
  }>(
    `select id, field_key, value, proposed_by, source_document_id,
            source_page, source_quote, quote_verified, model_id, created_at
     from medical.field_proposals where intake_id = $1 order by id`,
    [intakeId],
  );

  return rows.map((row) => ({
    // bigint komt als string terug uit pg; de merge-regel sorteert erop.
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
  }));
}

/**
 * Schrijft de herberekende stand weg, maar alleen waar hij echt veranderd is.
 *
 * `dossier_fields` is een afgeleide cache die bij elke read opnieuw berekend
 * wordt (zie syncDossier). Zonder de where-clausule hieronder schrijft elke read
 * alle 41 rijen, en omdat audit_dossier_fields een row-trigger is levert dat 41
 * auditregels op met `changed: ["updated_at"]`. Een paar keer een dossier openen
 * begraaft het echte spoor dan onder ruis, en dat spoor is precies waar dit
 * systeem voor bestaat.
 *
 * `is distinct from` en niet `<>`, want een kolom die van null naar een waarde
 * gaat (of omgekeerd) moet als wijziging tellen; `<>` geeft daar null.
 */
export async function saveDossier(
  intakeId: string,
  fields: ResolvedField[],
): Promise<void> {
  await transaction(async (run) => {
    for (const field of fields) {
      await run(
        `insert into medical.dossier_fields
           (intake_id, field_key, value, status, confidence, winning_proposal_id, conflicts, updated_at)
         values ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, now())
         on conflict (intake_id, field_key) do update
           set value = excluded.value,
               status = excluded.status,
               confidence = excluded.confidence,
               winning_proposal_id = excluded.winning_proposal_id,
               conflicts = excluded.conflicts,
               updated_at = now()
         where dossier_fields.value               is distinct from excluded.value
            or dossier_fields.status              is distinct from excluded.status
            or dossier_fields.confidence          is distinct from excluded.confidence
            or dossier_fields.winning_proposal_id is distinct from excluded.winning_proposal_id
            or dossier_fields.conflicts           is distinct from excluded.conflicts`,
        [
          intakeId,
          field.fieldKey,
          toJsonb(field.value),
          field.status,
          field.confidence,
          field.winningProposalId,
          JSON.stringify(field.conflicts),
        ],
      );
    }
  });
}

export interface DossierRow extends ResolvedField {
  conflicts: ConflictCandidate[];
}

export async function readDossier(intakeId: string): Promise<DossierRow[]> {
  const rows = await query<{
    field_key: string;
    value: unknown;
    status: ResolvedField["status"];
    confidence: ResolvedField["confidence"];
    winning_proposal_id: string | null;
    conflicts: ConflictCandidate[];
  }>(
    `select field_key, value, status, confidence, winning_proposal_id, conflicts
     from medical.dossier_fields where intake_id = $1`,
    [intakeId],
  );

  return rows.map((row) => ({
    fieldKey: row.field_key,
    value: row.value,
    status: row.status,
    confidence: row.confidence,
    winningProposalId: row.winning_proposal_id ? Number(row.winning_proposal_id) : null,
    conflicts: row.conflicts ?? [],
  }));
}

export interface NewInjury {
  athleteId: string;
  intakeId: string;
  bodyRegion: string;
  side: "left" | "right" | "bilateral" | "unknown";
  diagnosis: string | null;
  onsetDate: string | null;
  endDate: string | null;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  quoteVerified: boolean;
}

export async function addInjuries(injuries: NewInjury[]): Promise<void> {
  if (injuries.length === 0) return;

  await transaction(async (run) => {
    for (const injury of injuries) {
      await run(
        `insert into medical.injury_events
           (athlete_id, intake_id, body_region, side, diagnosis, onset_date, end_date,
            source_document_id, source_page, source_quote, quote_verified)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          injury.athleteId,
          injury.intakeId,
          injury.bodyRegion,
          injury.side,
          injury.diagnosis,
          injury.onsetDate,
          injury.endDate,
          injury.sourceDocumentId,
          injury.sourcePage,
          injury.sourceQuote,
          injury.quoteVerified,
        ],
      );
    }
  });
}

/** De atleet achter een intake. Leesrecht op public.intakes is genoeg. */
export async function athleteIdForIntake(intakeId: string): Promise<string> {
  const row = await queryOne<{ athlete_id: string }>(
    "select athlete_id from public.intakes where id = $1",
    [intakeId],
  );
  if (!row) throw new Error(`intake ${intakeId} niet gevonden`);
  return row.athlete_id;
}
