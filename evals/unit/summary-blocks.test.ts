import assert from "node:assert/strict";
import { SUMMARY_HEADINGS } from "../../lib/claude/prompts/summary";
import { toSummaryBlocks } from "../../lib/report/summaryBlocks";
import { markdownToBlocks } from "../../lib/notion/blocks";

/**
 * De drie kopjes van de klinische samenvatting zijn een contract.
 *
 * Twee parsers halen ze uit de tekst: lib/report/summaryBlocks.ts voor het
 * rapport en lib/notion/blocks.ts voor de Notion-pagina. Beide nemen wat er
 * tussen de sterren staat en kijken niet naar de woorden, dus vertalen breekt
 * niets. Maar dat is nu getest in plaats van aangenomen: het was de reden om
 * geen machinemarkeringen te verzinnen, en zonder deze test is die reden een
 * bewering.
 *
 * Geen modelcall: dit test de parsers en de tabel, niet het model.
 */

for (const locale of ["nl", "en"] as const) {
  const headings = SUMMARY_HEADINGS[locale];

  assert.equal(headings.length, 3, `${locale}: er horen drie kopjes te zijn`);
  for (const heading of headings) {
    assert.ok(heading.trim() !== "", `${locale}: een kopje is leeg`);
  }

  // Zoals het model het aflevert: vetgedrukte regel, dan tekst.
  const text = headings
    .map((heading, index) => `**${heading}**\n\nRegel ${index + 1} met inhoud.`)
    .join("\n\n");

  const blocks = toSummaryBlocks(text);
  const parsed = blocks.filter((b) => b.kind === "heading").map((b) => b.text);
  assert.deepEqual(
    parsed,
    [...headings],
    `${locale}: het rapport haalt de kopjes er niet uit`,
  );

  const notion = markdownToBlocks(text) as Array<{ type: string }>;
  const notionHeadings = notion.filter((b) => b.type.startsWith("heading"));
  assert.equal(
    notionHeadings.length,
    3,
    `${locale}: Notion ziet ${notionHeadings.length} kopjes in plaats van 3`,
  );
}

// De twee talen moeten echt verschillen, anders is er niets vertaald.
assert.notDeepEqual(
  [...SUMMARY_HEADINGS.nl],
  [...SUMMARY_HEADINGS.en],
  "de kopjes zijn in beide talen gelijk, dus er is niets vertaald",
);

console.log("summary-blocks: drie kopjes, beide talen, beide parsers");
process.exit(0);
