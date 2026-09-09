import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { handleError } from "@/lib/http";
import { isUuid, requireCoach } from "@/lib/review/access";
import { appDb } from "@/lib/supabase/service";
import { enqueuePurge } from "@/lib/purge/jobs";
import { runPurgeJob } from "@/lib/purge/purge";

// Een purge doet tientallen HTTP-aanroepen naar Storage, Notion en de
// authserver. Dat past niet in de standaardlimiet.
export const maxDuration = 300;

/**
 * Een atleet verwijderen, op verzoek.
 *
 * Neemt een athleteId en geen intakeId, en dat is opzettelijk hard: wissen is
 * een handeling op een persoon. Zou dit endpoint een intake aannemen en daaruit
 * de atleet opzoeken, dan leest de aanroep als "verwijder deze intake" terwijl
 * hij het hele dossier wist. Wie het aanroept moet zeggen wat hij bedoelt.
 *
 * De opdracht wordt eerst vastgelegd en dan meteen uitgevoerd. Vastleggen eerst,
 * want als de function halverwege omvalt moet er staan hoe ver het kwam;
 * uitvoeren in dezelfde aanroep, want de coach die op de knop drukt hoort te
 * horen wat er gebeurd is en niet "we gaan het proberen".
 *
 * Er is geen ondo. Dat staat ook in de interface.
 */
export async function POST(request: Request) {
  try {
    const t = await apiMessages();
    const coach = await requireCoach();

    const body = (await request.json().catch(() => ({}))) as {
      athleteId?: string;
      confirmName?: string;
    };

    if (!body.athleteId || !isUuid(body.athleteId)) {
      return NextResponse.json({ error: t("athleteNotFound") }, { status: 404 });
    }

    const { data: athlete } = await appDb()
      .from("athletes")
      .select("id, full_name")
      .eq("id", body.athleteId)
      .maybeSingle();

    if (!athlete) {
      return NextResponse.json({ error: t("athleteNotFound") }, { status: 404 });
    }

    // De tweede sleutel, en de server controleert hem ook. Zou alleen de
    // interface dat doen, dan is een verkeerd gerichte fetch genoeg om de
    // verkeerde atleet te wissen.
    const expected = (athlete.full_name as string | null)?.trim();
    if (expected) {
      if ((body.confirmName ?? "").trim().toLowerCase() !== expected.toLowerCase()) {
        return NextResponse.json(
          { error: t("nameMismatch") },
          { status: 400 },
        );
      }
    }

    const job = await enqueuePurge({
      athleteId: body.athleteId,
      requestedBy: coach.id,
      reason: "coach_request",
    });

    const finished = await runPurgeJob(job.id);

    return NextResponse.json({
      jobId: finished.id,
      phase: finished.result.phase,
      counts: finished.result.db ?? null,
      storage: finished.result.storage ?? null,
      notion: finished.result.notion ?? null,
      account: finished.result.auth ?? null,
    });
  } catch (error) {
    return handleError(error);
  }
}
