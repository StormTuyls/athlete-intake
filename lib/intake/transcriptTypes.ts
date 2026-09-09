import type { Confidence, FieldDataType, FieldStatus, ProposedBy } from "@/lib/types";
import type { IntakeTitle } from "@/lib/intake/title";

// Doorgeven, zodat een client component het type kan gebruiken zonder
// lib/types.ts te importeren en daarmee de serverkant binnen te trekken.
export type { DocumentKind } from "@/lib/types";
import type { DocumentKind } from "@/lib/types";

/**
 * Wat het chatscherm van de server krijgt.
 *
 * Alleen types, geen imports die naar de databank leiden. Dat is de reden dat
 * dit bestand los staat van lib/intake/transcript.ts: die trekt `pg` binnen en
 * mag daarom nooit vanuit een client component geimporteerd worden, terwijl de
 * types dat juist wel moeten kunnen.
 *
 * Let op wat er NIET in staat: sourceQuote, sourcePage, sourceDocumentId of
 * proposedBy. app/api/intake/state/route.ts strippt die bewust voor de atleet,
 * en het chatscherm volgt dezelfde regel. Herkomst is voor het coachscherm.
 */

/** Een veld dat de assistent uit een antwoord of document heeft opgepikt. */
export interface CaptureCard {
  fieldKey: string;
  /** Label in de taal van de intake, server-side gekozen. */
  label: string;
  section: string;
  sectionLabel: string;
  /** Weergaveklare tekst, niet de ruwe jsonb-waarde. */
  value: string;
  status: FieldStatus;
  confidence: Confidence;
  /**
   * Wie de winnende waarde aandroeg. Nodig voor een eerlijk label: "citaat niet
   * teruggevonden" klopt bij een document, maar niet bij wat de atleet zelf
   * intypte. Daar is geen origineel om te zoeken.
   */
  proposedBy: ProposedBy | null;
  /**
   * Waar zolang het winnende voorstel van het model komt. Stuurt Confirm/Edit.
   * Afgeleid uit winning_proposal_id, dus geen extra kolom en na een reload nog
   * steeds waar.
   */
  needsConfirmation: boolean;
  /** Voor het invulveld bij Edit. Nooit het bronquote. */
  dataType: FieldDataType;
  enumOptions: string[] | null;
}

/** De sectie waar de assistent nu naar vraagt. */
export interface Collecting {
  section: string;
  label: string;
}

/** Voortgang in secties, plus de verplichte velden die submit poorten. */
export interface Progress {
  sectionsDone: number;
  sectionsTotal: number;
  requiredFilled: number;
  requiredTotal: number;
}

/**
 * De toestanden van een bestand in het gesprek.
 *
 * 'unread' is de belangrijke: het bestand staat in de opslag, de paginatekst is
 * eruit, en er is nog geen modelcall geweest. Dat is een eindtoestand en geen
 * tussenstap; er gebeurt niets meer tenzij de atleet erom vraagt. 'processing'
 * betekent dat hij dat gedaan heeft en dat het model bezig is.
 */
export type DocumentState =
  | "uploading"
  | "unread"
  | "processing"
  | "read"
  | "failed";

export type TranscriptItem =
  | { kind: "assistant"; id: string; at: string; text: string }
  | { kind: "athlete"; id: string; at: string; text: string }
  | { kind: "capture"; id: string; at: string; card: CaptureCard }
  | {
      kind: "document";
      id: string;
      at: string;
      /** Null zolang de upload nog loopt en de server het document nog niet kent. */
      documentId: string | null;
      filename: string;
      mimeType: string;
      byteSize: number;
      documentKind: DocumentKind | null;
      pageCount: number | null;
      state: DocumentState;
      error: string | null;
    }
  | {
      kind: "extraction";
      id: string;
      at: string;
      documentId: string;
      filename: string;
      cards: CaptureCard[];
      fieldsProposed: number;
      quotesVerified: number;
    };

export interface Completeness {
  total: number;
  filled: number;
  requiredTotal: number;
  requiredFilled: number;
  conflicts: number;
  readyToSubmit: boolean;
}

/** Antwoord van GET /api/intake/transcript. Alles wat het scherm bij mount nodig heeft. */
export interface TranscriptResponse {
  /** Nodig om naar het rapport van deze intake te kunnen linken. */
  intakeId: string;
  /**
   * Waar dit gesprek over gaat, zodra er een blessure of een pijnlocatie is.
   * Onopgemaakt, want de woorden eromheen hangen aan de taal van de kijker.
   */
  title: IntakeTitle;
  transcript: TranscriptItem[];
  collecting: Collecting | null;
  progress: Progress;
  completeness: Completeness;
  status: string;
  consentGrantedAt: string | null;
}
