import { NextResponse } from "next/server";
import { listDocuments } from "@/lib/db/medical";
import { requireIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { processDocument } from "@/lib/intake/processDocument";
import { getProposals, syncDossier } from "@/lib/db/dossier";
import {
  cardsForDocument,
  collectingFrom,
  computeProgress,
} from "@/lib/intake/transcript";
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
      return badRequest("Please give consent before we process your data.");
    }

    const body = (await request.json()) as {
      path?: string;
      filename?: string;
      mimeType?: string;
    };

    if (!body.path || !body.filename || !body.mimeType) {
      return badRequest("A path, filename and file type are required.");
    }

    // Het pad moet in de map van deze intake liggen. Anders zou een geldige
    // sessie het document van een andere atleet kunnen laten verwerken.
    if (!body.path.startsWith(`${session.intakeId}/`)) {
      return badRequest("That file does not belong to this intake.");
    }

    const result = await processDocument({
      intakeId: session.intakeId,
      storagePath: body.path,
      originalFilename: body.filename,
      mimeType: body.mimeType,
    });

    // Het gesprek toont het resultaat meteen als kaarten. Die hier meegeven
    // scheelt een tweede ronde, en belangrijker: ze komen uit dezelfde bouwer
    // als de transcriptie, dus wat de atleet nu ziet is wat hij na een reload
    // opnieuw ziet.
    const state = await syncDossier(session.intakeId, session.locale);
    const proposals = await getProposals(session.intakeId);

    const extraction = cardsForDocument(
      result.documentId,
      proposals,
      new Map(state.definitions.map((d) => [d.key, d])),
      state.resolved,
      new Map(proposals.map((p) => [p.id, p])),
      session.locale,
    );

    return NextResponse.json({
      ...result,
      cards: extraction.cards,
      completeness: state.completeness,
      collecting: collectingFrom(state.gaps),
      progress: computeProgress(
        state.definitions,
        state.gaps,
        state.completeness.requiredFilled,
        state.completeness.requiredTotal,
      ),
    });
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
