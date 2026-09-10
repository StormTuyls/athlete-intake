import { NextResponse } from "next/server";
import { badRequest, handleError } from "@/lib/http";
import { apiMessages } from "@/lib/i18n/server";
import { logAudit } from "@/lib/audit";
import { currentAthlete } from "@/lib/intake/athlete";
import { listPractitioners, parseProfileInput, saveProfile } from "@/lib/intake/profile";

/**
 * De atleet werkt zijn eigen profiel bij.
 *
 * De sessie is de enige input die telt over wie dit is. Het atleet-id komt uit
 * `currentAthlete()` en dus uit een gevalideerd token; de body zegt alleen wat
 * er in de velden moet komen. Een body met een vreemd `athleteId` erin bestaat
 * niet, want er wordt niet naar gekeken.
 *
 * De gekozen behandelaar wordt gecontroleerd tegen dezelfde lijst die het
 * scherm opbouwt. Dat is het sluitstuk op de kolom: de databank kan er geen
 * foreign key op een gefilterde verzameling zetten, dus als het hier niet
 * gebeurt, gebeurt het nergens.
 *
 * Er hangt geen audit-trigger aan `public.athletes` (zie
 * 20260902090400_audit.sql, die dekt intakes, consents en het medische schema).
 * Vandaar een expliciete regel, zonder waarden in het detail: een spoor dat de
 * gegevens nog eens dupliceert vergroot het probleem dat het moet oplossen.
 */
export async function POST(request: Request) {
  try {
    const athlete = await currentAthlete();
    if (!athlete) {
      const t = await apiMessages();
      return NextResponse.json({ error: t("signIn") }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return badRequest("Expected a JSON body.");
    }

    const practitioners = await listPractitioners();
    const parsed = parseProfileInput(
      body,
      new Set(practitioners.map((practitioner) => practitioner.id)),
    );
    if (!parsed.ok) return badRequest(parsed.error);

    await saveProfile({
      athleteId: athlete.athleteId,
      userId: athlete.userId,
      values: parsed.values,
    });

    await logAudit({
      action: "update",
      actorKind: "athlete",
      actorId: athlete.userId,
      entitySchema: "public",
      entityTable: "athletes",
      entityId: athlete.athleteId,
      detail: { fields: "profile" },
    });

    return NextResponse.json({ ok: true });
  } catch (caught) {
    return handleError(caught);
  }
}
