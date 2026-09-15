import assert from "node:assert/strict";
import { EXTRACT_PROMPTS, extractSystemPrompt } from "../../lib/claude/prompts/extract";
import { schemaFor } from "../../lib/claude/extractDocument";
import type { FieldDefinition } from "../../lib/types";
import nl from "../../messages/nl.json";
import en from "../../messages/en.json";

/**
 * De grens tussen beschrijven en beoordelen, vastgelegd.
 *
 * summary is de enige plek in dit systeem waar het model vrije tekst schrijft.
 * Overal elders is de uitvoer een waarde met een citaat eronder, en daar bewaakt
 * de citaatverificatie de grens. Hier bewaakt alleen de prompt hem, en een
 * prompt is een tekstbestand dat iemand kan inkorten.
 *
 * Wat deze test dus vasthoudt is niet de formulering maar het BESTAAN van de
 * regel, in beide talen: er moet gezegd worden dat er geen oordeel in mag, en
 * er moeten voorbeelden bij staan van wat een oordeel is. Zonder die
 * voorbeelden leest een model "beschrijvend" als stijladvies.
 *
 * Geen databank en geen modelcall: het gaat om promptteksten en een JSON-schema,
 * dus dit draait in CI zonder Supabase en zonder API-sleutel.
 */

const LOCALES = ["nl", "en"] as const;

// Een definitie is genoeg om de veldenlijst te laten renderen; deze test gaat
// niet over de taxonomie.
const DEFINITIONS: FieldDefinition[] = [
  {
    key: "training.current_programme",
    section: "training",
    sortOrder: 6,
    labelNl: "Huidig trainingsschema",
    labelEn: "Current training programme",
    dataType: "long_text",
    required: false,
    isMedical: false,
    enumOptions: null,
    questionNl: null,
    questionEn: null,
    tier: "standard",
    askWhen: null,
    fromProfile: false,
  },
];

for (const locale of LOCALES) {
  const prompt = EXTRACT_PROMPTS[locale];

  // 1. Het schema verplicht een samenvatting. Zonder 'required' mag het model
  //    het veld weglaten, en dan is de kolom stil leeg in plaats van zichtbaar
  //    leeg.
  const schema = schemaFor(locale, DEFINITIONS);
  assert.ok(
    (schema.required as readonly string[]).includes("summary"),
    `${locale}: summary staat niet in required, dan mag het model hem weglaten`,
  );
  assert.equal(
    schema.properties.summary.description,
    prompt.summaryDescription,
    `${locale}: de schemabeschrijving loopt niet met de prompttabel mee`,
  );

  // 2. De regels over summary staan er, en het zijn er vier. Deze telling is
  //    geen stijlpolitie: ze valt om zodra iemand er een samenvoegt of weghaalt,
  //    en dan hoort iemand te kijken WELKE verdween.
  const summaryRules = prompt.rules.filter((rule) => rule.includes("summary"));
  assert.equal(
    summaryRules.length,
    4,
    `${locale}: verwacht vier regels over summary, gevonden ${summaryRules.length}`,
  );

  // 3. De kern: er moet ergens staan dat er geen oordeel in mag, met
  //    voorbeelden van wat een oordeel is.
  const noJudgement = locale === "nl" ? "geen oordeel" : "no judgement";
  assert.ok(
    summaryRules.some((rule) => rule.toLowerCase().includes(noJudgement)),
    `${locale}: de regel dat summary geen oordeel bevat is weg`,
  );

  const examples =
    locale === "nl"
      ? ["te veel", "te zwaar", "onverstandig", "goed opgebouwd"]
      : ["too much", "too heavy", "unwise", "well structured"];
  for (const example of examples) {
    assert.ok(
      summaryRules.some((rule) => rule.toLowerCase().includes(example)),
      `${locale}: het voorbeeld '${example}' is uit de oordeelregel verdwenen`,
    );
  }

  // 4. De oude regels staan er nog. De samenvatting is erbij gekomen; ze heeft
  //    niets vervangen.
  assert.equal(
    prompt.rules.length,
    9,
    `${locale}: verwacht negen regels, gevonden ${prompt.rules.length}`,
  );
  const noInterpretation = locale === "nl" ? "Medische interpretatie" : "Medical interpretation";
  assert.ok(
    prompt.rules.some((rule) => rule.includes(noInterpretation)),
    `${locale}: de regel over medische interpretatie is weg`,
  );

  // 5. De opgebouwde prompt bevat wat erin hoort, in de goede taal, en de
  //    velden komen mee.
  const system = extractSystemPrompt(locale, DEFINITIONS);
  assert.ok(system.startsWith(prompt.intro), `${locale}: de intro staat niet bovenaan`);
  assert.ok(
    system.includes("9. "),
    `${locale}: de regels zijn niet genummerd tot en met negen`,
  );
  assert.ok(
    system.includes("training.current_programme"),
    `${locale}: de veldenlijst zit niet in de prompt`,
  );

  const wrongLanguage = locale === "nl" ? EXTRACT_PROMPTS.en : EXTRACT_PROMPTS.nl;
  assert.ok(
    !system.includes(wrongLanguage.intro),
    `${locale}: er lekt tekst uit de andere taal in de prompt`,
  );
}

// 6. Het label op het coachscherm bestaat in beide talen en zegt dat het
//    gegenereerd is. Zonder dat label leest een behandelaar een alinea die
//    eruitziet alsof iemand hem geschreven heeft.
for (const [language, catalog] of [
  ["nl", nl],
  ["en", en],
] as const) {
  const label = catalog.review.documentSummaryLabel;
  assert.ok(
    typeof label === "string" && label.length > 0,
    `${language}: review.documentSummaryLabel ontbreekt`,
  );
  const generated = language === "nl" ? "gegenereerd" : "generated";
  assert.ok(
    label.toLowerCase().includes(generated),
    `${language}: het label zegt niet dat de tekst gegenereerd is`,
  );
}

console.log(
  "document-summary: schema verplicht een samenvatting, de oordeelgrens staat in beide talen, label is gelabeld",
);
