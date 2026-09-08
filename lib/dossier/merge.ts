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
 * 3. Spreken voorstellen binnen de model-tier elkaar tegen na normalisatie, dan
 *    is het veld `conflicting` en gaan de rivalen mee naar het reviewscherm. Het
 *    systeem kiest niet stil tussen twee geboortedatums.
 * 4. Verschil in notatie of spelling is geen conflict. Verschil in betekenis wel.
 * 5. Alleen velden die echt tegenstrijdig kunnen zijn leveren een conflict op,
 *    zie lib/dossier/conflictable.ts. Bij vrije tekst wint de meest informatieve
 *    waarde en is er geen conflict: twee beschrijvingen van dezelfde klacht
 *    vullen elkaar aan, ze spreken elkaar niet tegen.
 * 6. Heeft een mens zich over het veld uitgesproken, dan is er geen conflict
 *    meer. Zie de uitleg bij `humanTier` hieronder.
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
  //
  // Maar 'meest informatief' geldt alleen binnen de model-tier. De reden achter
  // die regel is dat twee documenten dezelfde klacht beschrijven en elkaar
  // aanvullen, dus dat de volledigste beschrijving de betere is. Een mens die
  // zijn eigen antwoord corrigeert is geen tweede bron maar een vervanging, en
  // een correctie is vaak korter: wie "uitstraling naar het been" weghaalt,
  // schrapt tekst. Zou de lengte daar beslissen, dan wint de oude waarde en
  // verdwijnt de correctie geruisloos. Bij athlete en coach wint dus het
  // nieuwste voorstel, ook bij vrije tekst.
  const humanTier = topRank > RANK.model;
  const winner = conflictable || humanTier ? tier[0] : mostInformative(tier);

  const validation = validateValue(definition, winner.value);
  const winnerValue = validation.valid ? validation.normalised : winner.value;
  const winnerKey = comparisonKey(definition.dataType, winnerValue);

  // Een conflict is een tegenspraak tussen bronnen, geen opeenvolging van
  // beslissingen. Binnen een mens-tier ontstaat het tweede voorstel doordat
  // iemand het eerste corrigeert, dus zou de oude waarde als rivaal meetellen,
  // dan levert het oplossen van een conflict een nieuw conflict op: de coach
  // tikt de juiste geboortedatum in en het veld springt van `conflicting` naar
  // `conflicting`. Precies de knop die hij net gebruikte om het op te lossen.
  //
  // Onderscheid maken op actor is niet mogelijk: `proposed_by` is een soort
  // ('coach'), geen persoon, dus twee coaches zijn in de data niet van elkaar
  // te onderscheiden. Daarom geldt de regel voor de hele tier.
  //
  // Wat dat kost: spreken twee coaches elkaar tegen, dan zie je dat niet meer
  // als conflict. Wel nog als historie, want het reviewscherm toont alle
  // voorstellen per veld met herkomst (lib/db/review.ts, getProposalsByField).
  const conflicts: ConflictCandidate[] = [];
  if (conflictable && !humanTier) {
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
