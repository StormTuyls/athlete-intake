import assert from "node:assert/strict";
import { chatLayout, chatSystemPrompt } from "../../lib/claude/prompts/chat";
import nl from "../../messages/nl.json";
import en from "../../messages/en.json";

/**
 * De openingsbeurt, en de nummering van de regels die hem beschrijven.
 *
 * Twee dingen die los van elkaar kunnen breken.
 *
 * Het eerste is inhoudelijk: de eerste beurt hoort een uitnodiging te zijn om
 * in een keer te vertellen wat er speelt, en bij een terugkerende atleet hoort
 * daar een verwijzing naar zijn vorige klacht bij. Dat scheelt het verschil
 * tussen vijfentwintig beurten en een handvol, en het is de hele reden dat
 * deze regels bestaan.
 *
 * Het tweede is mechanisch, en subtieler. Er zijn drie blokken regels: de vaste
 * regels, de carry-forwardregels en de historieregels. De laatste twee komen er
 * alleen bij als er iets is om ze op toe te passen, en ze worden doorgenummerd
 * vanaf de vaste regels. Nummerden ze allebei vanaf hetzelfde punt, dan staat
 * er bij een atleet met een verleden twee keer een regel 9 in de prompt, en de
 * regels verwijzen naar elkaar via hun nummer ("het openingsbericht van regel
 * 2"). Een prompt met twee regels 9 is geen foutmelding, alleen een assistent
 * die soms iets anders doet.
 *
 * Geen databank en geen modelcall.
 */

const LOCALES = ["nl", "en"] as const;

const SECTIONS = {
  gapList: "- identity.full_name [text, verplicht, ontbreekt]: Wat is je volledige naam?",
  capturable: "- identity.full_name [text] Volledige naam",
};

for (const locale of LOCALES) {
  const layout = chatLayout(locale);

  // 1. De openingsregel bestaat en zegt dat de eerste beurt geen losse vraag is.
  const opening = layout.rules[1];
  const marker = locale === "nl" ? "DIT gesprek" : "THIS conversation";
  assert.ok(
    opening.includes(marker),
    `${locale}: regel 2 gaat niet meer over de eerste beurt van dit gesprek`,
  );

  // 2. Alle drie de blokken bestaan en zijn niet leeggelopen.
  assert.ok(layout.rules.length >= 8, `${locale}: te weinig vaste regels`);
  assert.ok(layout.carryRules.length >= 2, `${locale}: carry-forwardregels ontbreken`);
  assert.ok(layout.historyRules.length >= 3, `${locale}: historieregels ontbreken`);

  // 3. De historieregel verbiedt expliciet dat er een veld uit komt. Dit is de
  //    grens die voorkomt dat een klacht van vorige keer stilzwijgend het
  //    dossier van deze keer in wandelt.
  const never = locale === "nl" ? "nooit een veld" : "Never return a field";
  assert.ok(
    layout.historyRules.some((rule) => rule.includes(never)),
    `${locale}: de regel dat er nooit een veld uit de historie komt is weg`,
  );

  // 4. Zonder carry en zonder historie staan die blokken er niet, en de prompt
  //    eindigt dus niet met lege kopjes.
  const bare = chatSystemPrompt(locale, {
    ...SECTIONS,
    carryRule: "",
    carrySection: "",
    historyRule: "",
    historySection: "",
  });
  assert.ok(
    !bare.includes(layout.knownFromEarlier),
    `${locale}: het carry-forwardkopje staat er terwijl er niets is`,
  );
  assert.ok(
    !bare.includes(layout.earlierComplaints),
    `${locale}: het historiekopje staat er terwijl er niets is`,
  );
  assert.ok(
    !bare.includes(`${layout.rules.length + 1}. `),
    `${locale}: er staat een voorwaardelijke regel in een prompt zonder voorwaarden`,
  );

  // 5. Met allebei erbij lopen de nummers door zonder gat en zonder duplicaat.
  const full = chatSystemPrompt(locale, {
    ...SECTIONS,
    carryRule: "yes",
    carrySection: `\n\n${layout.knownFromEarlier}\n\n- identity.club: Club = AC Herentals`,
    historyRule: "yes",
    historySection: `\n\n${layout.earlierComplaints}\n\n- 2026-08-12: hamstring right`,
  });

  const total = layout.rules.length + layout.carryRules.length + layout.historyRules.length;
  for (let number = 1; number <= total; number++) {
    const occurrences = full.split(`\n${number}. `).length - 1;
    assert.equal(
      occurrences,
      1,
      `${locale}: regel ${number} komt ${occurrences} keer voor in de prompt, verwacht precies een`,
    );
  }
  assert.ok(
    !full.includes(`\n${total + 1}. `),
    `${locale}: er staat een regel ${total + 1} die nergens gedefinieerd is`,
  );

  // 6. Beide kopjes staan er nu wel, met hun inhoud eronder.
  assert.ok(full.includes(layout.knownFromEarlier), `${locale}: carry-forwardkopje ontbreekt`);
  assert.ok(full.includes(layout.earlierComplaints), `${locale}: historiekopje ontbreekt`);
}

// 7. De uitleg aan de atleet zegt dat hij in een keer mag vertellen. Zonder dat
//    leest hij een open vraag als "geef antwoord in een zin", en dan is de
//    openingsregel een lege belofte.
for (const [language, catalog] of [
  ["nl", nl],
  ["en", en],
] as const) {
  const point = catalog.chat.intro.point1;
  const needle = language === "nl" ? "eigen woorden" : "own words";
  assert.ok(
    point.includes(needle),
    `${language}: chat.intro.point1 nodigt niet uit tot een eigen verhaal`,
  );
  const mic = language === "nl" ? "microfoon" : "microphone";
  assert.ok(
    point.includes(mic),
    `${language}: chat.intro.point1 noemt de dicteerknop niet`,
  );
}

console.log(
  "chat-opening: de eerste beurt vraagt om een verhaal, de historie is context, en de regels zijn doorgenummerd",
);
