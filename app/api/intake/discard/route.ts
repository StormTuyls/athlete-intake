import { NextResponse } from "next/server";
import { z } from "zod";
import { apiMessages } from "@/lib/i18n/server";
import { badRequest, handleError } from "@/lib/http";
import { appDb } from "@/lib/supabase/service";
import { currentAthlete } from "@/lib/intake/athlete";
import { IntakeAuthError, clearSessionCookie, currentIntake } from "@/lib/intake/session";
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
 * een POST op een benoemde handeling.
 *
 * ---------------------------------------------------------------------------
 * Welke intake, en waarom niet het cookie
 * ---------------------------------------------------------------------------
 *
 * Dit liep eerst over requireIntake(), dus over het capability-cookie. Dat was
 * fout, en op een manier die precies de knop raakte die bedoeld is als uitgang:
 * het thuisscherm haalt de concepten uit de databank op `athlete_id`, maar het
 * cookie wordt alleen gezet door POST /api/intake. Wie vers inlogt, of op een
 * tweede toestel komt, of wiens cookie van dertig dagen verlopen is, ziet zijn
 * concept dus wel staan en kreeg bij het weggooien "je sessie is verlopen".
 *
 * De intake komt nu uit het verzoek en het eigendom uit de login, die sterker is
 * dan het cookie. Het cookie wordt nog wel gelezen, voor twee dingen: het mag de
 * intake aanwijzen als de client er geen noemt (de knop in het gesprek), en het
 * moet gewist worden als het naar precies deze intake wees.
 */

const BODY = z.object({ intakeId: z.string().uuid().optional() });

export async function POST(request: Request) {
  try {
    const t = await apiMessages();

    // De login is de poort. Niet het cookie: dat zegt hooguit welke intake
    // open stond, en hier is de vraag of deze gebruiker deze intake bezit.
    const athlete = await currentAthlete();
    if (!athlete) throw new IntakeAuthError();

    const parsed = BODY.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return badRequest(t("intakeNotFound"));

    const session = await currentIntake();
    const intakeId = parsed.data.intakeId ?? session?.intakeId;
    if (!intakeId) return badRequest(t("intakeNotFound"));

    // Eigendom en status uit de databank. Het filter op athlete_id is wat een
    // gekopieerd intake-id waardeloos maakt: een bestaande intake van iemand
    // anders geeft hier nul rijen, en dus dezelfde melding als een intake die
    // niet bestaat. Geen verschil, want het verschil zou verklappen dat hij
    // bestaat.
    const { data: intake } = await appDb()
      .from("intakes")
      .select("id, status")
      .eq("id", intakeId)
      .eq("athlete_id", athlete.athleteId)
      .maybeSingle();

    if (!intake) return badRequest(t("intakeNotFound"));

    if (intake.status !== "draft") {
      return badRequest(t("discardOnlyDraft"));
    }

    const result = await discardIntake({
      intakeId,
      actorId: athlete.userId,
      actorKind: "athlete",
    });

    // Alleen als het cookie naar DEZE intake wees. Altijd wissen zou betekenen
    // dat het weggooien van een oud concept de atleet uit het gesprek gooit dat
    // hij op dat moment open heeft staan.
    if (session?.intakeId === intakeId) {
      await clearSessionCookie();
    }

    return NextResponse.json({
      discarded: result.discarded,
      counts: result.counts,
      filesRemoved: result.filesRemoved,
    });
  } catch (error) {
    return handleError(error);
  }
}
