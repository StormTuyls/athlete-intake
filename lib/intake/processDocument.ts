import { createHash } from "node:crypto";
import { storage, DOCUMENTS_BUCKET } from "@/lib/supabase/service";
import { extractPages, looksScanned, type DocumentPage } from "@/lib/extract/pages";
import { parseWhatsAppExport, whatsAppToPlainText } from "@/lib/extract/whatsapp";
import { extractDocument, type ExtractionInput } from "@/lib/claude/extractDocument";
import { verifyQuote } from "@/lib/verify/quote";
import {
  addInjuries,
  addProposals,
  athleteIdForIntake,
  countProposalsForDocument,
  documentForReading,
  findDocumentBySha,
  getPages,
  markProcessed,
  savePages,
  upsertDocument,
} from "@/lib/db/medical";
import { getFieldDefinitions, syncDossier } from "@/lib/db/dossier";
import type { DocumentKind } from "@/lib/types";

/**
 * Een document binnenhalen en, apart, een document laten lezen.
 *
 * Twee stappen en niet een, en de knip zit op de onomkeerbare helft. Uploaden
 * legt een bestand neer en leest de tekst eruit; er komt geen modelcall aan te
 * pas en er verschijnt geen enkel voorstel in het dossier. Pas als de atleet
 * zegt "lees dit" gaat het document naar het model en kunnen er waarden uit
 * volgen.
 *
 * Waarom dat onderscheid bestaat: een intake is niet "alles wat ik toevallig
 * op mijn telefoon had staan". Iemand die drie scans bij de hand heeft moet ze
 * alle drie kunnen neerleggen en dan kiezen welke over deze klacht gaan. Zonder
 * de knip is elke upload meteen een dossiermutatie, en dan is de enige manier
 * om je te bedenken een correctie achteraf.
 *
 * Wat de knip niet is: uitstel van de opslag. Het ruwe bestand staat na stap
 * een gewoon in de bucket en wordt nooit weggegooid. `processed_at is null` met
 * een lege `processing_error` betekent precies "wel binnen, nog niet gelezen";
 * daar was geen migratie voor nodig, die toestand paste al in de tabel.
 */

/** Claude accepteert deze beeldformaten; HEIC niet. */
const SUPPORTED_IMAGE = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export interface RegisterResult {
  documentId: string;
  kind: DocumentKind;
  pageCount: number;
  /** Waar als dit bestand al eerder aangeleverd was; er is dan niets opnieuw gelezen. */
  duplicate: boolean;
  /** Waar als datzelfde bestand ook al gelezen is. Dan valt er niets meer te lezen. */
  alreadyRead: boolean;
}

export interface ReadResult {
  documentId: string;
  kind: DocumentKind;
  pageCount: number;
  fieldsProposed: number;
  quotesVerified: number;
  injuriesFound: number;
  /** Waar als dit document al gelezen was; de tellingen komen dan uit de databank. */
  duplicate: boolean;
}

/** Hoe een bestand gelezen moet worden, afgeleid uit het mimetype. */
function planFor(
  mimeType: string,
  bytes: Uint8Array,
): { kind: DocumentKind; pages: DocumentPage[]; extraction: ExtractionInput } {
  if (mimeType === "application/pdf") {
    const pages: DocumentPage[] = [];
    return { kind: "pdf_text", pages, extraction: { kind: "pdf", bytes } };
  }

  if (mimeType.startsWith("image/")) {
    return {
      kind: "image",
      pages: [],
      extraction: {
        kind: "image",
        bytes,
        mediaType: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      },
    };
  }

  if (mimeType === "text/csv") {
    const text = new TextDecoder().decode(bytes);
    return {
      kind: "vald_csv",
      pages: [{ pageNumber: 1, text }],
      extraction: { kind: "text", text },
    };
  }

  const raw = new TextDecoder().decode(bytes);
  const messages = parseWhatsAppExport(raw);
  // Een WhatsApp-export herkennen we eraan dat de parser er berichten uit
  // haalt, niet aan de bestandsnaam.
  const isChat = messages.length > 0;
  const text = isChat ? whatsAppToPlainText(messages) : raw;

  return {
    kind: isChat ? "whatsapp_export" : "pdf_text",
    pages: [{ pageNumber: 1, text }],
    extraction: { kind: "text", text },
  };
}

