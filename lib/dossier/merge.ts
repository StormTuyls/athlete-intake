import { comparisonKey, validateValue } from "@/lib/dossier/validate";
import { isConflictable, mostInformative } from "@/lib/dossier/conflictable";
import { deriveConfidence } from "@/lib/dossier/completeness";
import type {
  ConflictCandidate,
  FieldDefinition,
  Proposal,
  ProposedBy,
  ResolvedField,
} from "@/lib/types";

/**
 * Voorstellen omzetten naar de opgeloste toestand van een veld.
 *
 * Regels, in deze volgorde:
 *
 * 1. Rangorde: coach verslaat atleet, atleet verslaat model. De coach is
 *    eindverantwoordelijk, en de atleet is over zichzelf een primaire bron waar
 *    het model dat over hem niet is.
 * 2. Binnen dezelfde rang wint het meest recente voorstel als kandidaat.
 * 3. Spreken voorstellen binnen die rang elkaar tegen na normalisatie, dan is
 *    het veld `conflicting` en gaan de rivalen mee naar het reviewscherm. Het
 *    systeem kiest niet stil tussen twee geboortedatums.
 * 4. Verschil in notatie of spelling is geen conflict. Verschil in betekenis wel.
 * 5. Alleen velden die echt tegenstrijdig kunnen zijn leveren een conflict op,
 *    zie lib/dossier/conflictable.ts. Bij vrije tekst wint de meest informatieve
 *    waarde en is er geen conflict: twee beschrijvingen van dezelfde klacht
 *    vullen elkaar aan, ze spreken elkaar niet tegen.
 *
 * `status` beschrijft hoe de waarde in het dossier kwam, `proposedBy` wie hem
 * aandroeg. Een antwoord van de atleet is dus `extracted` met
 * `proposedBy: 'athlete'`, en pas `confirmed` als de coach het aftikt.
 */

const RANK: Record<ProposedBy, number> = { coach: 3, athlete: 2, model: 1 };

export function resolveField(
  definition: FieldDefinition,
  proposals: Proposal[],
): ResolvedField {
  if (proposals.length === 0) {
    return {
      fieldKey: definition.key,
      value: null,
      status: "missing",
      confidence: "low",
      winningProposalId: null,
      conflicts: [],
      proposedBy: null,
    };
  }

  const topRank = Math.max(...proposals.map((p) => RANK[p.proposedBy]));
  const tier = proposals
    .filter((p) => RANK[p.proposedBy] === topRank)
    .sort((a, b) => b.id - a.id);

  const conflictable = isConflictable(definition.key, definition.dataType);

  // Bij vrije tekst wint de meest informatieve waarde en is er geen conflict.
  // Bij gestructureerde velden wint het meest recente voorstel als kandidaat en
  // is elk afwijkend voorstel een rivaal.
  const winner = conflictable ? tier[0] : mostInformative(tier);

  const validation = validateValue(definition, winner.value);
  const winnerValue = validation.valid ? validation.normalised : winner.value;
  const winnerKey = comparisonKey(definition.dataType, winnerValue);

  const conflicts: ConflictCandidate[] = [];
  if (conflictable) {
    for (const rival of tier) {
      if (rival.id === winner.id) continue;
      const rivalValidation = validateValue(definition, rival.value);
      const rivalValue = rivalValidation.valid
        ? rivalValidation.normalised
        : rival.value;
      if (comparisonKey(definition.dataType, rivalValue) === winnerKey) continue;

      conflicts.push({
        proposalId: rival.id,
        value: rivalValue,
        proposedBy: rival.proposedBy,
        sourceDocumentId: rival.sourceDocumentId,
        sourcePage: rival.sourcePage,
        sourceQuote: rival.sourceQuote,
      });
    }
  }

  const status =
    conflicts.length > 0
      ? "conflicting"
      : winner.proposedBy === "coach"
        ? "confirmed"
        : "extracted";

  return {
    fieldKey: definition.key,
    value: winnerValue,
    status,
    confidence: deriveConfidence({
      status,
      proposedBy: winner.proposedBy,
      quoteVerified: winner.quoteVerified,
      typeValid: validation.valid,
    }),
    winningProposalId: winner.id,
    conflicts,
    proposedBy: winner.proposedBy,
  };
}

/** Alle velden van een intake in één keer oplossen. */
export function resolveDossier(
  definitions: FieldDefinition[],
  proposals: Proposal[],
): Map<string, ResolvedField> {
  const byField = new Map<string, Proposal[]>();
  for (const proposal of proposals) {
    const list = byField.get(proposal.fieldKey);
    if (list) list.push(proposal);
    else byField.set(proposal.fieldKey, [proposal]);
  }

  const resolved = new Map<string, ResolvedField>();
  for (const definition of definitions) {
    resolved.set(
      definition.key,
      resolveField(definition, byField.get(definition.key) ?? []),
    );
  }
  return resolved;
}
