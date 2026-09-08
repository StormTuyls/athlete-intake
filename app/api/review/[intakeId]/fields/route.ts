import { NextResponse } from "next/server";
import { badRequest, handleError } from "@/lib/http";
import { logAudit } from "@/lib/audit";
import { addProposals, getProposals, syncDossier } from "@/lib/db/dossier";
import { comparisonKey, validateValue } from "@/lib/dossier/validate";
import { isIntakeId, requireCoach } from "@/lib/review/access";
import { appDb } from "@/lib/supabase/service";
import type { FieldDefinition } from "@/lib/types";

export const maxDuration = 60;

/**
 * De coach corrigeert of bevestigt een veld.
 *
 * Dit is hetzelfde mechanisme als het athlete-pad in
 * app/api/intake/fields/confirm/route.ts, met een andere rang: een voorstel met
 * `proposed_by: 'coach'` maakt het veld `confirmed` en `high`, omdat
 * resolveField en deriveConfidence dat uit de rang afleiden. Er wordt hier dus
 * met opzet nergens een status of een betrouwbaarheidsniveau ingevuld. Zou dat
 * hier gebeuren, dan bestaan er twee plekken die confidence bepalen en lopen ze
 * uit elkaar.
 *
 * Corrigeren en bevestigen zijn beide een insert: medical.field_proposals is
 * append-only. Het reviewscherm blijft dus tonen wat het model oorspronkelijk
 * voorstelde, ook nadat de coach het overschreef. Dat is de historie die het
 * dossier verdedigbaar maakt.
 *
 * Bevestigen kopieert de herkomst van het winnende voorstel mee. De coach zegt
 * "deze waarde klopt", en het citaat stond er echt, dus het mag blijven staan.
 * Corrigeren doet dat expres niet: het citaat van het model ondersteunt de
 * nieuwe waarde niet meer, en een voorstel met een documentverwijzing zonder
 * citaat leest als "dit stond in dat document".
 */

/** Waarom de waarde niet gelezen kon worden, in het Nederlands: dit scherm is van de coach. */
function inputHint(definition: FieldDefinition): string {
  switch (definition.dataType) {
    case "number":
      return "Vul een getal in, bijvoorbeeld 76,5.";
    case "date":
      return "Vul een datum in als jaar-maand-dag, bijvoorbeeld 1992-03-14.";
    case "boolean":
      return "Kies ja of nee.";
    case "enum":
      return `Kies een van: ${(definition.enumOptions ?? []).join(", ")}.`;
    case "list":
      return "Vul een of meer waarden in, gescheiden door komma's.";
    default:
      return "Dit veld mag niet leeg zijn.";
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ intakeId: string }> },
) {
  try {
    const { intakeId } = await context.params;
    const coach = await requireCoach();

    if (!isIntakeId(intakeId)) {
      return NextResponse.json({ error: "intake niet gevonden" }, { status: 404 });
    }

    const { data: intake } = await appDb()
      .from("intakes")
      .select("id, status, locale")
      .eq("id", intakeId)
      .maybeSingle();

    if (!intake) {
      return NextResponse.json({ error: "intake niet gevonden" }, { status: 404 });
    }

    // Een goedgekeurd dossier is bevroren. Wie er toch iets in wil wijzigen
    // verandert waar een rapport al naar verwijst, en dan betekent "goedgekeurd
    // op 2 september" niets meer.
    if (intake.status === "approved") {
      return NextResponse.json(
        { error: "dit dossier is goedgekeurd en niet meer te wijzigen" },
        { status: 409 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      fieldKey?: string;
      value?: unknown;
    };

    if (!body.fieldKey) return badRequest("Een veld is verplicht.");

    const locale = intake.locale as "nl" | "en";
    const state = await syncDossier(intakeId, locale);
    const definition = state.definitions.find((d) => d.key === body.fieldKey);
    if (!definition) return badRequest("Onbekend veld.");

    const resolved = state.resolved.get(definition.key);
    const proposals = await getProposals(intakeId);
    const proposalById = new Map(proposals.map((p) => [p.id, p]));

    if (body.value !== undefined) {
      const validation = validateValue(definition, body.value);
      if (!validation.valid) return badRequest(inputHint(definition));

      // Staat dezelfde waarde er al van de coach, dan is er niets gebeurd. Een
      // tweede identieke rij maakt de historie langer zonder hem beter te maken.
      const unchanged =
        resolved?.proposedBy === "coach" &&
        comparisonKey(definition.dataType, resolved.value) ===
          comparisonKey(definition.dataType, validation.normalised);

      if (!unchanged) {
        await addProposals(intakeId, [
          {
            fieldKey: definition.key,
            value: validation.normalised,
            proposedBy: "coach",
            sourceDocumentId: null,
            sourcePage: null,
            sourceQuote: null,
            quoteVerified: false,
          },
        ]);
      }
    } else {
      const winningId = resolved?.winningProposalId;
      const winner =
        winningId === null || winningId === undefined
          ? undefined
          : proposalById.get(winningId);

      if (!winner) return badRequest("Er is niets te bevestigen voor dit veld.");

      // Al door de coach afgetikt: niets te doen.
      if (winner.proposedBy !== "coach") {
        await addProposals(intakeId, [
          {
            fieldKey: definition.key,
            value: winner.value,
            proposedBy: "coach",
            sourceDocumentId: winner.sourceDocumentId,
            sourcePage: winner.sourcePage,
            sourceQuote: winner.sourceQuote,
            quoteVerified: winner.quoteVerified,
          },
        ]);
      }
    }

    // Geen waarden in het detail. Een audit-log dat de medische data nog eens
    // dupliceert vergroot het probleem dat het moet oplossen; de veldsleutel is
    // taxonomie, geen inhoud.
    await logAudit({
      action: "insert",
      actorKind: coach.role === "admin" ? "admin" : "coach",
      actorId: coach.id,
      entitySchema: "medical",
      entityTable: "field_proposals",
      entityId: intakeId,
      detail: {
        fieldKey: definition.key,
        kind: body.value !== undefined ? "correction" : "confirmation",
      },
    });

    const after = await syncDossier(intakeId, locale);

    // Het scherm haalt daarna zelf het hele dossier opnieuw op. Hier alleen de
    // uitkomst voor dit veld teruggeven zou een tweede afbeelding van
    // ReviewData opleveren die uit de pas kan lopen met getReviewData.
    return NextResponse.json({
      fieldKey: definition.key,
      conflicts: after.completeness.conflicts,
    });
  } catch (error) {
    return handleError(error);
  }
}
