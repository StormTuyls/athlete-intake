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

/**
 * Alleen wat public.audit_log.action toestaat, zie de check-constraint in
 * 20260902090100_public_tables.sql. 'insert' hoort erbij omdat een correctie van
 * de coach via de directe pg-verbinding gaat: die insert wordt wel door de
 * row-trigger op medical.field_proposals gezien, maar zonder auth.uid(), dus
 * landt hij als actor_kind 'system'. Zonder deze expliciete regel staat er in
 * het spoor niet wie het veld veranderde.
 */
export type AuditAction = "read" | "export" | "purge" | "insert" | "update";
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
