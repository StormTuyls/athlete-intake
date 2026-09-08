import { queryOne } from "@/lib/db/sql";

/**
 * De databankhelft van het verwijderpad.
 *
 * Roept medical.purge_athlete aan, de security-definer-functie uit
 * 20260908150000_purge_function.sql. Die bestaat omdat geen enkele
 * applicatierol beide schemas kan wissen: intake_server mag niets schrijven in
 * public.athletes en service_role heeft geen recht op medical. Eén functie maakt
 * er één transactie van, die slaagt of niets doet.
 *
 * Wat hier NIET gebeurt: Storage, auth.users en Notion. Die liggen buiten
 * Postgres en kunnen dus nooit in dezelfde transactie. De volgorde en het
 * hervatten daarvan is de orkestratie in lib/purge/purge.ts.
 *
 * `manifest` is wat die orkestratie daarna nog nodig heeft: na de delete
 * bestaan de rijen die de storage-paden en het profiel-id beschrijven niet meer.
 */

export interface PurgeCounts {
  athletes: number;
  intakes: number;
  consents: number;
  chat_messages: number;
  documents: number;
  document_pages: number;
  field_proposals: number;
  dossier_fields: number;
  injury_events: number;
  test_sessions: number;
  test_measurements: number;
  intake_reports: number;
}

export interface PurgeManifest {
  athlete_id: string;
  profile_id: string | null;
  intake_ids: string[];
  document_ids: string[];
  test_session_ids: string[];
  storage_paths: string[];
}

export interface PurgeDbResult {
  counts: PurgeCounts;
  manifest: PurgeManifest;
}

export async function purgeAthleteRows(input: {
  athleteId: string;
  actorId?: string | null;
  actorKind?: "coach" | "admin" | "system";
}): Promise<PurgeDbResult> {
  const row = await queryOne<{ result: PurgeDbResult }>(
    "select medical.purge_athlete($1, $2, $3) as result",
    [input.athleteId, input.actorId ?? null, input.actorKind ?? "system"],
  );

  // De functie geeft altijd een object terug, ook voor een atleet die niet
  // bestaat: dan staan er nullen in. Geen resultaat betekent dus dat de aanroep
  // zelf misging, en dat mag niet stil blijven.
  if (!row) throw new Error("purge_athlete gaf geen resultaat terug");

  return row.result;
}
