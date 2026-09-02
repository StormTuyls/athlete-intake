-- Audit-spoor.
--
-- Mutaties worden door triggers gelogd, want dat kan niemand vergeten. Leesacties
-- kunnen triggers niet zien: die worden expliciet gelogd in de data-access-laag
-- via private.log_access(). Dat is een bewuste, benoemde beperking.

create or replace function private.actor_kind()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select p.role::text from public.profiles p where p.id = (select auth.uid())),
    'system'
  );
$$;

-- Generieke rijtrigger. Logt de primaire sleutel en, bij een update, alleen de
-- gewijzigde kolomnamen. Geen waarden: het audit-log mag zelf geen tweede kopie
-- van de medische data worden.
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_id text;
  v_detail jsonb;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_entity_id := coalesce(v_old ->> 'id', v_old ->> 'intake_id');
    v_detail := jsonb_build_object('op', 'delete');
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_entity_id := coalesce(v_new ->> 'id', v_new ->> 'intake_id');
    v_detail := jsonb_build_object(
      'op', 'update',
      'changed', (
        select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
        from jsonb_object_keys(v_new) k
        where v_new -> k is distinct from v_old -> k
      )
    );
  else
    v_new := to_jsonb(new);
    v_entity_id := coalesce(v_new ->> 'id', v_new ->> 'intake_id');
    v_detail := jsonb_build_object('op', 'insert');
  end if;

  insert into public.audit_log (
    actor_id, actor_kind, action, entity_schema, entity_table, entity_id, detail
  )
  values (
    (select auth.uid()),
    private.actor_kind(),
    lower(tg_op),
    tg_table_schema,
    tg_table_name,
    v_entity_id,
    v_detail
  );

  return null;
end;
$$;

-- Expliciete logging van leesacties op medische data. Aan te roepen vanuit de
-- data-access-laag voor elke query die een dossier of document teruggeeft.
create or replace function private.log_access(
  p_entity_table text,
  p_entity_id text,
  p_action text default 'read',
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (
    actor_id, actor_kind, action, entity_schema, entity_table, entity_id, detail
  )
  values (
    (select auth.uid()),
    private.actor_kind(),
    p_action,
    'medical',
    p_entity_table,
    p_entity_id,
    p_detail
  );
end;
$$;

revoke execute on function private.log_access(text, text, text, jsonb) from public;

create trigger audit_documents
  after insert or update or delete on medical.documents
  for each row execute function private.audit_row();

create trigger audit_field_proposals
  after insert or delete on medical.field_proposals
  for each row execute function private.audit_row();

create trigger audit_dossier_fields
  after insert or update or delete on medical.dossier_fields
  for each row execute function private.audit_row();

create trigger audit_injury_events
  after insert or update or delete on medical.injury_events
  for each row execute function private.audit_row();

create trigger audit_intake_reports
  after insert or update or delete on medical.intake_reports
  for each row execute function private.audit_row();

create trigger audit_intakes
  after insert or update or delete on public.intakes
  for each row execute function private.audit_row();

create trigger audit_consents
  after insert or update on public.consents
  for each row execute function private.audit_row();

-- Append-only, met twee sloten.
--
-- Slot 1: grants. Slot 2: een statement-trigger, zodat ook de owner en de
-- service role er niet per ongeluk langs kunnen. Een audit-log dat te wijzigen
-- is, is geen audit-log.

create or replace function private.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'public.audit_log is append-only';
end;
$$;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each statement execute function private.reject_mutation();

revoke update, delete, truncate on public.audit_log from anon, authenticated, service_role;

-- Voorstellen zijn ook append-only: de historie is onderdeel van het spoor.
create trigger field_proposals_append_only
  before update or delete on medical.field_proposals
  for each statement execute function private.reject_mutation();
