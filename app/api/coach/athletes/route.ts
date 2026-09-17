import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handleError } from "@/lib/http";
import { logAudit } from "@/lib/audit";
import { requireCoach } from "@/lib/review/access";
import { inviteAthlete } from "@/lib/db/athleteInvites";

/**
 * Een atleet uitnodigen.
 *
 * requireCoach() en niet requireAdmin(), anders dan bij het team. Dat is geen
 * slordigheid maar het verschil tussen de twee handelingen: wie er bij medische
 * dossiers mag is een beslissing over de praktijk en hoort bij één rol, maar een
 * atleet uitnodigen is gewoon het werk. Een kinesist die daarvoor een beheerder
 * moet zoeken, zet zijn atleet niet klaar.
 *
 * De uitnodiger wordt meteen de behandelaar van deze atleet. Hij weet nu wie het
 * is, en de atleet kan het later op zijn profiel zelf wijzigen.
 */
const schema = z.object({
  email: z.string().trim().email().max(200),
  fullName: z.string().trim().min(1).max(120),
  locale: z.enum(["nl", "en"]).default("nl"),
});

export async function POST(request: Request) {
  try {
    const coach = await requireCoach();

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid input");
    }

    // De basis van de link. Uit de omgeving als die er staat, want achter een
    // proxy is de host van de aanvraag niet altijd het adres dat de atleet in
    // zijn mail hoort te zien.
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

    const result = await inviteAthlete({
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      locale: parsed.data.locale,
      practitionerId: coach.id,
      origin,
    });

    if (!result.ok) return badRequest(result.error);

    await logAudit({
      action: "insert",
      actorKind: coach.role === "admin" ? "admin" : "coach",
      actorId: coach.id,
      entitySchema: "public",
      entityTable: "athletes",
      entityId: result.invite.athleteId,
      // Het adres staat er bewust niet in. Het audit-log wordt breder gelezen
      // dan het dossier, en wie er is uitgenodigd staat al in public.athletes.
      detail: { invited: true, mailed: result.invite.mailed },
    });

    // De link gaat één keer over de lijn en wordt nergens bewaard, net als het
    // wachtwoord van een nieuwe behandelaar. Hij is kortlevend; wie hem mist,
    // vraagt op het inlogscherm een nieuwe aan.
    return NextResponse.json({
      athleteId: result.invite.athleteId,
      link: result.invite.link,
      mailed: result.invite.mailed,
    });
  } catch (caught) {
    return handleError(caught);
  }
}
