import { anthropic, MODEL } from "@/lib/claude/client";
import type { Gap } from "@/lib/dossier/completeness";
import type { FieldDefinition } from "@/lib/types";
import type { CarriedValue, EarlierIntake } from "@/lib/intake/carryForward";
import {
  GAP_MARKERS,
  OPENING_NUDGE,
  chatLayout,
  chatSystemPrompt,
} from "@/lib/claude/prompts/chat";

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

export interface SkippedField {
  fieldKey: string;
  reason: "unknown" | "declined";
}

export interface ChatTurnResult {
  reply: string;
  captured: CapturedField[];
  /** Waar de atleet zei dat hij het niet weet of niet wil zeggen. */
  skipped: SkippedField[];
  /** Het veld waar deze vraag over gaat, voor chat_messages.about_field_key. */
  aboutFieldKey: string | null;
  modelId: string;
  done: boolean;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "captured", "skipped", "aboutFieldKey", "done"],
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
    skipped: {
      type: "array",
      description:
        "Velden waarvan de atleet zegt dat hij ze niet weet of niet wil zeggen. Alleen als hij dat expliciet over een gevraagd veld zegt.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fieldKey", "reason"],
        properties: {
          fieldKey: { type: "string" },
          reason: {
            type: "string",
            enum: ["unknown", "declined"],
            description: "unknown: hij weet het niet. declined: hij wil het niet zeggen.",
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
  earlier: EarlierIntake[],
): string {
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  const markers = GAP_MARKERS[locale];
  const layout = chatLayout(locale);

  const gapList = gaps
    .slice(0, 12)
    .map((gap) => {
      const definition = byKey.get(gap.fieldKey);
      const type =
        definition?.dataType === "enum"
          ? `enum(${definition.enumOptions?.join("|")})`
          : (definition?.dataType ?? "text");
      const mark = gap.required ? markers.required : markers.optional;
      const why = gap.reason === "conflicting" ? markers.conflicting : markers.missing;
      return `- ${gap.fieldKey} [${type}, ${mark}, ${why}]: ${gap.question}`;
    })
    .join("\n");

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
      const when = item.fromDate ? layout.recordedOn(item.fromDate) : "";
      return `- ${item.fieldKey}: ${item.label} = ${shown}${when}`;
    })
    .join("\n");

  // Waar het eerder over ging: een regel per eerdere intake, met de blessures
  // die er toen vastgelegd zijn. Kort gehouden, want dit is context om een
  // betere openingsvraag mee te stellen en geen dossier om voor te lezen.
  const history = earlier
    .map((intake) => {
      const injuries = intake.injuries
        .map((injury) => {
          const side = injury.side === "unknown" ? "" : ` ${injury.side}`;
          const what = injury.diagnosis ?? injury.bodyRegion;
          return injury.diagnosis ? `${what} (${injury.bodyRegion}${side})` : `${what}${side}`;
        })
        .join("; ");

      const parts = [injuries, intake.complaint].filter(Boolean).join(" - ");
      const when = intake.date ?? "?";
      return `- ${when}: ${parts || (locale === "nl" ? "geen klacht vastgelegd" : "no complaint recorded")}`;
    })
    .join("\n");

  return chatSystemPrompt(locale, {
    gapList: gapList || markers.nothingOpen,
    capturable: capturable || markers.nothingOpen,
    carryRule: carried.length ? "yes" : "",
    carrySection: carried.length ? `\n\n${layout.knownFromEarlier}\n\n${known}` : "",
    historyRule: earlier.length ? "yes" : "",
    historySection: earlier.length
      ? `\n\n${layout.earlierComplaints}\n\n${history}`
      : "",
  });
}

export async function runChatTurn(input: {
  history: ChatMessage[];
  gaps: Gap[];
  definitions: FieldDefinition[];
  locale: "nl" | "en";
  /** Wat deze atleet in een eerdere intake al gaf, om te laten bevestigen. */
  carried?: CarriedValue[];
  /**
   * Waar deze atleet eerder voor kwam. Puur context voor een betere
   * openingsvraag; hier komt nooit een dossierveld uit.
   */
  earlier?: EarlierIntake[];
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
          content: input.nudge ?? OPENING_NUDGE[input.locale],
        },
      ]
    : input.history;

  const response = await client.messages.create({
    model: MODEL,
    // Was 4096, en dat was ruim zolang een beurt een antwoord op een losse
    // vraag verwerkte: een handvol velden met een kort citaat. Sinds de
    // openingsbeurt om een heel verhaal vraagt kan een enkele beurt tien tot
    // vijftien velden opleveren, elk met een citaat uit dat verhaal, en dan komt
    // 4096 in zicht. De kosten volgen het werkelijke verbruik, dus een hogere
    // limiet kost niets zolang hij niet gehaald wordt; een gehaalde limiet kost
    // het hele antwoord.
    max_tokens: 8192,
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
          input.earlier ?? [],
        ),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Model weigerde deze beurt");
  }

  // Afgekapt op de tokenlimiet levert onvolledige JSON op, en die klapt een
  // paar regels verderop op JSON.parse met "Unexpected end of JSON input". Dat
  // is een raadsel in de logs terwijl de oorzaak precies bekend is, dus zeg hem
  // hier. De atleet ziet hoe dan ook de algemene foutmelding uit lib/http.ts;
  // dit is voor wie het onderzoekt.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `Beurt afgekapt op de tokenlimiet (${response.usage.output_tokens} tokens); het antwoord is onvolledig`,
    );
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("");

  const parsed = JSON.parse(text) as {
    reply: string;
    captured: CapturedField[];
    skipped?: SkippedField[];
    aboutFieldKey: string | null;
    done: boolean;
  };

  const known = new Set(input.definitions.map((d) => d.key));

  return {
    reply: parsed.reply,
    // Een fieldKey die niet bestaat zou de foreign key laten klappen.
    captured: (parsed.captured ?? []).filter((c) => known.has(c.fieldKey)),
    skipped: (parsed.skipped ?? []).filter((s) => known.has(s.fieldKey)),
    aboutFieldKey:
      parsed.aboutFieldKey && known.has(parsed.aboutFieldKey)
        ? parsed.aboutFieldKey
        : null,
    modelId: response.model,
    done: parsed.done === true,
  };
}
