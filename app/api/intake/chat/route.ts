import { NextResponse } from "next/server";
import { appDb } from "@/lib/supabase/service";
import { requireIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { addProposals, syncDossier } from "@/lib/db/dossier";
import { runChatTurn, type ChatMessage } from "@/lib/claude/chatTurn";

export const maxDuration = 120;

/**
 * Eén beurt van het intakegesprek.
 *
 * De assistent vraagt alleen naar velden die volgens de volledigheidscontrole
 * ontbreken of tegenstrijdig zijn. Dat is het verschil met een formulier: de
 * atleet die zijn medische verslagen al geupload heeft, krijgt die vragen niet
 * meer. Daar zit de tijdswinst.
 *
 * Wat de atleet antwoordt wordt een voorstel met `proposedBy: 'athlete'` en zijn
 * eigen woorden als citaat. Dat verslaat een modelvoorstel uit een document,
 * maar niet een correctie van de coach.
 */
export async function POST(request: Request) {
  try {
    const session = await requireIntake();

    if (!session.consentGrantedAt) {
      return badRequest("geef eerst toestemming voor het verwerken van je gegevens");
    }

    const body = (await request.json().catch(() => ({}))) as { message?: string };
    const db = appDb();

    // Antwoord van de atleet eerst opslaan, dan pas het model erbij halen. Zo
    // is een klapper in de modelcall geen verloren antwoord.
    if (body.message?.trim()) {
      const { error } = await db.from("chat_messages").insert({
        intake_id: session.intakeId,
        role: "user",
        content: body.message.trim(),
      });
      if (error) throw new Error(`bericht opslaan mislukt: ${error.message}`);
    }

    const { data: history, error: historyError } = await db
      .from("chat_messages")
      .select("role, content")
      .eq("intake_id", session.intakeId)
      .order("id")
      // Een intake blijft kort; dit is een plafond, geen paginatie.
      .limit(60);

    if (historyError) {
      throw new Error(`gesprek lezen mislukt: ${historyError.message}`);
    }

    const state = await syncDossier(session.intakeId, session.locale);

    const turn = await runChatTurn({
      history: (history ?? []) as ChatMessage[],
      gaps: state.gaps,
      definitions: state.definitions,
      locale: session.locale,
    });

    if (turn.captured.length > 0) {
      await addProposals(
        session.intakeId,
        turn.captured.map((captured) => ({
          fieldKey: captured.fieldKey,
          value: captured.value,
          proposedBy: "athlete" as const,
          // Wat de atleet zei is zijn eigen woord; er valt niets te verifieren
          // tegen een brondocument, dus quote_verified blijft false en het veld
          // komt op 'medium' tot de coach het aftikt.
          sourceQuote: captured.quote,
        })),
      );
    }

    await db.from("chat_messages").insert({
      intake_id: session.intakeId,
      role: "assistant",
      content: turn.reply,
      about_field_key: turn.aboutFieldKey,
    });

    const after = await syncDossier(session.intakeId, session.locale);

    return NextResponse.json({
      reply: turn.reply,
      captured: turn.captured.map((c) => c.fieldKey),
      done: turn.done || after.gaps.length === 0,
      completeness: after.completeness,
      openGaps: after.gaps.length,
    });
  } catch (error) {
    return handleError(error);
  }
}
