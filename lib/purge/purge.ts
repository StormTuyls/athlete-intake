import { appDb } from "@/lib/supabase/service";
import { purgeAthleteRows } from "@/lib/purge/db";
import { purgeStorage } from "@/lib/purge/storage";
import { purgeNotion, notionErrorIsHarmless } from "@/lib/purge/notion";
import { purgeAuthUser } from "@/lib/purge/auth";
import {
  getJob,
  openJobs,
  saveJobResult,
  type PurgeJob,
  type PurgeJobResult,
  type PurgeStep,
} from "@/lib/purge/jobs";
import type { PurgeManifest } from "@/lib/purge/db";

/**
 * Een atleet verwijderen, over vier systemen.
 *
 * De volgorde is plan -> storage -> notion -> databank -> inlogaccount, en elke
 * stap staat daar om een reden:
 *
 * 1. Het plan eerst, en het wordt nooit opnieuw berekend. Na de databankstap
 *    bestaan de rijen die de storage-paden en het profiel-id beschrijven niet
 *    meer, dus wie dat pas later ophaalt kan een herstart niet afmaken.
 * 2. Storage en Notion voor de databank. Als een van die twee mislukt, breekt
 *    de purge af terwijl de atleet nog intact is. De andere ordening zou een
 *    naam, een e-mailadres en mogelijk een klinische samenvatting laten staan op
 *    een Notion-kaart van iemand die lokaal niet meer bestaat: onvindbaar, en
 *    precies het soort restant waar dit pad tegen bestaat.
 * 3. Notion voor de databank ook omdat de kaart de enige rest is die een mens
 *    kan lezen.
 * 4. Het inlogaccount als laatste, want het manifest heeft het profiel-id nodig
 *    en `athletes.profile_id` wordt bij de delete op null gezet.
 *
 * Elke stap is los idempotent, dus een herstart slaat over wat al af is:
 * `remove` op een verdwenen bestand is geen fout, een gearchiveerde Notion-pagina
 * komt niet meer uit een query, medical.purge_athlete geeft nullen voor een
 * atleet die er niet is, en deleteUser op een verwijderde gebruiker ook.
 */

const MAX_ATTEMPTS = 5;

function done(result: PurgeJobResult, step: PurgeStep): boolean {
  return result.stepsDone.includes(step);
}

function record(result: PurgeJobResult, step: PurgeStep): void {
  if (!result.stepsDone.includes(step)) result.stepsDone.push(step);
}

function noteError(result: PurgeJobResult, step: PurgeStep, error: unknown): void {
  const errors = result.errors ?? [];
  errors.push({
    step,
    at: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
  });
  // Nooit inkorten: een purge die drie pogingen nodig had hoort dat te zeggen.
  result.errors = errors;
}

/** Wat er te verwijderen valt, uit de administratie die er nu nog is. */
async function makePlan(athleteId: string): Promise<PurgeManifest> {
  const { data: intakes, error } = await appDb()
    .from("intakes")
    .select("id")
    .eq("athlete_id", athleteId);

  if (error) throw new Error(`intakes opvragen mislukt: ${error.message}`);

  const { data: athlete } = await appDb()
    .from("athletes")
    .select("profile_id")
    .eq("id", athleteId)
    .maybeSingle();

  return {
    athlete_id: athleteId,
    profile_id: (athlete?.profile_id as string | null) ?? null,
    intake_ids: (intakes ?? []).map((row) => row.id as string),
    document_ids: [],
    test_session_ids: [],
    storage_paths: [],
  };
}

