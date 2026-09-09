import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { appDb } from "@/lib/supabase/service";
import { requireEditableIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { addProposals, getProposals, syncDossier } from "@/lib/db/dossier";
import { carriedValues } from "@/lib/intake/carryForward";
import { runChatTurn, type ChatMessage } from "@/lib/claude/chatTurn";
import {
  buildCard,
  collectingFrom,
  computeProgress,
  winnerIsModel,
} from "@/lib/intake/transcript";
import type { CaptureCard } from "@/lib/intake/transcriptTypes";

export const maxDuration = 120;

/**
 * Toestemming is geen gespreksonderwerp.
 *
 * De `consent.*`-velden zijn een spiegel van public.consents, en dat is het
 * juridische register: versie van de tekst, tijdstip, IP, user agent. Dat wordt
 * alleen op het toestemmingsscherm geschreven.
 *
 * Zonder deze filter kan de assistent ernaar vragen (ze staan als openstaande
 * velden in de gatenlijst) en het antwoord als dossierveld wegschrijven. Dat is
 * niet theoretisch: lib/notion/sync.ts poort de medische samenvatting op de
 * waarde van `consent.share_with_practitioners`. Een "ja hoor, stuur maar naar
 * mijn kinesist" in een chatbericht zou dus een klinische samenvatting naar een
 * werkomgeving van een derde openen, terwijl er geen consentregistratie bestaat
 * die zegt dat de atleet dat ooit heeft afgesproken.
 *
 * Toestemming vraag je met een vinkje en een versienummer, niet in een gesprek.
 */
function isConsentField(fieldKey: string): boolean {
  return fieldKey.startsWith("consent.");
}

/**
 * Aanleidingen voor een beurt waarin de atleet niets getypt heeft.
 *
 * Een vaste lijst, geen vrije tekst uit de body: dit wordt als user-bericht aan
 * het model gegeven, en een client die daar zelf tekst in mag zetten schrijft de
 * prompt mee. De tekst wordt nooit opgeslagen in chat_messages.
 */
const NUDGES = {
  document_uploaded:
    "Ik heb net een document geupload. Bevestig kort wat je eruit hebt gehaald en stel dan de volgende openstaande vraag.",
} as const;

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
    const t = await apiMessages();
    const session = await requireEditableIntake();

    if (!session.consentGrantedAt) {
      return badRequest(t("consentFirst"));
    }

    const body = (await request.json().catch(() => ({}))) as {
      message?: string;
      nudge?: keyof typeof NUDGES;
    };
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

    // Wat deze atleet bij een eerdere intake al gaf. Alleen om te laten
    // bevestigen; er staat niets van in het dossier tot hij dat doet.
    const carried = await carriedValues({
      athleteId: session.athleteId,
      intakeId: session.intakeId,
      locale: session.locale,
    });

    const turn = await runChatTurn({
      history: (history ?? []) as ChatMessage[],
      gaps: state.gaps.filter((gap) => !isConsentField(gap.fieldKey)),
      definitions: state.definitions,
      locale: session.locale,
      // Alleen wat in DIT dossier nog open staat: een veld dat de atleet deze
      // keer al beantwoord heeft hoeft niet nog eens bevestigd te worden.
      carried: carried.filter((item) =>
        state.gaps.some((gap) => gap.fieldKey === item.fieldKey),
      ),
      nudge: body.nudge ? NUDGES[body.nudge] : undefined,
    });

    // Tweede slot op hetzelfde: ook als het model een consentveld zou teruggeven
    // omdat de atleet er zelf over begint, wordt het niet weggeschreven.
    const captured = turn.captured.filter((item) => !isConsentField(item.fieldKey));

    if (captured.length > 0) {
      await addProposals(
        session.intakeId,
        captured.map((item) => ({
          fieldKey: item.fieldKey,
          value: item.value,
          proposedBy: "athlete" as const,
          // Wat de atleet zei is zijn eigen woord; er valt niets te verifieren
          // tegen een brondocument, dus quote_verified blijft false en het veld
          // komt op 'medium' tot de coach het aftikt.
          sourceQuote: item.quote,
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

    // Het scherm toont per opgepikt veld een kaart met label, waarde en
    // betrouwbaarheid. Alleen de sleutels teruggeven zou de client dwingen om
    // daarna alsnog de hele veldenlijst op te halen.
    //
    // De kaarten worden met dezelfde functies gebouwd als in de transcriptie,
    // want de client plakt beide in één lijst. Twee bouwers zouden vroeg of laat
    // twee verschillende waarheden opleveren voor hetzelfde veld.
    const proposalById = new Map((await getProposals(session.intakeId)).map((p) => [p.id, p]));
    const definitionByKey = new Map(after.definitions.map((d) => [d.key, d]));

    const cards: CaptureCard[] = [];
    for (const item of captured) {
      const definition = definitionByKey.get(item.fieldKey);
      if (!definition) continue;
      const resolved = after.resolved.get(item.fieldKey);
      cards.push(
        buildCard(definition, resolved, winnerIsModel(resolved, proposalById), session.locale),
      );
    }

    return NextResponse.json({
      reply: turn.reply,
      captured: cards,
      collecting: collectingFrom(after.gaps, session.locale),
      progress: computeProgress(
        after.definitions,
        after.gaps,
        after.completeness.requiredFilled,
        after.completeness.requiredTotal,
      ),
      done: turn.done || after.gaps.length === 0,
      completeness: after.completeness,
      openGaps: after.gaps.length,
    });
  } catch (error) {
    return handleError(error);
  }
}
