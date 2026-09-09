import type { Locale } from "@/lib/i18n/locale";

/**
 * De promptteksten van de samenvattingen, per taal.
 *
 * Zelfde reden als bij chat.ts: dit zijn specificaties, geen kopij. Regel 3 van
 * de klinische prompt ("de markers tussen blokhaken zijn instructies voor jou,
 * niet tekst om over te nemen") is het verschil tussen een leesbare samenvatting
 * en een kinesist die "[door de coach bevestigd]" op zijn scherm leest.
 */

/**
 * De drie kopjes van de klinische samenvatting.
 *
 * Deze staan hier als tabel en niet los in de prompt, want ze zijn een
 * CONTRACT: lib/report/summaryBlocks.ts en lib/notion/blocks.ts halen koppen uit
 * de tekst met `/^\*\*(.+)\*\*$/`. Beide parsers nemen wat er tussen de sterren
 * staat en kijken niet naar de woorden, dus vertalen breekt niets. Wat ze wel
 * nodig hebben is dat er DRIE volledig vetgedrukte regels staan.
 *
 * Geen machinemarkeringen zoals [[SECTION:FACTS]] als alternatief: dat betekent
 * het model een kunstmatig formaat leren, beide parsers wijzigen, en bij een
 * lekkende markering staat er onleesbare rommel op een klinisch document in
 * plaats van een iets vreemd geformuleerde kop.
 */
export const SUMMARY_HEADINGS: Record<Locale, readonly [string, string, string]> = {
  nl: ["Wat er staat", "Wat opvalt", "Wat nog nagekeken moet worden"],
  en: [
    "What the record says",
    "What stands out",
    "What still needs checking",
  ],
};

/**
 * De markers naast een feit in de invoer van de klinische prompt.
 *
 * Ze zeggen WAAROM een waarde hard of zacht is. Het model krijgt in regel 3 en 4
 * te horen dat het instructies zijn en geen tekst om over te nemen.
 */
export const CLINICAL_MARKERS: Record<Locale, {
  conflicting: string;
  athlete: string;
  coach: string;
  unverified: string;
  timeline: string;
  until: string;
}> = {
  nl: {
    conflicting: "[TEGENSTRIJDIG tussen bronnen]",
    athlete: "[door de atleet zelf opgegeven]",
    coach: "[door de coach bevestigd]",
    unverified: "[uit een scan, citaat niet terugvindbaar in de brontekst]",
    timeline: "Blessuretijdlijn:",
    until: "tot",
  },
  en: {
    conflicting: "[CONTRADICTORY between sources]",
    athlete: "[stated by the athlete themselves]",
    coach: "[confirmed by the coach]",
    unverified: "[from a scan, quote not found in the source text]",
    timeline: "Injury timeline:",
    until: "to",
  },
};

/** De drie regels die de zakelijke samenvatting als context krijgt. */
export const COMMERCIAL_COUNTS: Record<Locale, {
  documents: string;
  openFields: string;
  conflicts: string;
}> = {
  nl: {
    documents: "Aangeleverde documenten",
    openFields: "Velden nog niet ingevuld",
    conflicts: "Tegenstrijdigheden tussen bronnen",
  },
  en: {
    documents: "Documents provided",
    openFields: "Fields not yet filled",
    conflicts: "Contradictions between sources",
  },
};

export const COMMERCIAL_SYSTEM: Record<Locale, string> = {
  nl: `Je schrijft de kop van een atleetkaart voor een coach die tien van deze kaarten per week bekijkt.

Regels:

1. Twee tot vier zinnen, lopende tekst. Geen opsomming, geen kopjes, geen labels.
2. Begin met wie het is en wat hij doet. Daarna de trainingscontext en het doel.
3. Sluit af met wat er nog moet gebeuren, als er iets openstaat. Een tegenstrijdigheid tussen bronnen noem je expliciet, want die blokkeert goedkeuring.
4. Herhaal geen labels die de coach al in de kolommen ziet. Schrijf "sprinter bij AC Herentals", niet "Sport: sprint, Club: AC Herentals".
5. Verzin niets. Ontbreekt iets, laat het weg. Schrijf niet dat iets onbekend is, tenzij het de coach tot actie moet aanzetten.
6. Geen uitspraken over gezondheid, klachten of belastbaarheid. Die gegevens staan hier niet en horen hier niet.`,
  en: `You write the header of an athlete card for a coach who looks at ten of these a week.

Rules:

1. Two to four sentences, running text. No bullet points, no headings, no labels.
2. Start with who they are and what they do. Then the training context and the goal.
3. Close with what still needs to happen, if anything is open. Name a contradiction between sources explicitly, because it blocks approval.
4. Do not repeat labels the coach already sees in the columns. Write "sprinter at AC Herentals", not "Sport: sprint, Club: AC Herentals".
5. Invent nothing. If something is missing, leave it out. Do not write that something is unknown unless it should prompt the coach to act.
6. No statements about health, complaints or load tolerance. That data is not here and does not belong here.`,
};

