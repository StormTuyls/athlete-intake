import { anthropic, MODEL } from "@/lib/claude/client";
import { label } from "@/lib/dossier/labels";
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
export async function commercialSummary(input: {
  values: Map<string, unknown>;
  documentCount: number;
  openFields: number;
  conflicts: number;
}): Promise<SummaryResult> {
  const get = (key: string) => input.values.get(key);

  const facts = [
    line("Naam", get("identity.full_name")),
    line("Geboortedatum", get("identity.date_of_birth")),
    line("Sport", get("identity.sport")),
    line("Discipline", get("identity.discipline")),
    line("Club", get("identity.club")),
    line("Federatie", get("identity.federation")),
    line("Coach", get("identity.coach_name")),
    line("Doelwedstrijd", get("status.target_event")),
    line("Trainingsvolume per week in uren", get("training.weekly_volume_hours")),
    line("Seizoensfase", get("training.season_phase")),
    line("Jaren ervaring", get("training.seasons_experience")),
    line("Jaren krachttraining", get("training.strength_training_years")),
    `Aangeleverde documenten: ${input.documentCount}`,
    `Velden nog niet ingevuld: ${input.openFields}`,
    `Tegenstrijdigheden tussen bronnen: ${input.conflicts}`,
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
        text: `Je schrijft de kop van een atleetkaart voor een coach die tien van deze kaarten per week bekijkt.

Regels:

1. Twee tot vier zinnen, lopende tekst. Geen opsomming, geen kopjes, geen labels.
2. Begin met wie het is en wat hij doet. Daarna de trainingscontext en het doel.
3. Sluit af met wat er nog moet gebeuren, als er iets openstaat. Een tegenstrijdigheid tussen bronnen noem je expliciet, want die blokkeert goedkeuring.
4. Herhaal geen labels die de coach al in de kolommen ziet. Schrijf "sprinter bij AC Herentals", niet "Sport: sprint, Club: AC Herentals".
5. Verzin niets. Ontbreekt iets, laat het weg. Schrijf niet dat iets onbekend is, tenzij het de coach tot actie moet aanzetten.
6. Geen uitspraken over gezondheid, klachten of belastbaarheid. Die gegevens staan hier niet en horen hier niet.`,
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
  injuries: Array<{
    bodyRegion: string;
    side: string;
    diagnosis: string | null;
    onsetDate: string | null;
    endDate: string | null;
  }>;
}): Promise<SummaryResult> {
  const facts: string[] = [];

  for (const definition of input.definitions) {
    const field = input.resolved.get(definition.key);
    if (!field || field.status === "missing") continue;

    // Het label moet zeggen WAAROM iets niet hard is. "Citaat niet
    // verifieerbaar" bij een antwoord dat de atleet zelf typte leidt tot het
    // advies om iets tegen een origineel te controleren dat niet bestaat.
    let marker = "";
    if (field.status === "conflicting") {
      marker = " [TEGENSTRIJDIG tussen bronnen]";
    } else if (field.proposedBy === "athlete") {
      marker = " [door de atleet zelf opgegeven]";
    } else if (field.proposedBy === "coach") {
      marker = " [door de coach bevestigd]";
    } else if (field.confidence === "medium") {
      marker = " [uit een scan, citaat niet terugvindbaar in de brontekst]";
    }

    const shown =
      definition.dataType === "enum" ? label(field.value) : JSON.stringify(field.value);

    facts.push(`${definition.labelNl}: ${shown}${marker}`);
  }

  if (input.injuries.length > 0) {
    facts.push("");
    facts.push("Blessuretijdlijn:");
    for (const injury of input.injuries) {
      const period = [injury.onsetDate, injury.endDate].filter(Boolean).join(" tot ");
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
        text: `Je vat een atleetintake samen voor de coach of behandelaar die het dossier gaat nakijken. Je bent geen behandelaar en je stelt geen diagnose.

Structuur, met exact deze drie kopjes:

**Wat er staat**
Wat er feitelijk in het dossier zit. Klachten, historiek en belastbaarheid in de woorden van de bron, niet in jouw interpretatie. Neem diagnoses over zoals ze er staan.

**Wat opvalt**
Verbanden die uit de feiten volgen en die de coach zou willen zien, bijvoorbeeld een klacht op dezelfde plek als een eerdere blessure. Formuleer als observatie, niet als conclusie. Dit is jouw interpretatie en dat mag blijken uit de formulering.

**Wat nog nagekeken moet worden**
Ontbrekende gegevens die ertoe doen, en elke tegenstrijdigheid tussen bronnen. Een tegenstrijdigheid noem je altijd, met beide waarden.

Regels:

1. Verzin niets. Wat er niet staat, staat er niet.
2. Geen behandeladvies, geen trainingsadvies, geen prognose.
3. De markers tussen blokhaken zijn instructies voor jou, niet tekst om over te nemen. Schrijf ze NOOIT letterlijk in je antwoord. Een kinesist die "[door de coach bevestigd]" leest, leest de binnenkant van het systeem. Waar het uitmaakt zeg je het in gewone taal ("volgens de atleet zelf", "niet terug te vinden in de brontekst"), en waar het niet uitmaakt zeg je niets.
4. Wat de markers betekenen:
   - [door de atleet zelf opgegeven]: zelfgerapporteerd. Niet nakijken tegen een document, dat bestaat niet. Alleen noemen als het klinisch uitmaakt, bijvoorbeeld bij een gewicht of een klacht.
   - [door de coach bevestigd]: hard gegeven. Geen voorbehoud nodig.
   - [uit een scan, citaat niet terugvindbaar in de brontekst]: dit hoort in "Wat nog nagekeken moet worden", met de naam van het gegeven.
   - [TEGENSTRIJDIG tussen bronnen]: altijd noemen, met beide waarden.
5. Kort. De lezer neemt dit in dertig seconden door.`,
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
