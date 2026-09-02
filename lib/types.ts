/**
 * Kerndomeintypes. Dit is het contract waar de hele pijplijn op rust.
 *
 * Ontwerpprincipe: het model schrijft nooit rechtstreeks in het dossier. Het
 * stelt waarden voor met herkomst, de server verifieert het citaat, een regel
 * bepaalt het betrouwbaarheidsniveau, de coach keurt goed.
 */

/** Wie de waarde heeft voorgesteld. Bepaalt mede het betrouwbaarheidsniveau. */
export type ProposedBy = "model" | "athlete" | "coach";

export type FieldStatus =
  | "extracted" // uit een document gehaald
  | "inferred" // door het model afgeleid, niet letterlijk in de bron
  | "confirmed" // door de coach bevestigd
  | "missing" // nog niet ingevuld
  | "conflicting"; // meerdere bronnen spreken elkaar tegen

/**
 * Deterministisch, nooit zelfgerapporteerd door het model.
 *  high   = door coach bevestigd, of citaat geverifieerd + typevalidatie ok + geen conflict
 *  medium = uit document, citaat niet terugvindbaar, geen conflict
 *  low    = afgeleid, of conflicterende waarden
 */
export type Confidence = "high" | "medium" | "low";

/** Herkomst van een veldwaarde. Verplicht bij alles wat uit een document komt. */
export interface Provenance {
  sourceDocumentId: string;
  sourcePage: number | null;
  /** Letterlijk citaat uit de bron. Server verifieert dit tegen document_pages. */
  sourceQuote: string | null;
  quoteVerified: boolean;
}

export interface FieldValue<T = unknown> {
  fieldKey: string;
  value: T | null;
  status: FieldStatus;
  confidence: Confidence;
  proposedBy: ProposedBy;
  provenance: Provenance | null;
  /** Model-id waarmee de waarde is voorgesteld, voor reproduceerbaarheid. */
  modelId: string | null;
  createdAt: string;
}

export type DocumentKind =
  | "pdf_text"
  | "pdf_scanned"
  | "image"
  | "whatsapp_export"
  | "vald_csv";

export interface IntakeDocument {
  id: string;
  intakeId: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  kind: DocumentKind;
  /** Files API id, zodat hetzelfde document niet per call opnieuw geupload wordt. */
  anthropicFileId: string | null;
}

export type IntakeStatus = "draft" | "submitted" | "in_review" | "approved";

/**
 * Wat het model per veld mag teruggeven. `sourceQuote` is een schemavereiste,
 * geen vrije keuze, zodat provenance niet optioneel is.
 */
export interface ExtractedField {
  fieldKey: string;
  value: unknown;
  sourcePage: number | null;
  sourceQuote: string;
}

export type FieldDataType =
  | "text"
  | "long_text"
  | "number"
  | "date"
  | "boolean"
  | "enum"
  | "list";

/** Een rij uit public.field_definitions. De taxonomie, bevroren na M1. */
export interface FieldDefinition {
  key: string;
  section: string;
  sortOrder: number;
  labelNl: string;
  labelEn: string;
  dataType: FieldDataType;
  required: boolean;
  isMedical: boolean;
  enumOptions: string[] | null;
  questionNl: string | null;
  questionEn: string | null;
}

/**
 * Een voorstel uit medical.field_proposals. Append-only: elk voorstel blijft
 * staan, ook als het niet gewonnen heeft. De historie is deel van het spoor.
 */
export interface Proposal {
  id: number;
  fieldKey: string;
  value: unknown;
  proposedBy: ProposedBy;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  quoteVerified: boolean;
  modelId: string | null;
  createdAt: string;
}

/** Een rivaal bij een conflict, zoals opgeslagen in dossier_fields.conflicts. */
export interface ConflictCandidate {
  proposalId: number;
  value: unknown;
  proposedBy: ProposedBy;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
}

/** Een rij uit medical.dossier_fields: de opgeloste toestand van een veld. */
export interface ResolvedField {
  fieldKey: string;
  value: unknown;
  status: FieldStatus;
  confidence: Confidence;
  winningProposalId: number | null;
  conflicts: ConflictCandidate[];
  /**
   * Wie de winnende waarde aandroeg. Niet opgeslagen in dossier_fields: dit
   * komt uit de merge en is null als het dossier uit de databank gelezen wordt.
   *
   * Nodig omdat "betrouwbaarheid medium" twee heel verschillende oorzaken heeft:
   * een citaat uit een scan dat niet te verifieren was, of een antwoord dat de
   * atleet zelf typte. Die tweede tegen "het origineel" laten controleren is
   * onzinnig advies, en dat deed de samenvatting voor deze correctie.
   */
  proposedBy: ProposedBy | null;
}
