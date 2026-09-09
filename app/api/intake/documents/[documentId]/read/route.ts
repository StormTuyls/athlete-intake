import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { requireEditableIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { readDocument } from "@/lib/intake/processDocument";
import { getProposals, syncDossier } from "@/lib/db/dossier";
import { intakeTitle } from "@/lib/db/intakeTitle";
import { isIntakeId } from "@/lib/review/access";
import {
  cardsForDocument,
  collectingFrom,
  computeProgress,
} from "@/lib/intake/transcript";

/** Een gescande PDF met veel pagina's door het model halen duurt. */
export const maxDuration = 300;

/**
 * Stap twee: dit document lezen.
 *
 * Een aparte route en geen vlag op de upload, omdat het een andere handeling
 * is. Uploaden legt een bestand neer; dit is het moment waarop de atleet zegt
 * dat het over deze klacht gaat en er waarden uit mogen volgen. Dat verschil
 * hoort in de URL te staan en niet in een boolean die iemand later per ongeluk
 * standaard op true zet.
 *
 * Synchroon, zoals de verwerking altijd al was: de atleet ziet direct wat eruit
 * gehaald is, en dat is precies het moment waarop hij een ontbrekend document
 * nog kan aanleveren. Bij grotere volumes hoort dit naar een wachtrij, maar dan
 * verliest de intake zijn directe terugkoppeling.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const t = await apiMessages();
    const session = await requireEditableIntake();
    const { documentId } = await context.params;

    if (!session.consentGrantedAt) {
      return badRequest(t("consentFirst"));
    }

    // Vormcontrole voor de query, zodat een misvormd pad een 400 geeft en geen
    // pg-fout die als 500 naar buiten komt. Of het document van deze intake is,
    // beslist readDocument: dat zit in de where-clausule.
    if (!isIntakeId(documentId)) {
      return badRequest(t("notThisIntake"));
    }

    const result = await readDocument({ intakeId: session.intakeId, documentId });

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
      title: await intakeTitle(session.intakeId),
      completeness: state.completeness,
      collecting: collectingFrom(state.gaps, session.locale),
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
