import type { DocumentPage } from "@/lib/extract/pages";

/**
 * Verifieert of een door het model opgegeven citaat echt in de bron staat. M2.
 *
 * Dit is de kern van de eerlijke betrouwbaarheidsindicatie: geen percentage uit
 * het model, maar een controleerbaar feit. Fuzzy match, want OCR en
 * PDF-tekstextractie verschillen in witruimte, afbreekstreepjes en ligaturen.
 */
export function verifyQuote(
  _quote: string,
  _pages: DocumentPage[],
): { verified: boolean; pageNumber: number | null } {
  throw new Error("niet geïmplementeerd: M2");
}
