import { evaluate, referencedFields } from "@/lib/dossier/askWhen";
import type {
  Confidence,
  FieldDefinition,
  FieldStatus,
  ProposedBy,
  ResolvedField,
} from "@/lib/types";

/**
 * Het betrouwbaarheidsniveau is een regel, geen modeloutput.
 *
 * Met opzet puur en zonder IO, zodat de tabel uit het plan een-op-een te testen
 * is. Elk pad hierin is een expliciete keuze:
 *
 *   high    door de coach bevestigd, of citaat geverifieerd tegen de brontekst
 *           en de waarde valideert tegen het veldtype, en geen conflict
 *   medium  uit een bron, maar het citaat is niet terug te vinden (typisch een
 *           scan zonder tekstlaag) of de waarde valideert niet
 *   low     afgeleid, of tegenstrijdige bronnen
 */
export function deriveConfidence(input: {
  status: FieldStatus;
  proposedBy: ProposedBy;
  quoteVerified: boolean;
  typeValid: boolean;
}): Confidence {
  const { status, proposedBy, quoteVerified, typeValid } = input;

  if (status === "conflicting" || status === "inferred") return "low";
  if (proposedBy === "coach" || status === "confirmed") return "high";
  if (quoteVerified && typeValid) return "high";
  return "medium";
}

export interface Gap {
  fieldKey: string;
  section: string;
  required: boolean;
  reason: "missing" | "conflicting";
  question: string;
}

/**
 * Wat er buiten het gesprek valt, en waarom.
 *
 * Teruggegeven naast de gaten, want een veld dat niet gevraagd wordt is geen
 * niet-bestaand veld. De behandelaar hoort te zien dat de bot er niet naar
 * gevraagd heeft en waarom; anders leest een leeg veld als "niet van toepassing"
 * terwijl het "niet gevraagd" betekent, en dat zijn twee verschillende dingen
 * in een medisch dossier.
 */
export type SkipReason = "unknown" | "declined";

export interface OutOfScope {
  fieldKey: string;
  section: string;
  reason:
    | "practitioner"
    | "condition_false"
    | "condition_unknown"
    | "skipped"
    | "profile";
  /**
   * Bij een skip: of de atleet het niet WIST of het niet wilde zeggen.
   *
   * Dat verschil doet ertoe voor de behandelaar en mag niet onderweg
   * verdwijnen: het eerste is een gat dat hij kan vullen, het tweede is een
   * grens die de atleet gesteld heeft en waar hij niet overheen hoort te gaan.
   */
  skipReason?: SkipReason;
  /** Bij een voorwaarde: de velden waar ze van afhing. */
  dependsOn: string[];
}

/**
 * Wat de assistent nog moet vragen, in de volgorde waarin hij het vraagt.
 *
 * Verplichte velden eerst, daarna conflicten, daarna de optionele gaten. Een
 * conflict is een gat: het systeem heeft twee bronnen die elkaar tegenspreken en
 * mag niet stil kiezen.
 */
