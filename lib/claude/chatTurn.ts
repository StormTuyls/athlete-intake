import { anthropic, MODEL } from "@/lib/claude/client";
import type { Gap } from "@/lib/dossier/completeness";
import type { FieldDefinition } from "@/lib/types";

/**
 * Eén beurt van de intake-assistent.
 *
 * De assistent doet twee dingen in één call: hij formuleert de volgende vraag,
 * en hij haalt uit het laatste antwoord van de atleet de velden die daarin
 * zitten. Dat scheelt een tweede call per beurt en houdt de twee taken in
 * dezelfde context, wat nodig is: "ja, links" is alleen te interpreteren als je
 * weet wat er gevraagd is.
 *
 * Wat de assistent expliciet niet doet: velden afleiden die de atleet niet
 * genoemd heeft, en medische uitspraken doen. Zijn opdracht is verzamelen.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CapturedField {
  fieldKey: string;
  value: string;
  /** Wat de atleet letterlijk zei. Dient als herkomst, net als een citaat. */
  quote: string;
}

export interface ChatTurnResult {
  reply: string;
  captured: CapturedField[];
  /** Het veld waar deze vraag over gaat, voor chat_messages.about_field_key. */
  aboutFieldKey: string | null;
  modelId: string;
  done: boolean;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "captured", "aboutFieldKey", "done"],
  properties: {
    reply: {
      type: "string",
      description: "Wat de atleet te zien krijgt. Eén of twee zinnen, geen opsomming.",
    },
    captured: {
      type: "array",
      description:
        "Velden die uit het laatste antwoord van de atleet blijken. Leeg als het antwoord niets bruikbaars bevatte.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fieldKey", "value", "quote"],
        properties: {
          fieldKey: { type: "string" },
          value: {
            type: "string",
            description: "Datums als YYYY-MM-DD, getallen als cijfers zonder eenheid.",
          },
          quote: {
            type: "string",
            description: "Wat de atleet letterlijk zei, overgetypt.",
          },
        },
      },
    },
    aboutFieldKey: {
      type: ["string", "null"],
      description: "Het veld waar je vraag over gaat. Null als je afsluit.",
    },
    done: {
      type: "boolean",
      description: "True als er niets meer te vragen valt.",
    },
  },
} as const;

function systemPrompt(
  gaps: Gap[],
  definitions: FieldDefinition[],
  locale: "nl" | "en",
): string {
  const byKey = new Map(definitions.map((d) => [d.key, d]));

  const gapList = gaps
    .slice(0, 12)
    .map((gap) => {
      const definition = byKey.get(gap.fieldKey);
      const type =
        definition?.dataType === "enum"
          ? `enum(${definition.enumOptions?.join("|")})`
          : (definition?.dataType ?? "text");
      const mark = gap.required ? "verplicht" : "optioneel";
      const why =
        gap.reason === "conflicting"
          ? "TEGENSTRIJDIG in de documenten, vraag de atleet welke klopt"
          : "ontbreekt";
      return `- ${gap.fieldKey} [${type}, ${mark}, ${why}]: ${gap.question}`;
    })
    .join("\n");

  const language = locale === "nl" ? "Nederlands" : "Engels";

  return `Je begeleidt de intake van een atleet bij een praktijk voor eliteatletenbegeleiding. Je spreekt ${language}. Je bent kort, concreet en vriendelijk zonder overdaad.

Werkwijze:

1. Stel één vraag per beurt. Niet twee, niet een lijst.
2. Neem de eerste openstaande vraag uit de lijst hieronder, tenzij het antwoord van de atleet logisch om een vervolgvraag vraagt.
3. Haal uit het laatste antwoord van de atleet elk veld dat er letterlijk in zit, ook velden waar je niet naar vroeg. Zegt iemand bij een vraag over gewicht ook zijn lengte, neem beide.
4. Leidt niets af. "Ik voetbal" vult identity.sport, maar niet identity.discipline.
5. Bij een tegenstrijdigheid: leg kort voor wat er in de documenten staat en vraag welke waarde klopt.
6. Geen medisch advies, geen interpretatie van klachten, geen trainingsadvies. Je verzamelt.
7. Is de lijst leeg, zet done op true en sluit in één zin af.

Nog open:

${gapList || "(niets meer open)"}`;
}

export async function runChatTurn(input: {
  history: ChatMessage[];
  gaps: Gap[];
  definitions: FieldDefinition[];
  locale: "nl" | "en";
}): Promise<ChatTurnResult> {
  const client = anthropic();

  // Een eerste beurt zonder geschiedenis heeft geen user-bericht om op te
  // reageren; de Messages API vereist er wel een.
  const messages =
    input.history.length > 0
      ? input.history
      : [{ role: "user" as const, content: "Ik wil de intake starten." }];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: [
      {
        type: "text",
        text: systemPrompt(input.gaps, input.definitions, input.locale),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Model weigerde deze beurt");
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("");

  const parsed = JSON.parse(text) as {
    reply: string;
    captured: CapturedField[];
    aboutFieldKey: string | null;
    done: boolean;
  };

  const known = new Set(input.definitions.map((d) => d.key));

  return {
    reply: parsed.reply,
    // Een fieldKey die niet bestaat zou de foreign key laten klappen.
    captured: (parsed.captured ?? []).filter((c) => known.has(c.fieldKey)),
    aboutFieldKey:
      parsed.aboutFieldKey && known.has(parsed.aboutFieldKey)
        ? parsed.aboutFieldKey
        : null,
    modelId: response.model,
    done: parsed.done === true,
  };
}