async function download(storagePath: string): Promise<Uint8Array> {
  const result = await storage().from(DOCUMENTS_BUCKET).download(storagePath);
  if (result.error || !result.data) {
    throw new Error(`document downloaden mislukt: ${result.error?.message}`);
  }
  return new Uint8Array(await result.data.arrayBuffer());
}

/**
 * Stap een: het bestand hoort er nu bij, maar er is niets uit gehaald.
 *
 * Wel de paginatekst, want die is geen interpretatie: het is wat er letterlijk
 * staat, en zonder die tabel kan citaatverificatie later niet bestaan. Het
 * kost ook geen modelcall, dus het scheelt straks wachttijd op het moment dat
 * de atleet wel op lezen drukt.
 */
export async function registerDocument(input: {
  intakeId: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
}): Promise<RegisterResult> {
  const bytes = await download(input.storagePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // Zelfde inhoud, al eerder aangeleverd: teruggeven wat er al staat. Geen
  // tweede rij, en geen 23505 op de unieke index.
  const existing = await findDocumentBySha(input.intakeId, sha256);
  if (existing) {
    return {
      documentId: existing.id,
      kind: existing.kind,
      pageCount: existing.pageCount ?? 0,
      duplicate: true,
      alreadyRead: Boolean(existing.processedAt) && !existing.processingError,
    };
  }

  const plan = planFor(input.mimeType, bytes);
  let kind = plan.kind;
  let pages = plan.pages;

  if (input.mimeType === "application/pdf") {
    pages = await extractPages(bytes);
    // Een scan levert bij tekstextractie vrijwel niets op. Die gaat straks
    // visueel naar het model, en zijn citaten zijn dus niet te verifieren: die
    // velden blijven op 'medium' tot de coach ze bevestigt.
    kind = looksScanned(pages) ? "pdf_scanned" : "pdf_text";
  }

  const documentId = await upsertDocument({
    ...input,
    sha256,
    byteSize: bytes.length,
    kind,
    pageCount: pages.length > 0 ? pages.length : null,
  });

  // Een beeldformaat dat Claude niet kan lezen weigeren we hier al, en niet
  // straks bij het lezen. Anders staat er een bestand met een leesknop die
  // altijd faalt.
  if (kind === "image" && !SUPPORTED_IMAGE.has(input.mimeType)) {
    await markProcessed(documentId, "unsupportedImage");
    throw new Error(`beeldformaat ${input.mimeType} niet ondersteund`);
  }

  await savePages(documentId, pages);

  return {
    documentId,
    kind,
    pageCount: pages.length,
    duplicate: false,
    alreadyRead: false,
  };
}

/**
 * Stap twee: het document door het model halen en het dossier bijwerken.
 *
 * Vanaf hier kan er iets in het dossier belanden, dus dit gebeurt alleen op
 * expliciet verzoek. Klapt de extractie, dan blijft het document staan met een
 * processing_error en is er niets verloren: niets mag uitsluitend in een
 * AI-samenvatting leven, dus mag een mislukte samenvatting ook nooit het
 * origineel meenemen.
 */
export async function readDocument(input: {
  intakeId: string;
  documentId: string;
}): Promise<ReadResult> {
  const document = await documentForReading(input.intakeId, input.documentId);
  if (!document) throw new Error("document niet gevonden");

  const pages = await getPages(document.id);

  // Al gelezen: de tellingen uit de databank, geen tweede modelcall. Twee keer
  // op dezelfde knop drukken hoort geen tweede set voorstellen op te leveren.
  if (document.processedAt && !document.processingError) {
    const counts = await countProposalsForDocument(document.id);
    return {
      documentId: document.id,
      kind: document.kind,
      pageCount: pages.length,
      fieldsProposed: counts.fields,
      quotesVerified: counts.verified,
      injuriesFound: counts.injuries,
      duplicate: true,
    };
  }

  const bytes = await download(document.storagePath);
  const { extraction: extractionInput } = planFor(document.mimeType, bytes);
  const definitions = await getFieldDefinitions();

  let extraction: Awaited<ReturnType<typeof extractDocument>>;
  try {
    extraction = await extractDocument(extractionInput, definitions);
  } catch (error) {
    // De echte fout gaat naar de log, niet in de databank.
    //
    // `processing_error` komt via de transcriptie op het scherm van de atleet
    // terecht, en `error.message` is de melding van onze eigen infrastructuur.
    // Bij een ontbrekende sleutel las een atleet letterlijk
    // "ANTHROPIC_API_KEY ontbreekt". Dat is een interne naam, het zegt hem
    // niets, en het hoort niet buiten de server te komen. Zie ook lib/http.ts,
    // waar dezelfde regel geldt voor HTTP-antwoorden.
    console.error("[intake] extractie mislukt", { documentId: document.id, error });
    // Een code en geen volzin. Deze kolom is OPGESLAGEN en komt op drie
    // schermen terecht, dus een Engelse zin in de databank betekent een Engelse
    // zin in een Nederlandse interface, voor altijd. Zie documentError().
    await markProcessed(document.id, "unreadable");
    throw error;
  }

  // Citaatverificatie. Het model zegt op welke pagina het citaat staat; wij
  // controleren dat tegen de brontekst en gebruiken de pagina die wij vinden.
  let quotesVerified = 0;
  const proposals = extraction.fields.map((field) => {
    const check =
      pages.length > 0
        ? verifyQuote(field.sourceQuote, pages)
        : { verified: false, pageNumber: null, overlap: 0 };
    if (check.verified) quotesVerified++;

    return {
      fieldKey: field.fieldKey,
      value: field.value,
      proposedBy: "model" as const,
      sourceDocumentId: document.id,
      sourcePage: check.pageNumber ?? field.sourcePage,
      sourceQuote: field.sourceQuote,
      quoteVerified: check.verified,
      modelId: extraction.modelId,
    };
  });

  await addProposals(input.intakeId, proposals);

  if (extraction.injuries.length > 0) {
    const athleteId = await athleteIdForIntake(input.intakeId);
    await addInjuries(
      extraction.injuries.map((injury) => {
        const check =
          pages.length > 0
            ? verifyQuote(injury.sourceQuote, pages)
            : { verified: false, pageNumber: null, overlap: 0 };

        return {
          athleteId,
          intakeId: input.intakeId,
          bodyRegion: injury.bodyRegion,
          side: injury.side,
          diagnosis: injury.diagnosis,
          // Een half bekende datum ("2024" of "2024-03") is geen datum. Liever
          // leeg dan een verzonnen dag, want die zou in de tijdlijn als feit staan.
          onsetDate: /^\d{4}-\d{2}-\d{2}$/.test(injury.onsetDate ?? "")
            ? injury.onsetDate
            : null,
          endDate: /^\d{4}-\d{2}-\d{2}$/.test(injury.endDate ?? "")
            ? injury.endDate
            : null,
          sourceDocumentId: document.id,
          sourcePage: check.pageNumber ?? injury.sourcePage,
          sourceQuote: injury.sourceQuote,
          quoteVerified: check.verified,
        };
      }),
    );
  }

  await markProcessed(document.id, null);
  await syncDossier(input.intakeId);

  return {
    documentId: document.id,
    kind: document.kind,
    pageCount: pages.length,
    fieldsProposed: proposals.length,
    quotesVerified,
    injuriesFound: extraction.injuries.length,
    duplicate: false,
  };
}
