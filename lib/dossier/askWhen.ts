import { z } from "zod";
import type { FieldDefinition, ResolvedField } from "@/lib/types";

/**
 * Wanneer een veld in bereik is.
 *
 * Het probleem dat dit oplost: een intakeprotocol bevat vragen die lang niet
 * voor iedereen gelden. De menstruatievraag uit de REDs-screening geldt niet
 * voor een man; de acht vragen over het beloop van een klacht gelden niet voor
 * iemand zonder klacht. Tot nu was elk veld een gat tot het een waarde had, dus
 * kreeg iedereen alles.
 *
 * ---------------------------------------------------------------------------
 * De vorm is met opzet krap
 * ---------------------------------------------------------------------------
 *
 * Gesloten JSON, zes operatoren, drie combinatoren. Geen SQL, geen expressies,
 * geen functies. Deze voorwaarden staan in public.field_definitions, een tabel
 * die de praktijk bewerkt zonder deploy, en alles wat je erin kunt schrijven
 * kun je er ook fout in schrijven. Een gesloten vorm is te valideren; een
 * expressietaal is dat niet, en zou bovendien een evaluator opleveren die
 * willekeurige code uitvoert op invoer uit een tabel.
 *
 * Voor de 85 vragen uit het intakeprotocol is dit genoeg. Blijkt er ooit meer
 * nodig, dan is dat een bewuste uitbreiding met een test erbij, en geen
 * ontsnappingsluik dat er al in zat.
 *
 * ---------------------------------------------------------------------------
 * Drie waarden, niet twee
 * ---------------------------------------------------------------------------
 *
 * Dit is de kern. Een voorwaarde levert `true`, `false`, of `unknown`, en dat
 * derde geval is het grootste deel van een intake waar.
 *
 * Aan het begin is `status.pain_now` niet beantwoord. Is de klachtsectie dan in
 * bereik? Dat weet je niet. Beide tweewaardige antwoorden zijn fout:
 *
 *   onbekend telt als onwaar → de klachtsectie opent nooit, ook niet nadat de
 *     atleet "ja" zegt, want er is nooit naar gevraagd. Acht vragen verdwijnen
 *     stil uit elke intake.
 *   onbekend telt als waar → er wordt niets gefilterd tot alles beantwoord is,
 *     en dan is de intake precies zo lang als hij nu al is.
 *
 * Wat wel klopt: onbekend is NOG GEEN GAT. Het veld wordt er een zodra de
 * voorwaarde waar wordt. Daar zit meteen de volgorde in: het veld waar de
 * voorwaarde naar verwijst hoort `core` te zijn en wordt dus vroeg gevraagd,
 * en op het moment dat het antwoord binnenkomt gaan de afhankelijke velden in
 * een klap open. Geen afhankelijkheidsgraaf, geen topologische sortering;
 * sort_order doet de rest.
 *
 * ---------------------------------------------------------------------------
 * De faalwijze waar het echt om gaat
 * ---------------------------------------------------------------------------
 *
 * Een typfout in een veldsleutel. `{"field": "status.pain_nwo", ...}` verwijst
 * nergens naar. Zou dat `unknown` opleveren, dan is de voorwaarde voor altijd
 * onbekend en verdwijnen de afhankelijke vragen uit de intake van ELKE atleet,
 * zonder een enkele foutmelding. Er komt gewoon minder, en niemand merkt het.
 *
 * Daarom is een onbekende sleutel een harde fout en geen lege uitkomst. De
 * controle zit op twee plekken: validateConditions() draait bij het laden van
 * de definities, en evals/unit/ask-when.test.ts legt dezelfde controle over de
 * seed zodat een fout al in CI valt, zonder databank.
 */

/** Een voorwaarde levert waar, onwaar, of "daar is nog niets over bekend". */
export type Truth = true | false | "unknown";

const COMPARISON = z
  .object({
    field: z.string().min(1),
    equals: z.unknown().optional(),
    not_equals: z.unknown().optional(),
    in: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).optional(),
    gte: z.number().optional(),
    lte: z.number().optional(),
    answered: z.literal(true).optional(),
  })
  .strict()
  // Precies een operator per vergelijking. Twee operatoren naast elkaar zou
  // stilzwijgend een van de twee negeren, en welke dat is hangt af van de
  // volgorde in de evaluator. Dat is geen vorm die iemand moet onthouden.
  .refine(
    (value) =>
      ["equals", "not_equals", "in", "gte", "lte", "answered"].filter(
        (operator) => operator in value,
      ).length === 1,
    { message: "een vergelijking heeft precies een operator" },
  );

export type AskWhen =
  | z.infer<typeof COMPARISON>
  | { all: AskWhen[] }
  | { any: AskWhen[] }
  | { not: AskWhen };

export const ASK_WHEN: z.ZodType<AskWhen> = z.lazy(() =>
  z.union([
    COMPARISON,
    z.object({ all: z.array(ASK_WHEN).min(1) }).strict(),
    z.object({ any: z.array(ASK_WHEN).min(1) }).strict(),
    z.object({ not: ASK_WHEN }).strict(),
  ]),
);

/**
 * De voorwaarde van een enkel veld ontleden.
 *
 * Gooit bij een verkeerde vorm. De aanroeper hoort dat niet op te vangen: een
 * voorwaarde die niet te lezen is, is een taxonomie die stuk is, en daar hoort
 * het opstarten op te klappen en niet een intake stilletjes op te korten.
 */
