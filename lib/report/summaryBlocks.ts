/**
 * De samenvatting opdelen in leesbare blokken.
 *
 * `lib/claude/summarise.ts` vraagt een vaste vorm: drie koppen tussen dubbele
 * sterretjes en daaronder regels die met een streepje beginnen. Notion krijgt
 * die vorm al omgezet via markdownToBlocks; het rapport kreeg hem als platte
 * tekst, dus stond er letterlijk `**Wat er staat**` op papier.
 *
 * Geen markdownbibliotheek. Dit is niet "markdown ondersteunen" maar precies de
 * drie vormen renderen die de prompt vraagt, en al het andere onveranderd als
 * alinea doorlaten. Een parser die meer kan dan de invoer bevat, is een parser
 * met meer faalgevallen dan nodig.
 */

export type SummaryBlock =
  | { kind: "heading"; text: string }
  | { kind: "item"; text: string }
  | { kind: "paragraph"; text: string };

/** `**tekst**` aan het begin en eind van een regel: dat is een kop. */
const HEADING = /^\*\*(.+)\*\*$/;

export function toSummaryBlocks(text: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", text: heading[1].trim() });
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push({ kind: "item", text: stripEmphasis(line.slice(2).trim()) });
      continue;
    }

    blocks.push({ kind: "paragraph", text: stripEmphasis(line) });
  }

  return blocks;
}

/**
 * Sterretjes midden in een regel weghalen.
 *
 * Het model zet af en toe een term vet binnen een opsomming. Die nadruk
 * kwijtraken is niet erg; hem als sterretjes laten staan wel, want dan leest een
 * kinesist opmaaktekens in een medisch document.
 */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(?<!\*)\*(?!\*)/g, "");
}
