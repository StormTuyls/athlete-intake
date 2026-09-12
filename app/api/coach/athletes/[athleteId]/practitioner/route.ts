import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handleError } from "@/lib/http";
import { apiMessages } from "@/lib/i18n/server";
import { logAudit } from "@/lib/audit";
import { isUuid, requireCoach } from "@/lib/review/access";
import { setAthletePractitioner } from "@/lib/db/practitioners";

const bodySchema = z.object({
  practitionerId: z.union([z.string().uuid(), z.literal(""), z.null()]),
});

/**
 * De praktijk corrigeert bij wie een atleet hoort.
 *
 * Hetzelfde veld dat de atleet op zijn eigen profiel zet. Eén kolom met één
 * antwoord, en het audit-log zegt wie het voor het laatst veranderde: dat is
 * waarom hier `actorKind: "coach"` staat en op het atleetpad `"athlete"`.
 * Zonder dat onderscheid is "wie heeft dit toegewezen" niet te beantwoorden.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ athleteId: string }> },
) {
  try {
    const t = await apiMessages();
    const { athleteId } = await context.params;
    const coach = await requireCoach();

    if (!isUuid(athleteId)) {
      return NextResponse.json({ error: t("athleteNotFound") }, { status: 404 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest("Expected a practitioner id or null.");

    const practitionerId = parsed.data.practitionerId || null;
    const result = await setAthletePractitioner({ athleteId, practitionerId });
    if (!result.ok) return badRequest(result.error ?? "unknown practitioner");

    await logAudit({
      action: "update",
      actorKind: coach.role === "admin" ? "admin" : "coach",
      actorId: coach.id,
      entitySchema: "public",
      entityTable: "athletes",
      entityId: athleteId,
      detail: { fields: "practitioner" },
    });

    return NextResponse.json({ ok: true });
  } catch (caught) {
    return handleError(caught);
  }
}
