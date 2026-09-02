/**
 * Tekst per pagina uit een tekst-PDF. M2.
 *
 * De paginatekst wordt opgeslagen in medical.document_pages en is de basis voor
 * citaatverificatie. Zonder deze tabel kan `quoteVerified` niet bestaan.
 *
 * Gescande PDF's leveren hier weinig of geen tekst op. Die gaan als `document`
 * content block naar Claude, en hun `sourceQuote` blijft dus op medium staan
 * tenzij de coach het veld bevestigt. Dat is bedoeld gedrag, niet een gebrek.
 */
export interface DocumentPage {
  pageNumber: number;
  text: string;
}

export function extractPages(_pdf: Uint8Array): Promise<DocumentPage[]> {
  throw new Error("niet geïmplementeerd: M2");
}
