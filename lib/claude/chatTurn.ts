import { anthropic, MODEL } from "@/lib/claude/client";
import type { Gap } from "@/lib/dossier/completeness";
import type { FieldDefinition } from "@/lib/types";
import type { CarriedValue } from "@/lib/intake/carryForward";

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
        "Elk veld dat uit het laatste antwoord van de atleet blijkt, ook velden waar niet naar gevraagd werd. Leeg als het antwoord niets bruikbaars bevatte.",
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
  carried: CarriedValue[],
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

  // Twee verschillende lijsten, en dat onderscheid is wezenlijk.
  //
  // "Nu vragen" is waar de assistent naar VRAAGT: afgekapt op twaalf, want een
  // prompt met 41 vragen erin levert een assistent die alles door elkaar vraagt.
  //
  // "Mag je oppikken" is wat hij uit een antwoord mag HALEN: alles wat open
  // staat. Zonder die tweede lijst ziet hij optionele velden niet, en dan levert
  // "182 cm, ik weeg 77 kg, ik sprint bij AC Herentals" wel lengte, gewicht en
  // sport op maar niet de club. Precies dat ging mis bij de eerste UI-test.
  const open = new Set(gaps.map((gap) => gap.fieldKey));
  const capturable = definitions
    .filter((definition) => open.has(definition.key))
    .map((definition) => {
      const type =
        definition.dataType === "enum"
          ? `enum(${definition.enumOptions?.join("|")})`
          : definition.dataType;
      const label = locale === "nl" ? definition.labelNl : definition.labelEn;
      return `- ${definition.key} [${type}] ${label}`;
    })
    .join("\n");

  // Wat de atleet vorige keer al vertelde, om in EEN beurt te laten bevestigen
  // in plaats van acht losse vragen te stellen. Bewust geen voorstellen in het
  // dossier: zie lib/intake/carryForward.ts voor waarom.
  const known = carried
    .map((item) => {
      const shown = Array.isArray(item.value)
        ? item.value.join(", ")
        : String(item.value);
      const when = item.fromDate ? ` (opgegeven ${item.fromDate})` : "";
      return `- ${item.fieldKey}: ${item.label} = ${shown}${when}`;
    })
    .join("\n");

  const carryRule = carried.length
    ? `
8. Onder "Bekend uit een eerdere intake" staan gegevens die deze atleet eerder al gaf. Heeft hij in DIT gesprek nog niets geantwoord, open dan met een bericht dat die gegevens opsomt en in een vraag laat bevestigen of ze nog kloppen. Dat is nog steeds een vraag, dus regel 1 blijft gelden.
9. Neem die gegevens niet vanzelf over. Pas als de atleet bevestigt, geef je de betreffende velden terug met exact de waarden die hierboven staan. Corrigeert hij er een, dan geef je die ene gecorrigeerde waarde terug en de rest zoals bevestigd. Zegt hij niets over een veld, dan geef je dat veld niet terug.
`
    : "";

  const carrySection = carried.length
    ? `

Bekend uit een eerdere intake:

${known}`
    : "";

  return `Je begeleidt de intake van een atleet bij een praktijk voor eliteatletenbegeleiding. Je spreekt ${language}. Je bent kort, concreet en vriendelijk zonder overdaad.

Werkwijze:

1. Stel een vraag per beurt. Niet twee, niet een lijst.
2. Neem de eerste openstaande vraag uit "Nu vragen", tenzij het antwoord van de atleet logisch om een vervolgvraag vraagt.
3. Haal uit het laatste antwoord van de atleet ELK veld dat er letterlijk in zit, ook velden waar je niet naar vroeg en ook velden die niet in "Nu vragen" staan. Alles uit "Mag je oppikken" komt in aanmerking. Noemt iemand bij een vraag over lengte ook zijn gewicht, sport en club, dan geef je die alle vier terug.
4. Leidt niets af. "Ik voetbal" vult identity.sport, maar niet identity.discipline.
5. Bij een tegenstrijdigheid: leg kort voor wat er in de documenten staat en vraag welke waarde klopt.
6. Geen medisch advies, geen interpretatie van klachten, geen trainingsadvies. Je verzamelt.
7. Is "Nu vragen" leeg, zet done op true en sluit in een zin af.
${carryRule}
Nu vragen:

${gapList || "(niets meer open)"}

Mag je oppikken uit een antwoord:

${capturable || "(niets meer open)"}${carrySection}`;
}

export async function runChatTurn(input: {
  history: ChatMessage[];
  gaps: Gap[];
  definitions: FieldDefinition[];
  locale: "nl" | "en";
  /** Wat deze atleet in een eerdere intake al gaf, om te laten bevestigen. */
  carried?: CarriedValue[];
  /**
   * Aanleiding voor een beurt zonder nieuw antwoord van de atleet. Wordt als
   * user-bericht meegestuurd maar NIET opgeslagen: de atleet heeft dit niet
   * gezegd, en zijn stem nabootsen in een transcriptie die geaudit wordt kan
   * niet. Zie de guard hieronder.
   */
  nudge?: string;
}): Promise<ChatTurnResult> {
  const client = anthropic();

  // De Messages API wil dat de laatste beurt van de gebruiker is. Dat is niet
  // alleen zo bij een leeg gesprek: na een upload of een bevestiging eindigt de
  // geschiedenis op een assistent-bericht, en dan zou het model gevraagd worden
  // zijn eigen beurt voort te zetten onder een json_schema-config. Vandaar de
  // bredere voorwaarde: eindigt de historie niet op de atleet, dan komt er een
  // regel bij die zegt wat er zojuist gebeurd is.
  const last = input.history.at(-1);
  const needsOpener = last === undefined || last.role !== "user";

  const messages: ChatMessage[] = needsOpener
    ? [
        ...input.history,
        {
          role: "user" as const,
          content: input.nudge ?? "Ik wil de intake starten.",
        },
      ]
    : input.history;

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
        text: systemPrompt(
          input.gaps,
          input.definitions,
          input.locale,
          input.carried ?? [],
        ),
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