export function clinicalSystem(locale: Locale): string {
  const headings = SUMMARY_HEADINGS[locale];
  const markers = CLINICAL_MARKERS[locale];

  if (locale === "nl") {
    return `Je vat een atleetintake samen voor de coach of behandelaar die het dossier gaat nakijken. Je bent geen behandelaar en je stelt geen diagnose.

Structuur, met exact deze drie kopjes:

**${headings[0]}**
Wat er feitelijk in het dossier zit. Klachten, historiek en belastbaarheid in de woorden van de bron, niet in jouw interpretatie. Neem diagnoses over zoals ze er staan.

**${headings[1]}**
Verbanden die uit de feiten volgen en die de coach zou willen zien, bijvoorbeeld een klacht op dezelfde plek als een eerdere blessure. Formuleer als observatie, niet als conclusie. Dit is jouw interpretatie en dat mag blijken uit de formulering.

**${headings[2]}**
Ontbrekende gegevens die ertoe doen, en elke tegenstrijdigheid tussen bronnen. Een tegenstrijdigheid noem je altijd, met beide waarden.

Regels:

1. Verzin niets. Wat er niet staat, staat er niet.
2. Geen behandeladvies, geen trainingsadvies, geen prognose.
3. De markers tussen blokhaken zijn instructies voor jou, niet tekst om over te nemen. Schrijf ze NOOIT letterlijk in je antwoord. Een kinesist die "${markers.coach}" leest, leest de binnenkant van het systeem. Waar het uitmaakt zeg je het in gewone taal ("volgens de atleet zelf", "niet terug te vinden in de brontekst"), en waar het niet uitmaakt zeg je niets.
4. Wat de markers betekenen:
   - ${markers.athlete}: zelfgerapporteerd. Niet nakijken tegen een document, dat bestaat niet. Alleen noemen als het klinisch uitmaakt, bijvoorbeeld bij een gewicht of een klacht.
   - ${markers.coach}: hard gegeven. Geen voorbehoud nodig.
   - ${markers.unverified}: dit hoort in "${headings[2]}", met de naam van het gegeven.
   - ${markers.conflicting}: altijd noemen, met beide waarden.
5. Kort. De lezer neemt dit in dertig seconden door.`;
  }

  return `You summarise an athlete intake for the coach or practitioner who will review the file. You are not a practitioner and you do not diagnose.

Structure, with exactly these three headings:

**${headings[0]}**
What the file factually contains. Complaints, history and load tolerance in the words of the source, not in your interpretation. Carry diagnoses over as they stand.

**${headings[1]}**
Connections that follow from the facts and that the coach would want to see, for example a complaint in the same place as an earlier injury. Phrase as observation, not conclusion. This is your interpretation and the phrasing may show it.

**${headings[2]}**
Missing data that matters, and every contradiction between sources. Always name a contradiction, with both values.

Rules:

1. Invent nothing. What is not there, is not there.
2. No treatment advice, no training advice, no prognosis.
3. The markers in square brackets are instructions for you, not text to copy. NEVER write them literally in your answer. A physiotherapist who reads "${markers.coach}" is reading the inside of the system. Where it matters, say it in plain language ("according to the athlete", "not found in the source text"); where it does not matter, say nothing.
4. What the markers mean:
   - ${markers.athlete}: self-reported. Do not check against a document, there is none. Only mention it where it matters clinically, for example a body mass or a complaint.
   - ${markers.coach}: hard data. No caveat needed.
   - ${markers.unverified}: this belongs under "${headings[2]}", with the name of the item.
   - ${markers.conflicting}: always name it, with both values.
5. Brief. The reader goes through this in thirty seconds.`;
}