export function parseAskWhen(raw: unknown, fieldKey: string): AskWhen | null {
  if (raw === null || raw === undefined) return null;

  const parsed = ASK_WHEN.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `ask_when van ${fieldKey} heeft een ongeldige vorm: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(wortel)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

/** Elke veldsleutel waar een voorwaarde naar verwijst. */
export function referencedFields(condition: AskWhen): string[] {
  if ("all" in condition) return condition.all.flatMap(referencedFields);
  if ("any" in condition) return condition.any.flatMap(referencedFields);
  if ("not" in condition) return referencedFields(condition.not);
  return [condition.field];
}

/**
 * Elke voorwaarde in de taxonomie nakijken, tegen de taxonomie zelf.
 *
 * Drie dingen die geen van alle door een check constraint te vangen zijn, want
 * die kijkt niet naar andere rijen:
 *
 * 1. Verwijst de voorwaarde naar een veld dat bestaat? Zo niet, dan zou hij
 *    voor altijd onbekend zijn en de afhankelijke vragen stil laten verdwijnen.
 * 2. Verwijst hij naar een `deep` veld? Dat vraagt de bot nooit, dus de
 *    voorwaarde wordt nooit waar en het afhankelijke veld opent nooit.
 * 3. Verwijst hij naar zichzelf, direct of via een keten? Dan opent het veld
 *    nooit, want zijn eigen antwoord is de voorwaarde om ernaar te vragen.
 *
 * Gooit bij het eerste probleem, met de veldsleutel erin. Een lijst van alle
 * problemen zou vriendelijker zijn, maar dit draait bij het laden en daar telt
 * dat het stopt.
 */
export function validateConditions(
  definitions: Array<Pick<FieldDefinition, "key" | "tier"> & { askWhen: AskWhen | null }>,
): void {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  for (const definition of definitions) {
    if (!definition.askWhen) continue;

    for (const reference of referencedFields(definition.askWhen)) {
      const target = byKey.get(reference);
      if (!target) {
        throw new Error(
          `ask_when van ${definition.key} verwijst naar ${reference}, en dat veld bestaat niet`,
        );
      }
      if (target.tier === "deep") {
        throw new Error(
          `ask_when van ${definition.key} verwijst naar ${reference}, maar dat veld heeft tier 'deep' en wordt dus nooit gevraagd`,
        );
      }
    }
  }

  // Kringen apart, want die zijn pas te zien als alle verwijzingen kloppen.
  //
  // Alleen terugkomen bij het VERTREKPUNT is een kring. Twee velden die allebei
  // van hetzelfde derde veld afhangen is een ruit en volstrekt normaal: zowel
  // de NPRS-vraag als het beloop hangen van `status.pain_now` af. Een bezocht
  // veld overslaan is dus terminatie en geen fout, en dat onderscheid was hier
  // eerst niet gemaakt.
  for (const definition of definitions) {
    if (!definition.askWhen) continue;
    const visited = new Set<string>();
    const queue = referencedFields(definition.askWhen);

    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (next === definition.key) {
        throw new Error(
          `ask_when van ${definition.key} loopt in een kring; dat veld kan nooit gevraagd worden`,
        );
      }
      if (visited.has(next)) continue;
      visited.add(next);
      const target = byKey.get(next);
      if (target?.askWhen) queue.push(...referencedFields(target.askWhen));
    }
  }
}

/**
 * De waarde die een voorwaarde over een veld ziet.
 *
 * Een veld met status 'missing' of 'conflicting' heeft geen bruikbare waarde:
 * bij het eerste is er niets, bij het tweede spreken de bronnen elkaar tegen en
 * mag het systeem niet stil een van beide kiezen om een vraag op te hangen.
 * Beide leveren 'unknown'.
 */
function valueOf(fieldKey: string, resolved: Map<string, ResolvedField>): unknown {
  const field = resolved.get(fieldKey);
  if (!field) return undefined;
  if (field.status === "missing" || field.status === "conflicting") return undefined;
  return field.value ?? undefined;
}

export function evaluate(
  condition: AskWhen | null,
  resolved: Map<string, ResolvedField>,
): Truth {
  if (!condition) return true;

  if ("all" in condition) {
    const results = condition.all.map((part) => evaluate(part, resolved));
    if (results.includes(false)) return false;
    return results.includes("unknown") ? "unknown" : true;
  }

  if ("any" in condition) {
    const results = condition.any.map((part) => evaluate(part, resolved));
    if (results.includes(true)) return true;
    return results.includes("unknown") ? "unknown" : false;
  }

  if ("not" in condition) {
    const result = evaluate(condition.not, resolved);
    return result === "unknown" ? "unknown" : !result;
  }

  const value = valueOf(condition.field, resolved);

  // `answered` is de enige operator die op afwezigheid mag antwoorden. De rest
  // kan over een onbekende waarde niets zeggen, en doet dat dan ook niet.
  if (condition.answered === true) return value !== undefined;
  if (value === undefined) return "unknown";

  if ("equals" in condition) return value === condition.equals;
  if ("not_equals" in condition) return value !== condition.not_equals;
  if (condition.in) {
    return condition.in.some((option) => option === value);
  }
  // Een niet-numerieke waarde vergelijken met gte/lte is geen 'false' maar een
  // vraag die niet gesteld is: de taxonomie zet zo'n voorwaarde alleen op een
  // getalveld, en staat er toch iets anders, dan is dat geen reden om de vraag
  // stil te laten vallen.
  if (typeof condition.gte === "number") {
    return typeof value === "number" ? value >= condition.gte : "unknown";
  }
  if (typeof condition.lte === "number") {
    return typeof value === "number" ? value <= condition.lte : "unknown";
  }

  return "unknown";
}
