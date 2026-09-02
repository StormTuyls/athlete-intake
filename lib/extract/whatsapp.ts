/**
 * Parser voor WhatsApp-chatexports (.txt). M2.
 *
 * Moet tolerant zijn: iOS en Android schrijven verschillende formaten, en de
 * datumnotatie volgt de locale van het toestel dat exporteerde.
 *   [12/03/2026, 14:05:11] Frederik: tekst
 *   12-3-2026 14:05 - Frederik: tekst
 * Systeemregels (versleuteling, toegevoegd aan groep, media weggelaten) eruit.
 */
export interface WhatsAppMessage {
  at: string; // ISO 8601
  sender: string;
  body: string;
}

export function parseWhatsAppExport(_raw: string): WhatsAppMessage[] {
  throw new Error("niet geïmplementeerd: M2");
}
