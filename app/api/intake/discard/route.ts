import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { badRequest, handleError } from "@/lib/http";
import { currentAthlete } from "@/lib/intake/athlete";
import { requireIntake, clearSessionCookie } from "@/lib/intake/session";
import { discardIntake } from "@/lib/intake/discard";

/**
 * Dit concept weggooien.
 *
 * De aanleiding is concreet: een atleet liep vast in het gesprek en kon er niet
 * uit. Dat was geen ongeluk maar het ontwerp: de assistent stopt pas als er
 * geen enkel gat meer open staat, een gat sluit alleen met een waarde, en "dat
 * weet ik niet" is geen waarde. Wie op zo'n vraag strandde had geen enkele
 * uitgang behalve de tab sluiten, en de volgende keer stond hetzelfde gesprek
 * er weer.
 *
 * Wat deze route WEL doet: een concept van de ingelogde atleet volledig wissen,
 * met gesprek, documenten en voorstellen. Het cookie gaat mee weg, want dat
 * wijst naar iets dat niet meer bestaat.
 *
 * Wat hij NIET doet: een ingediende of goedgekeurde intake aanraken. Die is
 * mogelijk al door een behandelaar gelezen, of is een vastgelegd document met
 * een rapportversie eronder. medical.discard_intake() weigert het, en deze
 * route vangt het daarvoor al af zodat de atleet een leesbare zin krijgt in
 * plaats van een databankfout.
 *
 * POST en geen DELETE, in lijn met de rest van deze API: elke mutatie hier is
 * een POST op een benoemde handeling. Een DELETE op /api/intake zou bovendien
 * suggereren dat er een resource in het pad staat, en die staat er niet: welke
 * intake het is, zegt het cookie.
 */
export async function POST() {
  try {
    const t = await apiMessages();

    // Twee poorten, en ze controleren verschillende dingen. requireIntake zegt
    // welke intake het cookie aanwijst en dat die bij de ingelogde gebruiker
    // hoort; currentAthlete levert het user-id voor het auditspoor. Zonder dat
    // tweede staat er 'athlete' in de log zonder wie.
    const session = await requireIntake();
    const athlete = await currentAthlete();

    if (session.status !== "draft") {
      return badRequest(t("discardOnlyDraft"));
    }

    const result = await discardIntake({
      intakeId: session.intakeId,
      actorId: athlete?.userId ?? null,
      actorKind: "athlete",
    });

    // Het cookie wijst naar een intake die er niet meer is. Laten staan zou de
    // volgende pagina een sessie geven die nergens op uitkomt.
    await clearSessionCookie();

    return NextResponse.json({
      discarded: result.discarded,
      counts: result.counts,
      filesRemoved: result.filesRemoved,
    });
  } catch (error) {
    return handleError(error);
  }
}
