/**
 * Notion-blokken uit de tekst die het model oplevert.
 *
 * De klinische samenvatting komt terug met kopjes tussen dubbele sterretjes en
 * opsommingen met een streepje. Die als platte tekst in Notion zetten geeft een
 * blok met zichtbare sterretjes, en dan leest een kinesist opmaakcodes in plaats
 * van een samenvatting.
 *
 * Bewust minimaal: kopje, opsomming, alinea, en vet binnen een regel. Meer komt
 * er niet uit de prompt, en een halve markdown-parser is een bron van fouten.
 */

interface RichText {
  type: "text";
  text: { content: string };
  annotations?: { bold: boolean };
}

/** Splitst een regel op **vet** en geeft Notion rich text terug. */
function inline(text: string): RichText[] {
  const parts: RichText[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", text: { content: text.slice(last, match.index) } });
    }
    parts.push({
      type: "text",
      text: { content: match[1] },
      annotations: { bold: true },
    });
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push({ type: "text", text: { content: text.slice(last) } });
  }

  return parts.length > 0 ? parts : [{ type: "text", text: { content: text } }];
}

export function markdownToBlocks(markdown: string): unknown[] {
  const blocks: unknown[] = [];

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;

    // Een regel die volledig vet is, is een kopje.
    const heading = /^\*\*(.+?)\*\*:?$/.exec(line);
    if (heading) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: [{ type: "text", text: { content: heading[1] } }] },
      });
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: inline(bullet[1]) },
      });
      continue;
    }

    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: inline(line) },
    });
  }

  // Notion accepteert maximaal 100 blokken per aanroep.
  return blocks.slice(0, 90);
}
