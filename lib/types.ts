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
