import { query, queryOne } from "@/lib/db/sql";
import type { PurgeCounts, PurgeManifest } from "@/lib/purge/db";

/**
 * De administratie van een verwijderopdracht.
 *
 * medical.purge_jobs bestond al vanaf de eerste migratie en werd nooit gebruikt.
 * Nu wel, en om een specifieke reden: een purge raakt vier systemen (Postgres,
 * Storage, de authserver en Notion) en die kunnen nooit in één transactie. Loopt
 * het halverwege stuk, dan moet er ergens staan hoe ver het kwam. Anders blijft
 * er een half verwijderde atleet achter en weet niemand welke helft.
 *
 * De tabel heeft met opzet geen foreign key naar athletes: de opdracht moet de
 * atleet overleven, anders verdwijnt het bewijs van de verwijdering samen met
 * wat er verwijderd werd.
 */

export type PurgePhase = "queued" | "planned" | "done" | "failed";

export type PurgeReason =
  | "coach_request"
  | "retention_due"
  | "pre_consent_expired";

export type PurgeStep = "plan" | "storage" | "notion" | "db" | "auth";

export interface PurgeJobResult {
  phase: PurgePhase;
  reason: PurgeReason;
  attempts: number;
  stepsDone: PurgeStep[];
  plan?: PurgeManifest;
  db?: PurgeCounts;
  storage?: { removed: number; verifiedEmpty: boolean };
  notion?: Record<string, unknown>;
  auth?: { userDeleted: boolean };
  errors?: Array<{ step: PurgeStep; at: string; message: string }>;
}

export interface PurgeJob {
  id: string;
  athleteId: string;
  requestedBy: string | null;
  requestedAt: string;
  completedAt: string | null;
  result: PurgeJobResult;
}

interface Row {
  id: string;
  athlete_id: string;
  requested_by: string | null;
  requested_at: Date;
  completed_at: Date | null;
  result: PurgeJobResult | null;
}

function toJob(row: Row): PurgeJob {
  return {
    id: String(row.id),
    athleteId: row.athlete_id,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    result: row.result ?? {
      phase: "queued",
      reason: "coach_request",
      attempts: 0,
      stepsDone: [],
    },
  };
}

/**
 * Een opdracht in de wachtrij zetten, of de bestaande teruggeven.
 *
 * Idempotent op de atleet: twee keer op de knop drukken hoort geen tweede purge
 * te starten. De partiele index purge_jobs_pending_idx dient deze opzoeking.
 */
export async function enqueuePurge(input: {
  athleteId: string;
  requestedBy?: string | null;
  reason: PurgeReason;
}): Promise<PurgeJob> {
  const open = await queryOne<Row>(
    `select id, athlete_id, requested_by, requested_at, completed_at, result
       from medical.purge_jobs
      where athlete_id = $1 and completed_at is null
      order by id
      limit 1`,
    [input.athleteId],
  );

  if (open) return toJob(open);

  const result: PurgeJobResult = {
    phase: "queued",
    reason: input.reason,
    attempts: 0,
    stepsDone: [],
  };

  const row = await queryOne<Row>(
    `insert into medical.purge_jobs (athlete_id, requested_by, result)
     values ($1, $2, $3::jsonb)
     returning id, athlete_id, requested_by, requested_at, completed_at, result`,
    [input.athleteId, input.requestedBy ?? null, JSON.stringify(result)],
  );

  if (!row) throw new Error("verwijderopdracht kon niet worden aangemaakt");
  return toJob(row);
}

/** Openstaande opdrachten, oudste eerst. */
export async function openJobs(limit = 5): Promise<PurgeJob[]> {
  const rows = await query<Row>(
    `select id, athlete_id, requested_by, requested_at, completed_at, result
       from medical.purge_jobs
      where completed_at is null
      order by requested_at, id
      limit $1`,
    [limit],
  );
  return rows.map(toJob);
}

export async function getJob(id: string): Promise<PurgeJob | null> {
  const row = await queryOne<Row>(
    `select id, athlete_id, requested_by, requested_at, completed_at, result
       from medical.purge_jobs where id = $1`,
    [id],
  );
  return row ? toJob(row) : null;
}

/**
 * De stand wegschrijven na elke stap.
 *
 * Na elke stap en niet aan het eind: dat is het hele nut van deze tabel. Valt de
 * function om na Storage maar voor de databank, dan moet daar staan dat de
 * bestanden weg zijn, anders zoekt een herstart ze opnieuw of slaat hij ze over.
 */
export async function saveJobResult(input: {
  id: string;
  result: PurgeJobResult;
  completed: boolean;
}): Promise<void> {
  await query(
    `update medical.purge_jobs
        set result = $2::jsonb,
            completed_at = case when $3 then now() else null end
      where id = $1`,
    [input.id, JSON.stringify(input.result), input.completed],
  );
}
