import type { Locale } from "@/lib/i18n/locale";
import type { FieldDefinition } from "@/lib/types";

/**
 * De promptteksten van de documentextractie, per taal.
 *
 * Zelfde reden als bij chat.ts en summary.ts: dit zijn specificaties en geen
 * kopij. Regel 8 ("summary bevat geen oordeel") is de grens tussen beschrijven
 * en adviseren, en die grens is een productbeslissing, geen formulering. Een
 * vertaler die hem inkort tot "wees objectief" haalt de voorbeelden weg, en
 * precies die voorbeelden houden het model weg van "dit schema is te zwaar".
 * evals/unit/document-summary.test.ts legt vast dat de regel er staat.
 *
 * Stond tot de samenvatting erbij kwam inline in extractDocument.ts, en dat was
 * toen terecht: de prompt gaf uitsluitend veldwaarden en citaten terug, en die
 * staan in de taal van het document. Er viel niets te vertalen en niets te
 * bewaken. De samenvatting is de eerste PROZA die uit deze call komt. Proza
 * heeft een taal, en vrije tekst is precies waar een oordeel ongemerkt in
 * sluipt, dus vanaf nu hoort deze prompt bij de andere twee.
 *
 * Twee taalvarianten betekent twee promptcaches in plaats van een. Dat is de
 * prijs, en hij is klein: het leeuwendeel van de cache zit op het documentblok,
 * en dat verandert niet mee.
 */

interface ExtractPrompt {
  intro: string;
  rulesHeading: string;
  rules: string[];
  fieldsHeading: string;
  /** De opdracht in het gebruikersbericht, naast het documentblok. */
  instruction: string;
  /** De beschrijving van summary in het JSON-schema. */
  summaryDescription: string;
}

export const EXTRACT_PROMPTS: Record<Locale, ExtractPrompt> = {
  nl: {
    intro:
      "Je leest documenten uit een intake voor de begeleiding van eliteatleten en haalt daar gestructureerde gegevens uit. Je schrijft Nederlands.",
    rulesHeading: "Harde regels:",
    rules: [
      "Geef alleen een veld terug als de waarde letterlijk uit dit document blijkt. Niets afleiden, niets aanvullen uit algemene kennis, niets gokken.",
      "Elk veld heeft een sourceQuote: een letterlijk overgetypt fragment uit het document. Niet samenvatten en niet parafraseren, want het fragment wordt server-side tegen de brontekst geverifieerd. Een verzonnen citaat wordt gedetecteerd.",
      "Staat er niets relevants in het document, geef dan een lege lijst terug. Dat is een correct antwoord, geen mislukking.",
      "Bij twijfel tussen twee lezingen: laat het veld weg. Een menselijke reviewer vult het aan. Een fout gevuld veld kost meer dan een leeg veld.",
      "Medische interpretatie is niet aan jou. Neem diagnoses over zoals ze er staan, ook als je ze onwaarschijnlijk vindt.",
      // Regels 6 tot en met 9 gaan over summary. De reden dat het er vier zijn
      // en niet een: dit is de enige plek in dit systeem waar het model vrije
      // tekst schrijft. Regel 8 is expliciet over wat NIET mag, met
      // voorbeelden, want "wees beschrijvend" leest een model als stijladvies
      // en niet als een grens.
      "summary beschrijft wat dit document IS en wat erin staat: soort document, van wanneer, wie het opstelde als dat er staat, en waar het over gaat. Twee tot vijf zinnen lopende tekst, geen opsomming.",
      "Neem in summary op wat niet in een veld past maar de behandelaar wel wil weten. Bij een trainingsschema is dat de opbouw van de week: welke sessies, in welke volgorde, met welke rust ertussen. Bij een verslag is dat wat er onderzocht is en wat de conclusie was.",
      "summary bevat geen oordeel. Niet over de kwaliteit van een schema, niet over de juistheid van een diagnose, niet over de belastbaarheid van de atleet. Schrijf niet dat iets te veel, te zwaar, te weinig of onverstandig is, en ook niet dat iets goed opgebouwd is. Je beschrijft wat er staat; de behandelaar beoordeelt het.",
      "Schrijf summary zo dat iemand die het document niet opent weet wat erin staat. Een opsomming van de velden die je al teruggeeft heeft geen waarde: die ziet de lezer ernaast staan.",
    ],
    fieldsHeading: "Beschikbare velden:",
    instruction:
      "Beschrijf dit document en haal er de velden uit die er letterlijk in staan, met per veld een letterlijk citaat.",
    summaryDescription:
      "Wat dit document is en wat erin staat, in twee tot vijf zinnen lopende tekst. Beschrijvend, niet beoordelend. Leeg is toegestaan als er niets te beschrijven valt.",
  },
  en: {
    intro:
      "You read documents from an intake at a practice for elite athlete support and extract structured data from them. You write English.",
    rulesHeading: "Hard rules:",
    rules: [
      "Only return a field if the value is literally stated in this document. Infer nothing, add nothing from general knowledge, guess nothing.",
      "Every field has a sourceQuote: a fragment copied verbatim from the document. Do not summarise and do not paraphrase, because the fragment is verified server-side against the source text. An invented quote is detected.",
      "If the document contains nothing relevant, return an empty list. That is a correct answer, not a failure.",
      "When two readings are possible: leave the field out. A human reviewer fills it in. A wrongly filled field costs more than an empty one.",
      "Medical interpretation is not yours to make. Carry diagnoses over as they stand, even ones you find unlikely.",
      "summary describes what this document IS and what it contains: kind of document, its date, who produced it if stated, and what it covers. Two to five sentences of running text, no bullet points.",
      "Include in summary what does not fit in a field but the practitioner would want to know. For a training programme that is the shape of the week: which sessions, in what order, with what recovery between them. For a report it is what was examined and what the conclusion was.",
      "summary contains no judgement. Not about the quality of a programme, not about the correctness of a diagnosis, not about the athlete's load tolerance. Do not write that something is too much, too heavy, too little or unwise, and do not write that something is well structured either. You describe what is there; the practitioner judges it.",
      "Write summary so that someone who does not open the document knows what is in it. Listing the fields you are already returning adds nothing: the reader sees those next to it.",
    ],
    fieldsHeading: "Available fields:",
    instruction:
      "Describe this document and extract the fields that are literally stated in it, with a verbatim quote for each field.",
    summaryDescription:
      "What this document is and what it contains, in two to five sentences of running text. Descriptive, not evaluative. Empty is allowed if there is nothing to describe.",
  },
};

/** De volledige systeemprompt, uit de losse delen. */
export function extractSystemPrompt(
  locale: Locale,
  definitions: FieldDefinition[],
): string {
  const prompt = EXTRACT_PROMPTS[locale];

  const fieldList = definitions
    .map((d) => {
      const type =
        d.dataType === "enum" ? `enum(${d.enumOptions?.join("|")})` : d.dataType;
      return `- ${d.key} [${type}] ${d.labelNl} / ${d.labelEn}`;
    })
    .join("\n");

  const rules = prompt.rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n");

  return `${prompt.intro}

${prompt.rulesHeading}

${rules}

${prompt.fieldsHeading}

${fieldList}`;
}
