import type { ExtractedField, IntakeDocument } from "@/lib/types";

/**
 * Eén Claude-call per document. M2.
 *
 * - Structured outputs met een schema dat `sourceQuote` verplicht maakt.
 * - Gescande PDF's als `document` content block, screenshots als `image` block.
 * - Prompt-caching op het documentblok, zodat herverwerking ~90% goedkoper is.
 * - Het model mag niets verzinnen: velden zonder bron horen weg te blijven,
 *   niet op "inferred" te landen. Zie de negatieve tests in evals/.
 */
export function extractDocument(
  _doc: IntakeDocument,
  _bytes: Uint8Array,
): Promise<ExtractedField[]> {
  throw new Error("niet geïmplementeerd: M2");
}
