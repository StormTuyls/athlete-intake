import { logAudit } from "@/lib/audit";
import { query, queryOne } from "@/lib/db/sql";

/**
 * Opmerkingen en vlaggen van de staf. FR-13, spec §4.
 *
 * Spec §14 is de reden dat dit bestaat en niet een alarmregel: "The system
 * should not create an alarm for every red cell." Wat opvolging vraagt bepaalt
 * de behandelaar, niet een drempel. Een vlag blijft open tot iemand hem sluit.
 *
 * De auteursnaam staat op de rij en wordt niet uit profiles gejoind; zie de
 * kolomopmerking in 20261011100000.
 */

export type NoteSeverity = "info" | "watch" | "action";

export interface ScreeningNote {
  id: number;
  metricKey: string | null;
  severity: NoteSeverity;
  state: "open" | "resolved";
  body: string;
  action: string | null;
  authorName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export async function listNotes(sessionId: string): Promise<ScreeningNote[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, metric_key, severity, state, body, action, author_name,
            created_at, resolved_at
       from medical.screening_notes
      where session_id = $1
      order by state, severity desc, created_at`,
    [sessionId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    metricKey: (row.metric_key as string | null) ?? null,
    severity: row.severity as NoteSeverity,
    state: row.state as "open" | "resolved",
    body: row.body as string,
    action: (row.action as string | null) ?? null,
    authorName: (row.author_name as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    resolvedAt: row.resolved_at ? (row.resolved_at as Date).toISOString() : null,
  }));
}

export async function addNote(
  input: {
    sessionId: string;
    athleteId: string;
    metricKey: string | null;
    severity: NoteSeverity;
    body: string;
    action: string | null;
  },
  actor: { id: string | null; name: string | null; isAdmin: boolean },
): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `insert into medical.screening_notes
       (athlete_id, session_id, metric_key, severity, body, action,
        author_profile_id, author_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [input.athleteId, input.sessionId, input.metricKey, input.severity,
     input.body, input.action, actor.id, actor.name],
  );
  if (!row) throw new Error("opmerking kon niet worden opgeslagen");

  await logAudit({
    actorId: actor.id,
    actorKind: actor.isAdmin ? "admin" : "coach",
    action: "insert",
    entitySchema: "medical",
    entityTable: "screening_notes",
    entityId: String(row.id),
    detail: { severity: input.severity, metricKey: input.metricKey },
  });
  return Number(row.id);
}

/**
 * Een vlag sluiten.
 *
 * De check screening_notes_resolution_complete eist dat state, resolved_at en
 * resolved_by samen kloppen, dus ze gaan in een statement. Heropenen kan niet:
 * een gesloten vlag die weer open kan is geen spoor maar een schakelaar. Wie
 * het oneens is schrijft een nieuwe opmerking.
 */
export async function resolveNote(
  noteId: number,
  actor: { id: string | null; isAdmin: boolean },
): Promise<void> {
  await query(
    `update medical.screening_notes
        set state = 'resolved', resolved_at = now(), resolved_by = $2
      where id = $1 and state = 'open'`,
    [noteId, actor.id],
  );
  await logAudit({
    actorId: actor.id,
    actorKind: actor.isAdmin ? "admin" : "coach",
    action: "update",
    entitySchema: "medical",
    entityTable: "screening_notes",
    entityId: String(noteId),
    detail: { state: "resolved" },
  });
}

/** Hoeveel vlaggen er nog openstaan, per sessie. Voor de tijdlijn. */
export async function openNoteCounts(
  athleteId: string,
): Promise<Map<string, number>> {
  const rows = await query<Record<string, unknown>>(
    `select session_id, count(*) as n
       from medical.screening_notes
      where athlete_id = $1 and state = 'open' and session_id is not null
      group by session_id`,
    [athleteId],
  );
  return new Map(rows.map((r) => [r.session_id as string, Number(r.n)]));
}
