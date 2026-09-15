import assert from "node:assert/strict";
import {
  evaluate,
  parseAskWhen,
  referencedFields,
  validateConditions,
  type AskWhen,
} from "../../lib/dossier/askWhen";
import { computeCompleteness, computeGaps } from "../../lib/dossier/completeness";
import type { FieldDefinition, FieldTier, ResolvedField } from "../../lib/types";

/**
 * De motor die bepaalt welke vragen gelden, en de faalwijze die stil is.
 *
 * Deze code beslist wat een atleet NIET gevraagd wordt. Dat is een gevaarlijker
 * soort fout dan de meeste: een vraag die ten onrechte gesteld wordt is
 * hinderlijk en meteen zichtbaar, een vraag die ten onrechte wegvalt is
 * onzichtbaar. Er komt gewoon minder, er is geen foutmelding, en het dossier
 * ziet er compleet uit.
 *
 * Wat hier daarom vastligt:
 *
 * 1. Drie waarden, niet twee. Onbekend is geen gat, en onbekend is ook niet
 *    hetzelfde als onwaar. Verdwijnt dat onderscheid, dan opent de klachtsectie
 *    ofwel nooit ofwel altijd, en beide zijn fout.
 * 2. Een kapotte verwijzing klapt. Niet: levert leeg op.
 * 3. Een conflict blijft een gat, wat er ook in de taxonomie staat.
 * 4. Een verplicht veld dat buiten bereik valt blokkeert het indienen niet.
 *    Dat was de loop, en dit is de plek waar hij terug zou kunnen komen.
 *
 * Geen databank en geen modelcall.
 */

function definition(
  key: string,
  extra: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    key,
    section: "test",
    sortOrder: 1,
    labelNl: key,
    labelEn: key,
    dataType: "text",
    required: false,
    isMedical: false,
    enumOptions: null,
    questionNl: `vraag over ${key}`,
    questionEn: `question about ${key}`,
    tier: "standard" as FieldTier,
    askWhen: null,
    fromProfile: false,
    ...extra,
  };
}

function resolved(values: Record<string, unknown>): Map<string, ResolvedField> {
  const map = new Map<string, ResolvedField>();
  for (const [key, value] of Object.entries(values)) {
    map.set(key, {
      fieldKey: key,
      value,
      status: value === null ? "missing" : "extracted",
      confidence: "medium",
      proposedBy: "athlete",
      winningProposalId: value === null ? null : 1,
      conflicts: [],
    } as ResolvedField);
  }
  return map;
}

// ---------------------------------------------------------------- 1. vorm

assert.equal(parseAskWhen(null, "x"), null, "null hoort null te blijven");

assert.throws(
  () => parseAskWhen({ field: "a", equals: 1, gte: 2 }, "x"),
  /precies een operator/,
  "twee operatoren in een vergelijking hoort te klappen",
);
assert.throws(
  () => parseAskWhen({ field: "a" }, "x"),
  /precies een operator/,
  "een vergelijking zonder operator hoort te klappen",
);
assert.throws(
  () => parseAskWhen({ veld: "a", equals: 1 }, "x"),
  /ongeldige vorm/,
  "een onbekende sleutel hoort te klappen in plaats van genegeerd te worden",
);
assert.throws(
  () => parseAskWhen("status.pain_now = true", "x"),
  /ongeldige vorm/,
  "een expressie als tekst is geen geldige voorwaarde",
);

const nested = parseAskWhen(
  { all: [{ field: "a", equals: true }, { not: { field: "b", in: ["x", "y"] } }] },
  "x",
) as AskWhen;
assert.deepEqual(
  referencedFields(nested).sort(),
  ["a", "b"],
  "referencedFields vindt niet alle verwijzingen in een geneste voorwaarde",
);

// -------------------------------------------------- 2. drie waarden

const PAIN: AskWhen = { field: "status.pain_now", equals: true };

assert.equal(
  evaluate(PAIN, resolved({})),
  "unknown",
  "een onbeantwoord veld hoort onbekend te zijn, niet onwaar",
);
assert.equal(evaluate(PAIN, resolved({ "status.pain_now": true })), true);
assert.equal(evaluate(PAIN, resolved({ "status.pain_now": false })), false);

// Een veld met status 'missing' is net zo onbekend als een veld dat er niet is.
const missing = resolved({ "status.pain_now": null });
assert.equal(
  evaluate(PAIN, missing),
  "unknown",
  "status 'missing' hoort onbekend te zijn",
);

