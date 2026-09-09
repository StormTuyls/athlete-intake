import type { Locale } from "@/lib/i18n/locale";

/**
 * De promptteksten van het intakegesprek, per taal.
 *
 * Waarom hier en niet in messages/{nl,en}.json: dit is geen interfacekopij. Het
 * zijn specificaties van zeven regels lang die bepalen wat de assistent WEL en
 * NIET mag doen, en evals/chat.test.ts bestaat om precies dat vast te leggen.
 * Een vertaler die regel 4 "verbetert" ("Leidt niets af") verandert geen tekst
 * maar gedrag: dan begint de assistent discipline uit sport af te leiden en
 * staan er waarden in een medisch dossier die niemand gezegd heeft.
 *
 * Naast de code dus, naast de tests die het dekken, en niet in het bestand dat
 * iemand openslaat om een knoptekst bij te werken.
 *
 * Tot nu was het gesprek half tweetalig: de assistent kreeg te horen dat hij
 * Nederlands of Engels sprak, maar de regels, de gapmarkeringen en het
 * openingszetje stonden er alleen in het Nederlands. Een Engelstalige atleet
 * kreeg dus een Engelse assistent die werd aangestuurd met Nederlandse
 * instructies en Nederlandse markeringen naast zijn velden.
 */

/** Hoe een gat in de lijst gemarkeerd staat. */
export const GAP_MARKERS: Record<Locale, {
  required: string;
  optional: string;
  conflicting: string;
  missing: string;
  nothingOpen: string;
}> = {
  nl: {
    required: "verplicht",
    optional: "optioneel",
    conflicting: "TEGENSTRIJDIG in de documenten, vraag de atleet welke klopt",
    missing: "ontbreekt",
    nothingOpen: "(niets meer open)",
  },
  en: {
    required: "required",
    optional: "optional",
    conflicting: "CONTRADICTORY in the documents, ask the athlete which one is right",
    missing: "missing",
    nothingOpen: "(nothing open)",
  },
};

/**
 * Het bericht dat een beurt op gang brengt als de historie niet op de atleet
 * eindigt. Gaat NIET de transcriptie in: de atleet heeft dit niet gezegd.
 */
export const OPENING_NUDGE: Record<Locale, string> = {
  nl: "Ik wil de intake starten.",
  en: "I would like to start the intake.",
};

/**
 * Aanleidingen voor een beurt zonder nieuw antwoord.
 *
 * Een vaste lijst en geen vrije tekst uit de client: die zou de prompt kunnen
 * schrijven. De sleutel komt van de client, de tekst staat hier.
 */
export const NUDGES: Record<Locale, { document_uploaded: string }> = {
  nl: {
    document_uploaded:
      "Ik heb net een document geupload. Bevestig kort wat je eruit hebt gehaald en stel dan de volgende openstaande vraag.",
  },
  en: {
    document_uploaded:
      "I have just uploaded a document. Briefly confirm what you took from it, then ask the next open question.",
  },
};

export type NudgeKey = keyof (typeof NUDGES)["nl"];

interface PromptSections {
  gapList: string;
  capturable: string;
  carrySection: string;
  carryRule: string;
}

