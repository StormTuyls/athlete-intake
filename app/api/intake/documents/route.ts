import { NextResponse } from "next/server";
import { listDocuments } from "@/lib/db/medical";
import { requireIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { processDocument } from "@/lib/intake/processDocument";
import { logAudit } from "@/lib/audit";

/** Verwerking van een gescande PDF met veel pagina's duurt langer dan een pagina. */
export const maxDuration = 300;

/**
 * Een geupload bestand registreren en verwerken.
 *
 * Verwerking gebeurt synchroon: de atleet ziet direct wat eruit gehaald is, en
 * dat is precies het moment waarop hij een ontbrekend document nog kan
 * aanleveren. Bij grotere volumes hoort dit naar een wachtrij, maar dan verliest
 * de intake zijn directe terugkoppeling.
 */
export async function POST(request: Request) {
  try {
    const session = await requireIntake();

    if (!session.consentGrantedAt) {
      return badRequest("geef eerst toestemming voor het verwerken van je gegevens");
    }

    const body = (await request.json()) as {
      path?: string;
      filename?: string;
      mimeType?: string;
    };

    if (!body.path || !body.filename || !body.mimeType) {
      return badRequest("path, filename en mimeType zijn verplicht");
    }

    // Het pad moet in de map van deze intake liggen. Anders zou een geldige
    // sessie het document van een andere atleet kunnen laten verwerken.
    if (!body.path.startsWith(`${session.intakeId}/`)) {
      return badRequest("pad hoort niet bij deze intake");
    }

    const result = await processDocument({
      intakeId: session.intakeId,
      storagePath: body.path,
      originalFilename: body.filename,
      mimeType: body.mimeType,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleError(error);
  }
}

export async function GET() {
  try {
    const session = await requireIntake();

    const documents = await listDocuments(session.intakeId);

    await logAudit({
      action: "read",
      actorKind: "athlete",
      entitySchema: "medical",
      entityTable: "documents",
      entityId: session.intakeId,
      detail: { count: documents.length },
    });

    return NextResponse.json({ documents });
  } catch (error) {
    return handleError(error);
  }
}
