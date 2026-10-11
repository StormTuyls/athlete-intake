import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handleError } from "@/lib/http";
import { isUuid, requireCoach } from "@/lib/review/access";
import { getSession } from "@/lib/db/screening";
import { addNote, resolveNote } from "@/lib/db/screeningNotes";

export const maxDuration = 60;

/**
 * Opmerkingen en vlaggen op een screening. FR-13.
 *
 * Twee handelingen onder een route: schrijven en sluiten. Heropenen zit er niet
 * bij, met opzet; zie resolveNote().
 */

const add = z.object({
  action: z.literal("add"),
  metricKey: z.string().min(1).nullable(),
  severity: z.enum(["info", "watch", "action"]),
  body: z.string().trim().min(1).max(2000),
  note: z.string().max(500).nullable(),
});

const resolve = z.object({
  action: z.literal("resolve"),
  noteId: z.number().int().positive(),
});

const bodySchema = z.discriminatedUnion("action", [add, resolve]);

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    if (!isUuid(sessionId)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const coach = await requireCoach();
    const actor = {
      id: coach.id,
      name: coach.fullName,
      isAdmin: coach.role === "admin",
    };

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest("Expected a note.");
    const body = parsed.data;

    if (body.action === "resolve") {
      await resolveNote(body.noteId, actor);
      return NextResponse.json({ ok: true });
    }

    // De sessie moet bestaan voor we eraan schrijven, en we hebben het
    // athlete_id nodig: een opmerking hangt aan de atleet, zodat hij ook na het
    // verwijderen van een sessie meegaat in het verwijderpad.
    const session = await getSession(sessionId, { id: coach.id });
    if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });

    const id = await addNote(
      {
        sessionId,
        athleteId: session.athleteId,
        metricKey: body.metricKey,
        severity: body.severity,
        body: body.body,
        action: body.note,
      },
      actor,
    );

    return NextResponse.json({ ok: true, id });
  } catch (caught) {
    return handleError(caught);
  }
}