export function computeGaps(
  definitions: FieldDefinition[],
  resolved: Map<string, ResolvedField>,
  locale: "nl" | "en",
  /** Velden waar deze intake niet meer naar vraagt, met de reden. Zie medical.field_skips. */
  skipped: ReadonlyMap<string, SkipReason> = new Map(),
): { gaps: Gap[]; outOfScope: OutOfScope[] } {
  const gaps: Gap[] = [];
  const outOfScope: OutOfScope[] = [];

  for (const definition of definitions) {
    const field = resolved.get(definition.key);
    const status: FieldStatus = field?.status ?? "missing";

    if (status !== "missing" && status !== "conflicting") continue;

    // Een conflict is altijd een gat, ook buiten bereik en ook bij een deep
    // veld. Twee bronnen die elkaar tegenspreken zijn een probleem los van de
    // vraag of de bot ernaar zou vragen: er staat iets in het dossier dat niet
    // klopt, en dat blokkeert goedkeuring.
    const isConflict = status === "conflicting";

    if (!isConflict) {
      // Uit het profiel: nooit een gesprekssvraag. Naam, geboortedatum, sport
      // en club veranderen zo goed als nooit, en ze uitvragen in een gesprek
      // kost negen beurten voor gegevens die de praktijk al heeft. Staat het
      // veld hier toch leeg, dan is het profiel onvolledig en hoort dat daar
      // opgelost te worden, niet hier.
      if (definition.fromProfile) {
        outOfScope.push({
          fieldKey: definition.key,
          section: definition.section,
          reason: "profile",
          dependsOn: [],
        });
        continue;
      }

      if (definition.tier === "deep") {
        outOfScope.push({
          fieldKey: definition.key,
          section: definition.section,
          reason: "practitioner",
          dependsOn: [],
        });
        continue;
      }

      const skipReason = skipped.get(definition.key);
      if (skipReason) {
        outOfScope.push({
          fieldKey: definition.key,
          section: definition.section,
          reason: "skipped",
          skipReason,
          dependsOn: [],
        });
        continue;
      }

      // `core` staat boven de voorwaarde: dat zijn de velden die de deuren
      // openzetten, en die moeten gesteld worden voordat er iets te evalueren
      // valt. Een core veld met een ask_when zou zichzelf buitensluiten.
      if (definition.tier !== "core") {
        const truth = evaluate(definition.askWhen, resolved);
        if (truth !== true) {
          outOfScope.push({
            fieldKey: definition.key,
            section: definition.section,
            reason: truth === false ? "condition_false" : "condition_unknown",
            dependsOn: definition.askWhen ? referencedFields(definition.askWhen) : [],
          });
          continue;
        }
      }
    }

    const question =
      (locale === "nl" ? definition.questionNl : definition.questionEn) ??
      (locale === "nl" ? definition.labelNl : definition.labelEn);

    gaps.push({
      fieldKey: definition.key,
      section: definition.section,
      required: definition.required,
      reason: status,
      question,
    });
  }

  gaps.sort((a, b) => {
    // Conflicten eerst bij gelijke verplichting: die blokkeren goedkeuring.
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (a.reason !== b.reason) return a.reason === "conflicting" ? -1 : 1;
    return 0;
  });

  return { gaps, outOfScope };
}

export interface Completeness {
  total: number;
  filled: number;
  requiredTotal: number;
  requiredFilled: number;
  conflicts: number;
  /** Verplichte velden gevuld en geen conflicten open. */
  readyToSubmit: boolean;
}

export function computeCompleteness(
  definitions: FieldDefinition[],
  resolved: Map<string, ResolvedField>,
  /**
   * Velden die deze intake niet vraagt: naar de behandelaar, buiten bereik, of
   * overgeslagen. Komt uit computeGaps.
   *
   * Waarom dit hier moet: readyToSubmit eist dat alle verplichte velden gevuld
   * zijn. Een verplicht veld dat de bot nooit stelt kan de atleet nooit vullen,
   * en dan blokkeert het indienen voor altijd. Dat is precies het gat waar het
   * gesprek eerder in bleef hangen, nu op een andere plek. Wat buiten bereik
   * valt, telt niet mee in de noemer.
   */
  outOfScope: ReadonlySet<string> = new Set(),
): Completeness {
  let filled = 0;
  let requiredTotal = 0;
  let requiredFilled = 0;
  let conflicts = 0;

  for (const definition of definitions) {
    const status = resolved.get(definition.key)?.status ?? "missing";
    const isFilled = status !== "missing" && status !== "conflicting";

    if (isFilled) filled++;
    if (status === "conflicting") conflicts++;

    // Een gevuld veld telt altijd mee, ook als het buiten bereik viel: een
    // document kan een waarde opgeleverd hebben voor iets waar de bot niet naar
    // vroeg, en die waarde is niet minder waar.
    if (definition.required && (isFilled || !outOfScope.has(definition.key))) {
      requiredTotal++;
      if (isFilled) requiredFilled++;
    }
  }

  return {
    total: definitions.length,
    filled,
    requiredTotal,
    requiredFilled,
    conflicts,
    readyToSubmit: requiredFilled === requiredTotal && conflicts === 0,
  };
}
