import { anthropic, MODEL } from "@/lib/claude/client";
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
  modelId: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export type ExtractionInput =
  | { kind: "pdf"; bytes: Uint8Array }
  | { kind: "image"; bytes: Uint8Array; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" }
  | { kind: "text"; text: string };

function schemaFor(definitions: FieldDefinition[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["fields", "injuries"],
    properties: {
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

function systemPrompt(definitions: FieldDefinition[]): string {
  const fieldList = definitions
    .map((d) => {
      const type =
        d.dataType === "enum"
          ? `enum(${d.enumOptions?.join("|")})`
          : d.dataType;
      return `- ${d.key} [${type}] ${d.labelNl} / ${d.labelEn}`;
    })
    .join("\n");

  return `Je leest documenten uit een intake voor de begeleiding van eliteatleten en haalt daar gestructureerde gegevens uit.

Harde regels:

1. Geef alleen een veld terug als de waarde letterlijk uit dit document blijkt. Niets afleiden, niets aanvullen uit algemene kennis, niets gokken.
2. Elk veld heeft een sourceQuote: een letterlijk overgetypt fragment uit het document. Niet samenvatten en niet parafraseren, want het fragment wordt server-side tegen de brontekst geverifieerd. Een verzonnen citaat wordt gedetecteerd.
3. Staat er niets relevants in het document, geef dan een lege lijst terug. Dat is een correct antwoord, geen mislukking.
4. Bij twijfel tussen twee lezingen: laat het veld weg. Een menselijke reviewer vult het aan. Een fout gevuld veld kost meer dan een leeg veld.
5. Medische interpretatie is niet aan jou. Neem diagnoses over zoals ze er staan, ook als je ze onwaarschijnlijk vindt.

Beschikbare velden:

${fieldList}`;
}

export async function extractDocument(
  input: ExtractionInput,
  definitions: FieldDefinition[],
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
      format: { type: "json_schema", schema: schemaFor(definitions) },
    },
    system: [
      {
        type: "text",
        text: systemPrompt(definitions),
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
            text: "Haal uit dit document de velden die er letterlijk in staan, met per veld een letterlijk citaat.",
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

  let parsed: { fields?: ExtractedField[]; injuries?: ExtractedInjury[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Model gaf geen geldige JSON terug: ${text.slice(0, 200)}`);
  }

  return {
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
