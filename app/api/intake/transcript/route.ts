import { NextResponse } from "next/server";
import { requireIntake } from "@/lib/intake/session";
import { handleError } from "@/lib/http";
import { buildTranscript } from "@/lib/intake/transcript";
import { logAudit } from "@/lib/audit";

/**
 * Het hele gesprek in één request, voor als het scherm laadt of terugkomt.
 *
 * Los van /api/intake/state, dat de velden geeft. Dit geeft de berichten. Twee
 * routes voor twee vormen; ze samenvoegen zou het chatscherm de hele veldenlijst
 * laten binnenhalen die het niet gebruikt.
 *
 * Net als de state-route gaan er geen bronciteten mee naar de atleet, en om
 * dezelfde reden.
 */
export async function GET() {
  try {
    const session = await requireIntake();

    const payload = await buildTranscript(session.intakeId, session.locale, {
      status: session.status,
      consentGrantedAt: session.consentGrantedAt,
    });

    // Een gesprek teruglezen is een verwerking en hoort in het spoor.
    await logAudit({
      action: "read",
      actorKind: "athlete",
      entitySchema: "public",
      entityTable: "chat_messages",
      entityId: session.intakeId,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return handleError(error);
  }
}
