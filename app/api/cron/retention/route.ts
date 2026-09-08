import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { appDb } from "@/lib/supabase/service";
import { enqueuePurge, type PurgeReason } from "@/lib/purge/jobs";
import { drainPurgeJobs } from "@/lib/purge/purge";
import { preConsentUntil } from "@/lib/intake/retention";

export const maxDuration = 300;

/**
 * De retentiejob.
 *
 * `athletes.retention_until` bestond met een constraint en zelfs een eigen
 * index, en niets las hem ooit. Een bewaartermijn die niemand afdwingt is een
 * mededeling in een consenttekst, niet een eigenschap van het systeem.
 *
 * Deze route zet opdrachten in de wachtrij en werkt er daarna een paar af. Niet
 * alles in één keer, en niet inline verwijderen: een purge doet tientallen
 * HTTP-aanroepen naar Storage, Notion en de authserver, en als de function
 * halverwege afgekapt wordt moet er in medical.purge_jobs staan hoe ver het
 * kwam. Wat overblijft gaat morgen mee, of eerder als iemand de route opnieuw
 * aanroept.
 *
 * De autorisatie staat hier en niet in proxy.ts. Dat bestand zegt zelf dat het
 * niet autoriseert, en een cron-route die op een matcher-configuratie vertrouwt
 * is één regel verplaatsing van een open verwijderendpoint af.
 */

/** Twee redenen, en het onderscheid hoort in het spoor. */
interface Due {
  athleteId: string;
  reason: PurgeReason;
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  // Faalt dicht. Vercel stuurt de Authorization-header alleen als de variabele
  // bestaat, dus "niet geconfigureerd" en "geen header meegestuurd" zijn aan
  // deze kant niet te onderscheiden. Zou een leeg secret alles doorlaten, dan
  // is een vergeten omgevingsvariabele een open verwijderendpoint.
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  // Even lang maken, want timingSafeEqual gooit bij verschillende lengtes en
  // dat verschil is zelf al informatie.
  const a = Buffer.from(header.padEnd(expected.length).slice(0, expected.length));
  const b = Buffer.from(expected);
  return timingSafeEqual(a, b) && header.length === expected.length;
}

/**
 * Wie er vandaag aan de beurt is.
 *
 * Twee groepen, met opzet apart benoemd. Een verstreken bewaartermijn is
 * rechtmatig verwijderen; een aanmelding die nooit afgerond werd is opruimen van
 * een halve registratie. Wie later purge_jobs leest moet dat verschil kunnen
 * zien, want het eerste is beleid en het tweede is een gebrek.
 */
async function due(): Promise<Due[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await appDb()
    .from("athletes")
    .select("id, retention_until, retention_mode, consents(id)")
    .eq("retention_mode", "until_date")
    .lt("retention_until", today)
    .is("deleted_at", null);

  if (error) throw new Error(`vervallen dossiers opvragen mislukt: ${error.message}`);

  // Zonder toestemming op accountniveau is de termijn de voorlopige van 30
  // dagen uit lib/intake/retention.ts, en dan is dit een gestrande aanmelding.
  const cutoff = preConsentUntil();

  return (data ?? []).map((row) => {
    const consents = (row.consents ?? []) as unknown[];
    const preConsent = consents.length === 0 && String(row.retention_until) <= cutoff;
    return {
      athleteId: row.id as string,
      reason: (preConsent ? "pre_consent_expired" : "retention_due") as PurgeReason,
    };
  });
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: process.env.CRON_SECRET ? "niet toegestaan" : "cron niet geconfigureerd" },
      { status: process.env.CRON_SECRET ? 401 : 503 },
    );
  }

  const items = await due();

  for (const item of items) {
    await enqueuePurge({ athleteId: item.athleteId, reason: item.reason });
  }

  const drained = await drainPurgeJobs(5);

  return NextResponse.json({
    due: items.length,
    reasons: items.reduce<Record<string, number>>((tally, item) => {
      tally[item.reason] = (tally[item.reason] ?? 0) + 1;
      return tally;
    }, {}),
    ...drained,
  });
}
