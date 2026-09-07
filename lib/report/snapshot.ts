import { createHash } from "node:crypto";
import type {
  Confidence,
  ConflictCandidate,
  DocumentKind,
  FieldDataType,
  FieldStatus,
  ProposedBy,
} from "@/lib/types";

/**
 * Het bevroren intakerapport.
 *
 * Waarom dit bestaat: de klinische samenvatting is een modelcall, en tot nu toe
 * werd die bij elke Notion-sync en elke klik opnieuw gedaan. Twee coaches konden
 * dus een andere samenvatting van hetzelfde dossier lezen, en van wat er
 * werkelijk naar Notion ging bestond geen enkele vastlegging. Voor een
 * medisch dossier is dat niet acceptabel: wie een samenvatting goedkeurt, moet
 * later kunnen aanwijzen welke tekst hij goedkeurde.
 *
 * Een snapshot is daarom zelfdragend. Documentnamen zijn opgelost, de
 * samenvatting staat erin, en er is geen tweede query nodig om hem te renderen.
 * Een export leest dit en nooit de live stand.
 *
 * `contentHash` gaat over de dossierinhoud, niet over de samenvatting en niet
 * over het tijdstip. Zo geldt: zelfde dossier betekent zelfde versie en dus
 * dezelfde samenvattingstekst, en pas een echte wijziging in het dossier levert
 * een nieuwe, benoemde versie op.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;

export type FreezeReason = "submit" | "export" | "approval";

export interface SnapshotProvenance {
  proposalId: number;
  proposedBy: ProposedBy;
  modelId: string | null;
  documentId: string | null;
  /** Opgelost, zodat een renderer niet terug hoeft te joinen op documents. */
  documentFilename: string | null;
  page: number | null;
  quote: string | null;
  quoteVerified: boolean;
}

export interface SnapshotField {
  key: string;
  section: string;
  sortOrder: number;
  labelNl: string;
  labelEn: string;
  dataType: FieldDataType;
  required: boolean;
  isMedical: boolean;
  /** De genormaliseerde waarde zoals hij in het dossier staat. */
  value: unknown;
  /** Weergaveklare tekst, zodat elke renderer hem gelijk opschrijft. */
  displayValue: string;
  status: FieldStatus;
  confidence: Confidence;
  proposedBy: ProposedBy | null;
  provenance: SnapshotProvenance | null;
  conflicts: ConflictCandidate[];
}

export interface SnapshotInjury {
  bodyRegion: string;
  side: string;
  diagnosis: string | null;
  onsetDate: string | null;
  endDate: string | null;
  documentFilename: string | null;
  page: number | null;
  quote: string | null;
  quoteVerified: boolean;
}

export interface SnapshotDocument {
  id: string;
  filename: string;
  kind: DocumentKind;
  mimeType: string;
  byteSize: number;
  pageCount: number | null;
  uploadedAt: string;
  processedAt: string | null;
  processingError: string | null;
}

export interface SnapshotSummary {
  /** Klinisch alleen met toestemming; anders zakelijk. Zie lib/notion/sync.ts. */
  kind: "clinical" | "commercial";
  text: string;
  modelId: string;
  generatedAt: string;
}

export interface ReportSnapshot {
  schemaVersion: number;
  contentHash: string;
  reason: FreezeReason;
  generatedAt: string;

  intake: {
    id: string;
    status: string;
    locale: "nl" | "en";
    startedAt: string | null;
    submittedAt: string | null;
  };

  athlete: {
    fullName: string | null;
    email: string | null;
    phone: string | null;
    club: string | null;
    federation: string | null;
  };

  consent: {
    version: string | null;
    grantedAt: string | null;
    withdrawnAt: string | null;
    /** Poort voor de klinische samenvatting: consent.share_with_practitioners. */
    sharingAllowed: boolean;
  };

  fields: SnapshotField[];
  injuries: SnapshotInjury[];
  documents: SnapshotDocument[];

  completeness: {
    total: number;
    filled: number;
    requiredTotal: number;
    requiredFilled: number;
    conflicts: number;
    readyToSubmit: boolean;
  };

  openItems: Array<{
    fieldKey: string;
    labelEn: string;
    required: boolean;
    reason: "missing" | "conflicting";
  }>;

  summary: SnapshotSummary | null;
}

/**
 * Het merk zegt: dit is uit de databank gelezen, niet net zelf berekend.
 *
 * Elke renderer en elke export neemt de gemerkte variant. Zo is "exports lezen
 * een bevroren versie" een compileerfeit in plaats van een afspraak die iemand
 * over een half jaar per ongeluk doorbreekt.
 */
declare const frozen: unique symbol;
export type FrozenReportSnapshot = ReportSnapshot & { readonly [frozen]: true };

/**
 * Velden die niet meetellen voor de hash.
 *
 * `generatedAt` moet eruit, anders is elke snapshot uniek en mint elke export een
 * nieuwe versie. Dat is precies het soort ding dat later "opgeruimd" wordt, dus
 * het staat hier met de reden erbij.
 *
 * `summary` moet er ook uit: die is afgeleid van de dossierinhoud, en zou hij
 * meetellen dan kan de hash pas berekend worden nadat de modelcall gedaan is, en
 * dan is hergebruik onmogelijk. De hash beantwoordt de vraag "is het dossier
 * veranderd", niet "is de tekst veranderd".
 */
const UNHASHED = new Set(["contentHash", "generatedAt", "reason", "summary"]);

/**
 * Canonieke vorm: sleutels gesorteerd, niet-inhoudelijke velden eruit.
 *
 * JSON.stringify bewaart de invoegorde van sleutels, dus zonder sorteren geeft
 * dezelfde inhoud een andere hash zodra iemand de volgorde van een object
 * verandert.
 */
function canonicalise(value: unknown, topLevel = false): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalise(item));
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (topLevel && UNHASHED.has(key)) continue;
    result[key] = canonicalise(source[key]);
  }
  return result;
}

export function contentHashOf(snapshot: ReportSnapshot): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalise(snapshot, true)))
    .digest("hex");
}