// Een conflict mag geen kant kiezen: twee bronnen spreken elkaar tegen, en daar
// een vraag op ophangen zou stil een van beide tot waarheid maken.
const conflicting = new Map<string, ResolvedField>([
  [
    "status.pain_now",
    {
      fieldKey: "status.pain_now",
      value: true,
      status: "conflicting",
      confidence: "low",
      proposedBy: "model",
      winningProposalId: 1,
      conflicts: [{ value: false, sourceDocumentId: null, sourcePage: null, sourceQuote: null }],
    } as ResolvedField,
  ],
]);
assert.equal(
  evaluate(PAIN, conflicting),
  "unknown",
  "een tegenstrijdig veld hoort onbekend te zijn, geen waarde te kiezen",
);

// all/any/not moeten het onbekende correct doorgeven: een false in een `all`
// wint van een unknown, want dan staat de uitkomst al vast.
const A: AskWhen = { field: "a", equals: true };
const B: AskWhen = { field: "b", equals: true };

assert.equal(evaluate({ all: [A, B] }, resolved({ a: false })), false, "all met een onwaar is onwaar");
assert.equal(evaluate({ all: [A, B] }, resolved({ a: true })), "unknown", "all met een onbekende is onbekend");
assert.equal(evaluate({ any: [A, B] }, resolved({ a: true })), true, "any met een waar is waar");
assert.equal(evaluate({ any: [A, B] }, resolved({ a: false })), "unknown", "any met een onbekende is onbekend");
assert.equal(evaluate({ any: [A, B] }, resolved({ a: false, b: false })), false);
assert.equal(evaluate({ not: A }, resolved({})), "unknown", "niet-onbekend blijft onbekend");
assert.equal(evaluate({ not: A }, resolved({ a: false })), true);

// `answered` is de enige operator die over afwezigheid iets mag zeggen.
assert.equal(evaluate({ field: "a", answered: true }, resolved({})), false);
assert.equal(evaluate({ field: "a", answered: true }, resolved({ a: "iets" })), true);

// Een getaloperator op een niet-getal is onbekend, geen onwaar: dat zou een
// vraag laten wegvallen door een typefout in de taxonomie.
assert.equal(
  evaluate({ field: "a", gte: 12 }, resolved({ a: "twaalf" })),
  "unknown",
  "gte op tekst hoort onbekend te zijn",
);
assert.equal(evaluate({ field: "a", gte: 12 }, resolved({ a: 12 })), true);
assert.equal(evaluate({ field: "a", lte: 6 }, resolved({ a: 12 })), false);
assert.equal(evaluate({ field: "a", in: ["vrouw"] }, resolved({ a: "vrouw" })), true);

// ------------------------------------------------------ 3. validatie

assert.throws(
  () =>
    validateConditions([
      definition("a", { askWhen: { field: "status.pain_nwo", equals: true } }),
    ]),
  /bestaat niet/,
  "een typfout in een veldsleutel hoort te klappen, niet stil te filteren",
);

assert.throws(
  () =>
    validateConditions([
      definition("a", { askWhen: { field: "b", equals: true } }),
      definition("b", { tier: "deep" }),
    ]),
  /tier 'deep'/,
  "verwijzen naar een veld dat de bot nooit vraagt hoort te klappen",
);

assert.throws(
  () =>
    validateConditions([
      definition("a", { askWhen: { field: "b", equals: true } }),
      definition("b", { askWhen: { field: "a", equals: true } }),
    ]),
  /kring/,
  "een kring hoort te klappen: geen van beide velden kan ooit gevraagd worden",
);

validateConditions([
  definition("a", { tier: "core" }),
  definition("b", { askWhen: { field: "a", equals: true } }),
  definition("c", { askWhen: { all: [{ field: "a", equals: true }, { field: "b", answered: true }] } }),
]);

// ----------------------------------------------- 4. gaten en bereik

const TAXONOMY: FieldDefinition[] = [
  definition("status.pain_now", { tier: "core", required: true, dataType: "boolean" }),
  definition("complaint.nprs", { askWhen: { field: "status.pain_now", equals: true } }),
  definition("complaint.trend", { askWhen: { field: "status.pain_now", equals: true } }),
  definition("reds.cycle", { askWhen: { field: "identity.sex", in: ["vrouw"] } }),
  definition("identity.sex", { tier: "core" }),
  definition("icf.rom", { tier: "deep", required: true }),
  definition("load.hours", { required: true }),
];