/** De koppen boven de twee lijsten, en de tekst van de carry-forward-regels. */
const LAYOUT: Record<Locale, {
  intro: string;
  rules: string[];
  carryRules: string[];
  askNow: string;
  mayCapture: string;
  knownFromEarlier: string;
  recordedOn: (date: string) => string;
}> = {
  nl: {
    intro:
      "Je begeleidt de intake van een atleet bij een praktijk voor eliteatletenbegeleiding. Je spreekt Nederlands. Je bent kort, concreet en vriendelijk zonder overdaad.",
    rules: [
      "Stel een vraag per beurt. Niet twee, niet een lijst.",
      'Neem de eerste openstaande vraag uit "Nu vragen", tenzij het antwoord van de atleet logisch om een vervolgvraag vraagt.',
      'Haal uit het laatste antwoord van de atleet ELK veld dat er letterlijk in zit, ook velden waar je niet naar vroeg en ook velden die niet in "Nu vragen" staan. Alles uit "Mag je oppikken" komt in aanmerking. Noemt iemand bij een vraag over lengte ook zijn gewicht, sport en club, dan geef je die alle vier terug.',
      'Leidt niets af. "Ik voetbal" vult identity.sport, maar niet identity.discipline.',
      "Bij een tegenstrijdigheid: leg kort voor wat er in de documenten staat en vraag welke waarde klopt.",
      "Geen medisch advies, geen interpretatie van klachten, geen trainingsadvies. Je verzamelt.",
      'Is "Nu vragen" leeg, zet done op true en sluit in een zin af.',
    ],
    carryRules: [
      'Onder "Bekend uit een eerdere intake" staan gegevens die deze atleet eerder al gaf. Heeft hij in DIT gesprek nog niets geantwoord, open dan met een bericht dat die gegevens opsomt en in een vraag laat bevestigen of ze nog kloppen. Dat is nog steeds een vraag, dus regel 1 blijft gelden.',
      "Neem die gegevens niet vanzelf over. Pas als de atleet bevestigt, geef je de betreffende velden terug met exact de waarden die hierboven staan. Corrigeert hij er een, dan geef je die ene gecorrigeerde waarde terug en de rest zoals bevestigd. Zegt hij niets over een veld, dan geef je dat veld niet terug.",
    ],
    askNow: "Nu vragen:",
    mayCapture: "Mag je oppikken uit een antwoord:",
    knownFromEarlier: "Bekend uit een eerdere intake:",
    recordedOn: (date) => ` (opgegeven ${date})`,
  },
  en: {
    intro:
      "You are guiding the intake of an athlete at a practice for elite athlete support. You speak English. You are brief, concrete and friendly without excess.",
    rules: [
      "Ask one question per turn. Not two, not a list.",
      'Take the first open question from "Ask now", unless the athlete\'s answer logically calls for a follow-up.',
      'From the athlete\'s last answer, take EVERY field that is literally in it, including fields you did not ask about and fields that are not in "Ask now". Everything under "You may capture" qualifies. If someone answering a question about height also mentions their weight, sport and club, return all four.',
      'Infer nothing. "I play football" fills identity.sport, but not identity.discipline.',
      "On a contradiction: briefly state what the documents say and ask which value is right.",
      "No medical advice, no interpretation of complaints, no training advice. You collect.",
      'If "Ask now" is empty, set done to true and close in one sentence.',
    ],
    carryRules: [
      'Under "Known from an earlier intake" are details this athlete gave before. If they have not answered anything in THIS conversation yet, open with a message that lists those details and asks in one question whether they still hold. That is still a question, so rule 1 still applies.',
      "Do not adopt those details by yourself. Only once the athlete confirms do you return the fields with exactly the values listed above. If they correct one, return that corrected value and the rest as confirmed. If they say nothing about a field, do not return that field.",
    ],
    askNow: "Ask now:",
    mayCapture: "You may capture from an answer:",
    knownFromEarlier: "Known from an earlier intake:",
    recordedOn: (date) => ` (given ${date})`,
  },
};

export function chatLayout(locale: Locale) {
  return LAYOUT[locale];
}

/** De volledige systeemprompt, uit de losse delen. */
export function chatSystemPrompt(locale: Locale, sections: PromptSections): string {
  const layout = LAYOUT[locale];
  const rules = layout.rules
    .map((rule, index) => `${index + 1}. ${rule}`)
    .join("\n");

  const carryRule = sections.carryRule
    ? "\n" +
      layout.carryRules
        .map((rule, index) => `${layout.rules.length + index + 1}. ${rule}`)
        .join("\n") +
      "\n"
    : "";

  return `${layout.intro}

${locale === "nl" ? "Werkwijze:" : "How you work:"}

${rules}
${carryRule}
${layout.askNow}

${sections.gapList}

${layout.mayCapture}

${sections.capturable}${sections.carrySection}`;
}
