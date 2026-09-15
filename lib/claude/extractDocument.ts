import { anthropic, MODEL } from "@/lib/claude/client";
import { EXTRACT_PROMPTS, extractSystemPrompt } from "@/lib/claude/prompts/extract";
import type { Locale } from "@/lib/i18n/locale";
import type { FieldDefinition } from "@/lib/types";

/**
 * Eén Claude-call per document.
 *
 * Ontwerpkeuzes die hier vastliggen:
 *
 * - `sourceQuote` is een schemavereiste, niet een vriendelijk verzoek. Een veld
 *   zonder letterlijk citaat komt niet terug, en de databank weigert het ook
 *   (field_proposals_model_needs_provenance).
 * - `value` is altijd tekst. De typering gebeurt daarna in lib/dossier/validate,
 *   op één plek, in plaats van te vertrouwen op het model dat het juiste JSON-type
 *   kiest.
 * - Gescande PDF's gaan als `document` block; Claude leest de pagina's visueel.
 *   Geen aparte OCR-dienst, dus één integratie en één subverwerker minder.
 * - Prompt-caching op de systeemprompt en het documentblok, zodat herverwerken
 *   na een promptwijziging niet de volle prijs kost.
 */

export interface ExtractedField {
  fieldKey: string;
  value: string;
  sourcePage: number | null;
  sourceQuote: string;
}

export interface ExtractedInjury {
  bodyRegion: string;
  side: "left" | "right" | "bilateral" | "unknown";
  diagnosis: string | null;
  onsetDate: string | null;
  endDate: string | null;
  sourcePage: number | null;
  sourceQuote: string;
}

export interface ExtractionResult {
  fields: ExtractedField[];
  injuries: ExtractedInjury[];
  /**
   * Wat dit document bevat, in een paar zinnen. Leeg als het model niets te
   * beschrijven vond; dat is een geldig antwoord en geen mislukking.
   */
  summary: string;
  modelId: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export type ExtractionInput =
  | { kind: "pdf"; bytes: Uint8Array }
  | { kind: "image"; bytes: Uint8Array; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" }
  | { kind: "text"; text: string };

/** Geexporteerd zodat evals/unit/document-summary.test.ts de vorm kan vastleggen. */
export function schemaFor(locale: Locale, definitions: FieldDefinition[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "fields", "injuries"],
    properties: {
      summary: {
        type: "string",
        description: EXTRACT_PROMPTS[locale].summaryDescription,
      },
      fields: {
        type: "array",
        description:
          "Alleen velden die letterlijk in dit document staan. Leeg is een geldig antwoord.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fieldKey", "value", "sourcePage", "sourceQuote"],
          properties: {
            fieldKey: { type: "string", enum: definitions.map((d) => d.key) },
            value: {
              type: "string",
              description:
                "De waarde als tekst. Datums als YYYY-MM-DD, getallen als cijfers zonder eenheid.",
            },
            sourcePage: {
              type: ["integer", "null"],
              description: "Paginanummer, 1-geindexeerd. Null als het document geen pagina's heeft.",
            },
            sourceQuote: {
              type: "string",
              description:
                "Letterlijk citaat uit het document waaruit deze waarde blijkt. Overtypen, niet samenvatten.",
            },
          },
        },
      },
      injuries: {
        type: "array",
        description: "Blessures met een eigen datum, voor de tijdlijn.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["bodyRegion", "side", "diagnosis", "onsetDate", "endDate", "sourcePage", "sourceQuote"],
          properties: {
            bodyRegion: { type: "string" },
            side: { type: "string", enum: ["left", "right", "bilateral", "unknown"] },
            diagnosis: { type: ["string", "null"] },
            onsetDate: { type: ["string", "null"], description: "YYYY-MM-DD of YYYY-MM of YYYY" },
            endDate: { type: ["string", "null"] },
            sourcePage: { type: ["integer", "null"] },
            sourceQuote: { type: "string" },
          },
        },
      },
    },
  } as const;
}

export async function extractDocument(
  input: ExtractionInput,
  definitions: FieldDefinition[],
  locale: Locale,
): Promise<ExtractionResult> {
  const client = anthropic();

  const documentBlock =
    input.kind === "pdf"
      ? {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: Buffer.from(input.bytes).toString("base64"),
          },
          cache_control: { type: "ephemeral" as const },
        }
      : input.kind === "image"
        ? {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: input.mediaType,
              data: Buffer.from(input.bytes).toString("base64"),
            },
            cache_control: { type: "ephemeral" as const },
          }
        : {
            type: "text" as const,
            text: input.text,
            cache_control: { type: "ephemeral" as const },
          };

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: schemaFor(locale, definitions) },
    },
    system: [
      {
        type: "text",
        text: extractSystemPrompt(locale, definitions),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          documentBlock,
          {
            type: "text",
            text: EXTRACT_PROMPTS[locale].instruction,
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `Model weigerde het document te verwerken: ${response.stop_details?.category ?? "onbekend"}`,
    );
  }

  const text = response.content
    .filter((block): block is { type: "text"; text: string; citations: null } =>
      block.type === "text",
    )
    .map((block) => block.text)
    .join("");

  let parsed: {
    summary?: string;
    fields?: ExtractedField[];
    injuries?: ExtractedInjury[];
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Model gaf geen geldige JSON terug: ${text.slice(0, 200)}`);
  }

  return {
    summary: (parsed.summary ?? "").trim(),
    // Een veld zonder citaat halen we hier al weg; de databank zou het anders weigeren.
    fields: (parsed.fields ?? []).filter(
      (field) => field.sourceQuote && field.sourceQuote.trim() !== "",
    ),
    injuries: (parsed.injuries ?? []).filter(
      (injury) => injury.sourceQuote && injury.sourceQuote.trim() !== "",
    ),
    modelId: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}
