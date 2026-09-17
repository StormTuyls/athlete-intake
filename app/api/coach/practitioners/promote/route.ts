import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handleError } from "@/lib/http";
import { logAudit } from "@/lib/audit";
import { requireCoach } from "@/lib/review/access";
import { promoteToPractitioner } from "@/lib/db/practitioners";

/**
 * Een bestaand account stafrechten geven.
 *
 * Een eigen route en geen vlag op POST /practitioners. Die maakt iemand aan die
 * er nog niet was; deze raakt een account dat al bestaat en dat van iemand
 * anders kan zijn dan de admin denkt. Twee handelingen met een ander risico
 * horen niet achter dezelfde knop te zitten, ook niet als het formulier hetzelfde
 * is.
 *
 * Waarom dit überhaupt bestaat: een kinesist die zelf bij deze praktijk in
 * behandeling is, heeft al een account als atleet. Dat hoorde hem geen collega te
 * beletten te worden, maar het aanmaakformulier liep vast op een adres dat al in
 * auth.users stond. Atleet-zijn zit in public.athletes en niet in de rol, dus de
 * twee kunnen naast elkaar bestaan; alleen was er geen weg om het te zeggen.
 */
class NotAdminError extends Error {
  constructor() {
    super("admin required");
    this.name = "NotAdminError";
  }
}

const schema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["physio", "coach"]),
  role: z.enum(["coach", "admin"]).default("coach"),
});

export async function POST(request: Request) {
  try {
    const admin = await requireCoach();
    if (admin.role !== "admin") throw new NotAdminError();

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid input");
    }

    const result = await promoteToPractitioner(parsed.data);
    if (!result.ok) return badRequest(result.error ?? "could not save");

    // Een eigen actie in het log, en niet 'update'. Wie hier later naar kijkt
    // hoort te zien dat een bestaand account rechten kreeg, niet dat er een
    // vakgebied is bijgewerkt.
    await logAudit({
      action: "update",
      actorKind: "admin",
      actorId: admin.id,
      entitySchema: "public",
      entityTable: "profiles",
      entityId: parsed.data.id,
      detail: { promoted: true, kind: parsed.data.kind, role: parsed.data.role },
    });

    return NextResponse.json({ ok: true });
  } catch (caught) {
    if (caught instanceof NotAdminError) {
      return NextResponse.json(
        { error: "Only an administrator can do this." },
        { status: 403 },
      );
    }
    return handleError(caught);
  }
}
