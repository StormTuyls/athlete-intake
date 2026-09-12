import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handleError } from "@/lib/http";
import { logAudit } from "@/lib/audit";
import { requireCoach, type Coach } from "@/lib/review/access";
import { createPractitioner, updatePractitioner } from "@/lib/db/practitioners";

/**
 * Het team beheren. Alleen voor een admin.
 *
 * Niet elke behandelaar mag een collega aanmaken: dat is de handeling die
 * bepaalt wie er bij medische dossiers kan, en die hoort bij één rol te liggen.
 * `checkCoach()` laat coach en admin allebei door, dus die controle volstaat
 * hier niet en staat er expliciet naast.
 *
 * De eerste admin komt uit scripts/create-coach.ts. Een scherm dat zichzelf
 * bootstrapt zou betekenen dat de eerste bezoeker admin wordt, en dat is precies
 * het formulier dat niemand hoort te kunnen vinden.
 */
class NotAdminError extends Error {
  constructor() {
    super("admin required");
    this.name = "NotAdminError";
  }
}

async function requireAdmin(): Promise<Coach> {
  const coach = await requireCoach();
  if (coach.role !== "admin") throw new NotAdminError();
  return coach;
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Only an administrator can do this." }, { status: 403 });
}

const createSchema = z.object({
  email: z.string().trim().email().max(200),
  fullName: z.string().trim().min(1).max(120),
  kind: z.enum(["physio", "coach"]),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["physio", "coach"]).optional(),
  archived: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid input");
    }

    const result = await createPractitioner(parsed.data);
    if (!result.ok) return badRequest(result.error);

    await logAudit({
      action: "insert",
      actorKind: "admin",
      actorId: admin.id,
      entitySchema: "public",
      entityTable: "profiles",
      entityId: result.id,
      detail: { kind: parsed.data.kind },
    });

    // Het wachtwoord gaat één keer over de lijn en wordt nergens bewaard. De
    // admin geeft het door; daarna is de herstelmail de weg.
    return NextResponse.json({ id: result.id, password: result.password });
  } catch (caught) {
    if (caught instanceof NotAdminError) return forbidden();
    return handleError(caught);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid input");
    }

    await updatePractitioner(parsed.data);

    await logAudit({
      action: "update",
      actorKind: "admin",
      actorId: admin.id,
      entitySchema: "public",
      entityTable: "profiles",
      entityId: parsed.data.id,
      detail: {
        ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
        ...(parsed.data.archived !== undefined ? { archived: parsed.data.archived } : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (caught) {
    if (caught instanceof NotAdminError) return forbidden();
    return handleError(caught);
  }
}
