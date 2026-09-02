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
  markProcessed,
  savePages,
  upsertDocument,
} from "@/lib/db/medical";
import { getFieldDefinitions, syncDossier } from "@/lib/db/dossier";
import type { DocumentKind } from "@/lib/types";

/** Claude accepteert deze beeldformaten; HEIC niet. */
const SUPPORTED_IMAGE = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export interface ProcessResult {
  documentId: string;
  kind: DocumentKind;
  pageCount: number;
  fieldsProposed: number;
  quotesVerified: number;
  injuriesFound: number;
}

/**
 * Een geupload document verwerken.
 *
 * De volgorde is met opzet: het ruwe bestand staat al in de opslag voordat hier
 * iets gebeurt, en het document wordt geregistreerd voordat het model erbij komt.
 * Klapt de extractie, dan staat er een document met een processing_error en is
 * er niets verloren. Niets mag uitsluitend in een AI-samenvatting leven, dus mag
 * een mislukte samenvatting ook nooit het origineel meenemen.
 */
export async function processDocument(input: {
  intakeId: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
}): Promise<ProcessResult> {
  const download = await storage().from(DOCUMENTS_BUCKET).download(input.storagePath);
  if (download.error || !download.data) {
    throw new Error(`document downloaden mislukt: ${download.error?.message}`);
  }

  const bytes = new Uint8Array(await download.data.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const byteSize = bytes.length;

  let pages: DocumentPage[] = [];
  let kind: DocumentKind;
  let extractionInput: ExtractionInput;

  if (input.mimeType === "application/pdf") {
    pages = await extractPages(bytes);
    // Een scan levert bij tekstextractie vrijwel niets op. Die gaat visueel naar
    // het model, en zijn citaten zijn dus niet te verifieren: die velden blijven
    // op 'medium' tot de coach ze bevestigt.
    kind = looksScanned(pages) ? "pdf_scanned" : "pdf_text";
    extractionInput = { kind: "pdf", bytes };
  } else if (input.mimeType.startsWith("image/")) {
    kind = "image";
    if (!SUPPORTED_IMAGE.has(input.mimeType)) {
      const documentId = await upsertDocument({
        ...input,
        sha256,
        byteSize,
        kind,
        pageCount: null,
      });
      await markProcessed(
        documentId,
        `beeldformaat ${input.mimeType} kan niet geanalyseerd worden, upload als JPEG of PNG`,
      );
      throw new Error(`beeldformaat ${input.mimeType} niet ondersteund`);
    }
    extractionInput = {
      kind: "image",
      bytes,
      mediaType: input.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
    };
  } else if (input.mimeType === "text/csv") {
    const text = new TextDecoder().decode(bytes);
    kind = "vald_csv";
    pages = [{ pageNumber: 1, text }];
    extractionInput = { kind: "text", text };
  } else {
    const raw = new TextDecoder().decode(bytes);
    const messages = parseWhatsAppExport(raw);
    // Een WhatsApp-export herkennen we eraan dat de parser er berichten uit
    // haalt, niet aan de bestandsnaam.
    const isChat = messages.length > 0;
    const text = isChat ? whatsAppToPlainText(messages) : raw;
    kind = isChat ? "whatsapp_export" : "pdf_text";
    pages = [{ pageNumber: 1, text }];
    extractionInput = { kind: "text", text };
  }

  const documentId = await upsertDocument({
    ...input,
    sha256,
    byteSize,
    kind,
    pageCount: pages.length > 0 ? pages.length : null,
  });

  await savePages(documentId, pages);

  const definitions = await getFieldDefinitions();

  let extraction: Awaited<ReturnType<typeof extractDocument>>;
  try {
    extraction = await extractDocument(extractionInput, definitions);
  } catch (error) {
    await markProcessed(
      documentId,
      error instanceof Error ? error.message : "extractie mislukt",
    );
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
      sourceDocumentId: documentId,
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
          sourceDocumentId: documentId,
          sourcePage: check.pageNumber ?? injury.sourcePage,
          sourceQuote: injury.sourceQuote,
          quoteVerified: check.verified,
        };
      }),
    );
  }

  await markProcessed(documentId, null);
  await syncDossier(input.intakeId);

  return {
    documentId,
    kind,
    pageCount: pages.length,
    fieldsProposed: proposals.length,
    quotesVerified,
    injuriesFound: extraction.injuries.length,
  };
}