// Niets beantwoord: alleen core en onvoorwaardelijke velden zijn gaten.
const start = computeGaps(TAXONOMY, resolved({}), "nl");
assert.deepEqual(
  start.gaps.map((gap) => gap.fieldKey).sort(),
  ["identity.sex", "load.hours", "status.pain_now"],
  "bij de start horen alleen core en onvoorwaardelijke velden gaten te zijn",
);
assert.ok(
  start.outOfScope.some(
    (entry) => entry.fieldKey === "complaint.nprs" && entry.reason === "condition_unknown",
  ),
  "een veld met een onbekende voorwaarde hoort als zodanig gerapporteerd te worden",
);
assert.ok(
  start.outOfScope.some(
    (entry) => entry.fieldKey === "icf.rom" && entry.reason === "practitioner",
  ),
  "een deep veld hoort naar de behandelaar te gaan",
);

// Pijn = ja opent de klachtvelden in een klap.
const withPain = computeGaps(
  TAXONOMY,
  resolved({ "status.pain_now": true, "identity.sex": "man" }),
  "nl",
);
assert.ok(
  ["complaint.nprs", "complaint.trend"].every((key) =>
    withPain.gaps.some((gap) => gap.fieldKey === key),
  ),
  "pijn = ja hoort de klachtvelden te openen",
);
assert.ok(
  withPain.outOfScope.some(
    (entry) => entry.fieldKey === "reds.cycle" && entry.reason === "condition_false",
  ),
  "de cyclusvraag hoort weg te vallen bij een mannelijke atleet",
);

// Pijn = nee sluit ze, en dat is het hele punt van de oefening.
const noPain = computeGaps(TAXONOMY, resolved({ "status.pain_now": false }), "nl");
assert.equal(
  noPain.gaps.filter((gap) => gap.fieldKey.startsWith("complaint.")).length,
  0,
  "pijn = nee hoort de hele klachtsectie te sluiten",
);

// Overgeslagen sluit een gat zonder waarde. Dit is de loop.
const skipped = computeGaps(TAXONOMY, resolved({}), "nl", new Map([["load.hours", "unknown" as const]]));
assert.ok(
  !skipped.gaps.some((gap) => gap.fieldKey === "load.hours"),
  "een overgeslagen veld hoort geen gat meer te zijn",
);
assert.ok(
  skipped.outOfScope.some(
    (entry) => entry.fieldKey === "load.hours" && entry.reason === "skipped",
  ),
  "een overgeslagen veld hoort zichtbaar te blijven voor de behandelaar",
);
// De reden mag onderweg niet verdwijnen: "wist het niet" is een gat dat de
// behandelaar kan vullen, "wilde het niet zeggen" is een grens. Dat verschil
// ging eerder verloren tussen de tabel en het scherm.
const declined = computeGaps(
  TAXONOMY,
  resolved({}),
  "nl",
  new Map([["load.hours", "declined" as const]]),
);
assert.equal(
  declined.outOfScope.find((entry) => entry.fieldKey === "load.hours")?.skipReason,
  "declined",
  "de reden van de skip hoort mee te komen tot in outOfScope",
);

// Een conflict blijft een gat, ook bij een deep veld en ook buiten bereik: er
// staat iets in het dossier dat niet klopt, los van de vraag of de bot ernaar
// zou vragen.
const conflicted = new Map(conflicting);
conflicted.set("icf.rom", {
  fieldKey: "icf.rom",
  value: 90,
  status: "conflicting",
  confidence: "low",
  proposedBy: "model",
  winningProposalId: 2,
  conflicts: [{ value: 120, sourceDocumentId: null, sourcePage: null, sourceQuote: null }],
} as ResolvedField);
const withConflict = computeGaps(TAXONOMY, conflicted, "nl", new Map([["icf.rom", "unknown" as const]]));
assert.ok(
  withConflict.gaps.some((gap) => gap.fieldKey === "icf.rom"),
  "een tegenstrijdigheid hoort een gat te blijven, ook bij een deep en overgeslagen veld",
);

// ------------------------------------- 5. buiten bereik blokkeert niet

// icf.rom is verplicht en deep: de bot vraagt het nooit. Zou het meetellen in de
// noemer, dan kan de atleet nooit indienen. Dat is de loop op een andere plek.
const scopeKeys = new Set(start.outOfScope.map((entry) => entry.fieldKey));
const complete = computeCompleteness(
  TAXONOMY,
  resolved({ "status.pain_now": true, "identity.sex": "man", "load.hours": 14 }),
  scopeKeys,
);
assert.equal(
  complete.requiredTotal,
  2,
  "een verplicht deep veld hoort niet in de noemer te staan",
);
assert.equal(complete.requiredFilled, 2);
assert.equal(
  complete.readyToSubmit,
  true,
  "met alle bereikbare verplichte velden gevuld hoort indienen te kunnen",
);

console.log(
  "ask-when: drie waarden gescheiden, kapotte verwijzingen klappen, conflicten blijven gaten, buiten bereik blokkeert het indienen niet",
);
