import { anthropic, MODEL } from "@/lib/claude/client";
import { enumLabel } from "@/lib/dossier/enumLabels";
import type { Locale } from "@/lib/i18n/locale";
import {
  CLINICAL_MARKERS,
  COMMERCIAL_COUNTS,
  COMMERCIAL_SYSTEM,
  clinicalSystem,
} from "@/lib/claude/prompts/summary";
import type { FieldDefinition, ResolvedField } from "@/lib/types";

/**
 * Samenvattingen. Twee soorten, met opzet gescheiden.
 *
 * `commercialSummary` gaat naar Notion en krijgt uitsluitend de velden mee die
 * de synclijst toestaat. Er kan dus geen klinische inhoud in belanden, ook niet
 * per ongeluk: het model ziet die gegevens niet.
 *
 * `clinicalSummary` is voor het reviewscherm van de coach. Die krijgt het hele
 * dossier, en het resultaat is expliciet een voorstel: gegenereerd, met
 * bronvermelding, en het vervangt nooit de ruwe data. Interpreteren is aan de
 * professional.
 */

export interface SummaryResult {
  text: string;
  modelId: string;
}

function line(label: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return `${label}: ${value}`;
}

/**
 * Zakelijke samenvatting voor Notion. Geen medische gegevens in de input.
 */
/**
 * De niet-medische velden die de kaartkop nodig heeft, in deze volgorde.
 *
 * Sleutels en geen labels. De labels stonden hier eerder hardgeschreven in het
 * Nederlands, twaalf stuks, en dat had twee gebreken: ze liepen los van de
 * taxonomie (een label dat in field_definitions verandert, verandert hier niet
 * mee) en ze maakten de invoer eentalig. Nu komen ze uit de definities, dus ze
 * zijn per definitie in de taal van de samenvatting.
 */
const COMMERCIAL_FIELDS = [
  "identity.full_name",
  "identity.date_of_birth",
  "identity.sport",
  "identity.discipline",
  "identity.club",
  "identity.federation",
  "identity.coach_name",
  "status.target_event",
  "training.weekly_volume_hours",
  "training.season_phase",
  "training.seasons_experience",
  "training.strength_training_years",
] as const;

export async function commercialSummary(input: {
  values: Map<string, unknown>;
  definitions: FieldDefinition[];
  documentCount: number;
  openFields: number;
  conflicts: number;
  locale: Locale;
}): Promise<SummaryResult> {
  const byKey = new Map(input.definitions.map((d) => [d.key, d]));
  const counts = COMMERCIAL_COUNTS[input.locale];

  const facts = [
    ...COMMERCIAL_FIELDS.map((key) => {
      const definition = byKey.get(key);
      if (!definition) return null;
      const label =
        input.locale === "nl" ? definition.labelNl : definition.labelEn;
      return line(label, input.values.get(key));
    }),
    `${counts.documents}: ${input.documentCount}`,
    `${counts.openFields}: ${input.openFields}`,
    `${counts.conflicts}: ${input.conflicts}`,
  ]
    .filter((entry): entry is string => entry !== null)
    .join("\n");

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { effort: "low" },
    system: [
      {
        type: "text",
        text: COMMERCIAL_SYSTEM[input.locale],
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: facts }],
  });

  return {
    text: response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("")
      .trim(),
    modelId: response.model,
  };
}

/**
 * Klinische samenvatting voor de coach.
 *
 * Krijgt het hele dossier inclusief herkomst, en moet feit van interpretatie
 * scheiden. Dat is niet cosmetisch: de klant vroeg expliciet om onderscheid
 * tussen wat er staat en wat iemand eruit concludeert.
 */
export async function clinicalSummary(input: {
  definitions: FieldDefinition[];
  resolved: Map<string, ResolvedField>;
  /** De taal waarin de samenvatting geschreven wordt. Zie PRACTICE_LOCALE. */
  locale: Locale;
  injuries: Array<{
    bodyRegion: string;
    side: string;
    diagnosis: string | null;
    onsetDate: string | null;
    endDate: string | null;
  }>;
}): Promise<SummaryResult> {
  const facts: string[] = [];
  const markers = CLINICAL_MARKERS[input.locale];

  for (const definition of input.definitions) {
    const field = input.resolved.get(definition.key);
    if (!field || field.status === "missing") continue;

    // Het label moet zeggen WAAROM iets niet hard is. "Citaat niet
    // verifieerbaar" bij een antwoord dat de atleet zelf typte leidt tot het
    // advies om iets tegen een origineel te controleren dat niet bestaat.
    let marker = "";
    if (field.status === "conflicting") {
      marker = ` ${markers.conflicting}`;
    } else if (field.proposedBy === "athlete") {
      marker = ` ${markers.athlete}`;
    } else if (field.proposedBy === "coach") {
      marker = ` ${markers.coach}`;
    } else if (field.confidence === "medium") {
      marker = ` ${markers.unverified}`;
    }

    const shown =
      definition.dataType === "enum"
        ? enumLabel(definition.key, field.value, input.locale)
        : JSON.stringify(field.value);

    const label = input.locale === "nl" ? definition.labelNl : definition.labelEn;
    facts.push(`${label}: ${shown}${marker}`);
  }

  if (input.injuries.length > 0) {
    facts.push("");
    facts.push(markers.timeline);
    for (const injury of input.injuries) {
      const period = [injury.onsetDate, injury.endDate]
        .filter(Boolean)
        .join(` ${markers.until} `);
      facts.push(
        `- ${injury.bodyRegion} ${injury.side}${injury.diagnosis ? `, ${injury.diagnosis}` : ""}${period ? ` (${period})` : ""}`,
      );
    }
  }

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 2048,
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: clinicalSystem(input.locale),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: facts.join("\n") }],
  });

  return {
    text: response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("")
      .trim(),
    modelId: response.model,
  };
}
