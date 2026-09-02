import { extractText } from "unpdf";

export interface DocumentPage {
  pageNumber: number;
  text: string;
}

/**
 * Tekst per pagina uit een PDF.
 *
 * De paginatekst gaat naar medical.document_pages en is de bron van waarheid
 * voor citaatverificatie. Zonder deze tabel kan `quote_verified` niet bestaan
 * en valt de betrouwbaarheidsindicatie terug op geloof in het model.
 */
export async function extractPages(pdf: Uint8Array): Promise<DocumentPage[]> {
  // pdf.js neemt de buffer over en detacht hem: na deze call is de meegegeven
  // Uint8Array 0 bytes lang. Dat is stil en dodelijk, want de aanroeper heeft
  // die bytes daarna nog nodig om het document naar het model te sturen. Daarom
  // gaat er een kopie in, en niet het origineel.
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: false });
  return text.map((page, index) => ({
    pageNumber: index + 1,
    text: page ?? "",
  }));
}

/**
 * Heuristiek voor "dit is een scan, geen tekst-PDF".
 *
 * Een gescande pagina levert bij tekstextractie vrijwel niets op. We meten het
 * aantal niet-witruimtetekens per pagina; onder de drempel gaat het document als
 * `document` content block naar Claude, die de pagina's visueel leest.
 *
 * Gevolg voor betrouwbaarheid: een citaat uit een scan is niet tegen
 * paginatekst te verifieren, dus zulke velden blijven op `medium` staan tot de
 * coach ze bevestigt. Dat is bedoeld gedrag, geen gebrek.
 */
const MIN_CHARS_PER_PAGE = 80;

export function looksScanned(pages: DocumentPage[]): boolean {
  if (pages.length === 0) return true;
  const chars = pages.reduce(
    (total, page) => total + page.text.replace(/\s+/g, "").length,
    0,
  );
  return chars / pages.length < MIN_CHARS_PER_PAGE;
}
