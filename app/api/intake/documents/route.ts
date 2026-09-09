import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { listDocuments } from "@/lib/db/medical";
import { requireEditableIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { registerDocument } from "@/lib/intake/processDocument";
import { logAudit } from "@/lib/audit";

/**
 * Tekst uit een PDF met veel pagina's halen duurt langer dan uit een pagina.
 * Wel korter dan vroeger: de modelcall zit hier niet meer in.
 */
export const maxDuration = 120;

/**
 * Een geupload bestand registreren.
 *
 * Registreren en niet verwerken. Er komt hier geen modelcall aan te pas en er
 * verschijnt geen enkel voorstel in het dossier; het bestand ligt klaar en de
 * atleet beslist daarna zelf of het gelezen wordt. Zie de uitleg boven
 * lib/intake/processDocument.ts, en POST .../[documentId]/read voor stap twee.
 */
export async function POST(request: Request) {
  try {
    const t = await apiMessages();
    const session = await requireEditableIntake();

    if (!session.consentGrantedAt) {
      return badRequest(t("consentFirst"));
    }

    const body = (await request.json()) as {
      path?: string;
      filename?: string;
      mimeType?: string;
    };

    if (!body.path || !body.filename || !body.mimeType) {
      return badRequest(t("pathRequired"));
    }

    // Het pad moet in de map van deze intake liggen. Anders zou een geldige
    // sessie het document van een andere atleet kunnen laten verwerken.
    if (!body.path.startsWith(`${session.intakeId}/`)) {
      return badRequest(t("notThisIntake"));
    }

    const result = await registerDocument({
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
    const session = await requireEditableIntake();

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
