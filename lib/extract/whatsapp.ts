/**
 * Parser voor WhatsApp-chatexports.
 *
 * Er is geen stabiel formaat. iOS zet de kop tussen blokhaken, Android gebruikt
 * een streepje, en de datumnotatie volgt de locale van het toestel dat
 * exporteerde. Exports bevatten ook onzichtbare LRM-tekens (U+200E) rond de kop.
 *
 *   [12/03/2026, 14:05:11] Frederik: tekst
 *   12/03/2026, 14:05 - Frederik: tekst
 *   12-3-2026 14:05 - Frederik: tekst
 *
 * Regels zonder kop zijn vervolgregels van het vorige bericht. Regels met een
 * kop maar zonder afzender zijn systeemmeldingen (versleuteling, groepsleden) en
 * gaan eruit.
 */

export interface WhatsAppMessage {
  /** ISO 8601, of null als de datum niet betrouwbaar te lezen was. */
  at: string | null;
  sender: string;
  body: string;
}

const HEADER =
  /^‎?\[?(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?: ?\s*([ap]\.?m\.?))?\]?\s*(?:-\s*)?(.*)$/i;

/** Media-placeholders in de talen die hier voorkomen. */
const MEDIA_PLACEHOLDER =
  /^<(media omitted|media weggelaten|bijlage weggelaten|attachment omitted)>$/i;

interface RawLine {
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  rest: string;
}

/**
 * Dag-eerst of maand-eerst.
 *
 * We kijken naar het hele bestand voordat we een datum vaststellen: staat er
 * ergens een eerste component boven 12, dan is het dag-eerst. Staat er ergens
 * een tweede component boven 12, dan maand-eerst. Anders vallen we terug op
 * dag-eerst, want dit is een Belgische praktijk. Per regel gokken levert een
 * export op waarin 3 maart en 3 maart-of-maart-3 door elkaar staan.
 */
function detectDayFirst(lines: RawLine[]): boolean {
  for (const line of lines) {
    if (line.day > 12) return true;
    if (line.month > 12) return false;
  }
  return true;
}

function toIso(line: RawLine, dayFirst: boolean): string | null {
  const day = dayFirst ? line.day : line.month;
  const month = dayFirst ? line.month : line.day;
  const year = line.year < 100 ? 2000 + line.year : line.year;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(
    Date.UTC(year, month - 1, day, line.hour, line.minute, line.second),
  );
  if (Number.isNaN(date.getTime())) return null;
  // Rolt de datum om, dan bestond hij niet (31 februari).
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null;
  return date.toISOString();
}

export function parseWhatsAppExport(raw: string): WhatsAppMessage[] {
  const lines = raw.split(/\r?\n/);

  // Ronde 1: koppen vinden, zodat we dag-eerst kunnen bepalen voor we datums
  // vastleggen.
  const parsed: Array<{ index: number; line: RawLine }> = [];
  for (let index = 0; index < lines.length; index++) {
    const match = HEADER.exec(lines[index]);
    if (!match) continue;

    const [, a, b, c, hh, mm, ss, meridiem, rest] = match;
    let hour = Number(hh);
    if (meridiem) {
      const pm = meridiem.toLowerCase().startsWith("p");
      if (hour === 12) hour = pm ? 12 : 0;
      else if (pm) hour += 12;
    }

    parsed.push({
      index,
      line: {
        day: Number(a),
        month: Number(b),
        year: Number(c),
        hour,
        minute: Number(mm),
        second: ss ? Number(ss) : 0,
        rest,
      },
    });
  }

  const dayFirst = detectDayFirst(parsed.map((p) => p.line));
  const headerAt = new Map(parsed.map((p) => [p.index, p.line]));

  const messages: WhatsAppMessage[] = [];

  for (let index = 0; index < lines.length; index++) {
    const header = headerAt.get(index);

    if (!header) {
      // Vervolgregel van het vorige bericht.
      const previous = messages.at(-1);
      if (previous && lines[index].trim() !== "") {
        previous.body += `\n${lines[index]}`;
      }
      continue;
    }

    // "Afzender: tekst". Geen dubbele punt betekent een systeemmelding.
    const split = header.rest.replace(/^‎/, "").match(/^([^:]{1,80}):\s?([\s\S]*)$/);
    if (!split) continue;

    const [, sender, body] = split;
    const clean = body.replace(/‎/g, "").trim();
    if (MEDIA_PLACEHOLDER.test(clean)) continue;

    messages.push({
      at: toIso(header, dayFirst),
      sender: sender.trim(),
      body: clean,
    });
  }

  return messages.filter((message) => message.body.trim() !== "");
}

/**
 * Eén leesbaar blok voor het model, met de afzender per regel. Wordt ook als
 * paginatekst opgeslagen, zodat citaten uit een chat net zo verifieerbaar zijn
 * als citaten uit een PDF.
 */
export function whatsAppToPlainText(messages: WhatsAppMessage[]): string {
  return messages
    .map((message) => {
      const date = message.at ? message.at.slice(0, 16).replace("T", " ") : "?";
      return `[${date}] ${message.sender}: ${message.body}`;
    })
    .join("\n");
}
