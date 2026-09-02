import { appDb } from "@/lib/supabase/service";

/**
 * Audit-spoor voor wat triggers niet kunnen zien.
 *
 * Mutaties worden door databasetriggers gelogd, dus die kan niemand vergeten.
 * Leesacties en exports kunnen triggers niet zien: die horen hier, expliciet,
 * op de plek waar de data het systeem verlaat.
 *
 * Er gaan met opzet geen waarden in het detail-veld. Een audit-log dat de
 * medische data nog eens dupliceert vergroot het probleem dat het moet oplossen.
 */

export type AuditAction = "read" | "export" | "purge";
export type ActorKind = "coach" | "athlete" | "admin" | "system";

export async function logAudit(input: {
  action: AuditAction;
  actorKind: ActorKind;
  actorId?: string | null;
  entitySchema: "public" | "medical";
  entityTable: string;
  entityId: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await appDb()
    .from("audit_log")
    .insert({
      actor_id: input.actorId ?? null,
      actor_kind: input.actorKind,
      action: input.action,
      entity_schema: input.entitySchema,
      entity_table: input.entityTable,
      entity_id: input.entityId,
      detail: input.detail ?? {},
    });

  // Een mislukte audit-registratie mag niet stil blijven: dan verliest het
  // spoor zijn waarde precies wanneer het nodig is.
  if (error) {
    throw new Error(`audit-log schrijven mislukt: ${error.message}`);
  }
}
