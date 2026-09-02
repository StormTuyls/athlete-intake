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
): Gap[] {
  const gaps: Gap[] = [];

  for (const definition of definitions) {
    const field = resolved.get(definition.key);
    const status: FieldStatus = field?.status ?? "missing";

    if (status !== "missing" && status !== "conflicting") continue;

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

  return gaps.sort((a, b) => {
    // Conflicten eerst bij gelijke verplichting: die blokkeren goedkeuring.
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (a.reason !== b.reason) return a.reason === "conflicting" ? -1 : 1;
    return 0;
  });
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
    if (definition.required) {
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