export async function runPurgeJob(jobId: string): Promise<PurgeJob> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`verwijderopdracht ${jobId} bestaat niet`);
  if (job.completedAt) return job;

  const result = job.result;
  result.attempts += 1;

  try {
    // 1. Plan
    if (!done(result, "plan")) {
      result.plan = await makePlan(job.athleteId);
      result.phase = "planned";
      record(result, "plan");
      await saveJobResult({ id: job.id, result, completed: false });
    }

    const plan = result.plan;
    if (!plan) throw new Error("geen plan, maar de stap staat als afgerond");

    // 2. Storage. Vóór de databank, want daarna is `documents.storage_path` weg.
    if (!done(result, "storage")) {
      const cleaned = await purgeStorage({
        intakeIds: plan.intake_ids,
        knownPaths: plan.storage_paths,
      });
      if (!cleaned.verifiedEmpty) {
        throw new Error("na het opruimen liggen er nog bestanden onder de intake-prefix");
      }
      result.storage = cleaned;
      record(result, "storage");
      await saveJobResult({ id: job.id, result, completed: false });
    }

    // 3. Notion
    if (!done(result, "notion")) {
      try {
        result.notion = { ...(await purgeNotion({ intakeIds: plan.intake_ids })) };
      } catch (error) {
        if (!notionErrorIsHarmless(error)) throw error;
        result.notion = { skipped: false, note: "pagina bestond niet meer" };
      }
      record(result, "notion");
      await saveJobResult({ id: job.id, result, completed: false });
    }

    // 4. Databank. Eén transactie, en het manifest wordt hier compleet: de
    //    functie geeft de storage-paden en het profiel-id terug zoals ze op dat
    //    moment waren.
    if (!done(result, "db")) {
      const purged = await purgeAthleteRows({
        athleteId: job.athleteId,
        actorId: job.requestedBy,
        actorKind: job.requestedBy ? "coach" : "system",
      });
      result.db = purged.counts;
      // Het manifest uit de functie is rijker dan het plan: documenten en
      // testsessies stonden alleen in het medical-schema.
      result.plan = { ...plan, ...purged.manifest };
      record(result, "db");
      await saveJobResult({ id: job.id, result, completed: false });

      // De functie kende paden die het plan nog niet had, dus nog een ronde
      // langs Storage. Zonder dit blijft een bestand staan waarvan alleen
      // medical.documents wist.
      const extra = purged.manifest.storage_paths.filter(
        (path) => !plan.storage_paths.includes(path),
      );
      if (extra.length > 0) {
        const cleaned = await purgeStorage({
          intakeIds: purged.manifest.intake_ids,
          knownPaths: extra,
        });
        result.storage = {
          removed: (result.storage?.removed ?? 0) + cleaned.removed,
          verifiedEmpty: cleaned.verifiedEmpty,
        };
        await saveJobResult({ id: job.id, result, completed: false });
      }
    }

    // 5. Inlogaccount
    if (!done(result, "auth")) {
      result.auth = await purgeAuthUser(result.plan?.profile_id ?? null);
      record(result, "auth");
    }

    result.phase = "done";
    await saveJobResult({ id: job.id, result, completed: true });
  } catch (error) {
    noteError(result, (result.stepsDone.at(-1) ?? "plan") as PurgeStep, error);
    result.phase = "failed";
    // completed_at blijft leeg, dus de drainer pakt hem opnieuw op. Boven de
    // limiet niet meer, anders levert een kapot Notion-token elke dag een
    // nieuwe poging en een nieuwe foutregel op; dan blijft hij zichtbaar staan
    // als failed met een hoog aantal pogingen.
    await saveJobResult({ id: job.id, result, completed: false });

    if (result.attempts >= MAX_ATTEMPTS) {
      throw new Error(
        `verwijderopdracht ${job.id} is na ${result.attempts} pogingen niet afgerond: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    throw error;
  }

  return (await getJob(job.id)) ?? job;
}

/** Openstaande opdrachten afwerken. Geeft terug wat er gelukt is en wat niet. */
export async function drainPurgeJobs(limit = 5): Promise<{
  completed: number;
  failed: number;
}> {
  const jobs = await openJobs(limit);

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    if (job.result.attempts >= MAX_ATTEMPTS) {
      failed += 1;
      continue;
    }
    try {
      await runPurgeJob(job.id);
      completed += 1;
    } catch {
      // De fout staat al in purge_jobs.result.errors; hier alleen tellen, zodat
      // één vastgelopen atleet de rest van de rij niet blokkeert.
      failed += 1;
    }
  }

  return { completed, failed };
}
