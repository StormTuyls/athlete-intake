import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { requireEditableIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { addProposals, getProposals, syncDossier } from "@/lib/db/dossier";
import { validateValue, comparisonKey } from "@/lib/dossier/validate";
import type { FieldDefinition } from "@/lib/types";
import {
  buildCard,
  collectingFrom,
  computeProgress,
  winnerIsModel,
} from "@/lib/intake/transcript";

/**
 * Een voorstel van het model bevestigen of corrigeren.
 *
 * Beide zijn een insert, geen update: medical.field_proposals is append-only,
 * afgedwongen door de statement-trigger private.reject_mutation. De historie is
 * deel van het spoor, dus ook een gecorrigeerde waarde laat zien wat het model
 * oorspronkelijk voorstelde.
 *
 * Confirm kopieert de herkomst van het winnende modelvoorstel. Daardoor wordt
 * het veld high als het citaat geverifieerd was, en blijft het medium bij een
 * scan. Dat is eerlijk verdiend: de atleet zegt dat de waarde klopt, en het
 * citaat stond er echt.
 *
 * Confirm zet met opzet GEEN status 'confirmed'. Die staat betekent dat de coach
 * heeft afgetekend, en dat onderscheid is precies waar het rangsysteem voor
 * bestaat: de atleet is over zichzelf een primaire bron, maar niet de
 * eindverantwoordelijke.
 *
 * Meevaller: staat een veld op 'conflicting' omdat twee documenten elkaar
 * tegenspreken, dan zet een Confirm er een athlete-voorstel boven. De toptier
 * heeft dan een lid en het conflict is weg. Conflictresolutie loopt dus via
 * hetzelfde endpoint, zonder apart pad.
 */
/**
 * De reden waarom een waarde niet gelezen kon worden, in het Engels en concreet.
 *
 * validateValue geeft interne redenen in het Nederlands ("geen leesbare datum"),
 * net als de rest van deze codebase. Die horen niet ongefilterd in een Engelse
 * interface, en al helemaal niet als enige uitleg: "no readable date" zegt niet
 * wat er dan wel verwacht wordt. Het veldtype weet dat, dus die bepaalt de hint.
 */
function inputHint(
  definition: FieldDefinition,
  t: Awaited<ReturnType<typeof apiMessages>>,
): string {
  switch (definition.dataType) {
    case "number":
      return t("hintNumber");
    case "date":
      return t("hintDate");
    case "boolean":
      return t("hintBoolean");
    case "enum":
      return t("hintEnum", { options: (definition.enumOptions ?? []).join(", ") });
    case "list":
      return t("hintList");
    default:
      return t("hintText");
  }
}

export async function POST(request: Request) {
  try {
    const t = await apiMessages();
    const session = await requireEditableIntake();

    if (!session.consentGrantedAt) {
      return badRequest(t("consentFirst"));
    }

    const body = (await request.json().catch(() => ({}))) as {
      fieldKey?: string;
      value?: unknown;
    };

    if (!body.fieldKey) return badRequest(t("fieldRequired"));

    const state = await syncDossier(session.intakeId, session.locale);
    const definition = state.definitions.find((d) => d.key === body.fieldKey);
    if (!definition) return badRequest(t("unknownField"));

    const resolved = state.resolved.get(definition.key);
    const proposals = await getProposals(session.intakeId);
    const proposalById = new Map(proposals.map((p) => [p.id, p]));

    const isEdit = body.value !== undefined;

    if (isEdit) {
      const validation = validateValue(definition, body.value);
      if (!validation.valid) {
        return badRequest(inputHint(definition, t));
      }

      // Al dezelfde waarde van een mens? Dan niets schrijven. Twee keer opslaan
      // hoort geen tweede rij te geven.
      const unchanged =
        resolved &&
        !winnerIsModel(resolved, proposalById) &&
        comparisonKey(definition.dataType, resolved.value) ===
          comparisonKey(definition.dataType, validation.normalised);

      if (!unchanged) {
        // Geen documentid, geen pagina, geen citaat. Het citaat van het model
        // ondersteunt deze waarde niet meer, en een voorstel dat naar een
        // document wijst zonder citaat leest in het coachscherm als "dit stond
        // in dat document". Dat stond het niet.
        await addProposals(session.intakeId, [
          {
            fieldKey: definition.key,
            value: validation.normalised,
            proposedBy: "athlete",
            sourceDocumentId: null,
            sourcePage: null,
            sourceQuote: null,
            quoteVerified: false,
          },
        ]);
      }
    } else {
      // Confirm. De waarde komt uit het winnende voorstel op de server, nooit
      // uit de body: anders bepaalt de client wat er bevestigd wordt.
      const winningId = resolved?.winningProposalId;
      const winner = winningId === null || winningId === undefined
        ? undefined
        : proposalById.get(winningId);

      if (!winner) return badRequest(t("nothingToConfirm"));

      // Komt de winnaar al van een mens, dan is er niets te bevestigen.
      if (winner.proposedBy === "model") {
        await addProposals(session.intakeId, [
          {
            fieldKey: definition.key,
            value: winner.value,
            proposedBy: "athlete",
            sourceDocumentId: winner.sourceDocumentId,
            sourcePage: winner.sourcePage,
            sourceQuote: winner.sourceQuote,
            quoteVerified: winner.quoteVerified,
          },
        ]);
      }
    }

    const after = await syncDossier(session.intakeId, session.locale);
    const afterProposals = await getProposals(session.intakeId);
    const afterById = new Map(afterProposals.map((p) => [p.id, p]));
    const afterField = after.resolved.get(definition.key);

    return NextResponse.json({
      card: buildCard(
        definition,
        afterField,
        winnerIsModel(afterField, afterById),
        session.locale,
      ),
      completeness: after.completeness,
      collecting: collectingFrom(after.gaps, session.locale),
      progress: computeProgress(
        after.definitions,
        after.gaps,
        after.completeness.requiredFilled,
        after.completeness.requiredTotal,
      ),
    });
  } catch (error) {
    return handleError(error);
  }
}
