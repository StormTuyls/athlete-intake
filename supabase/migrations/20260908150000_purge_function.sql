-- Het verwijderpad, in de databank.
--
-- Tot nu was `delete from public.athletes` onmogelijk, en niemand wist het. De
-- cascade loopt via medical.field_proposals, en op die tabel staat een
-- STATEMENT-trigger die private.reject_mutation() aanroept. Postgres voert een
-- refererende cascade uit als `delete from only ...`, en dat vuurt
-- statement-triggers. Gemeten, met de melding erbij:
--
--   error: public.audit_log is append-only
--     bij: delete from athletes where id = ...
--
-- De melding klopte niet eens met de tabel, want beide triggers gebruiken
-- dezelfde onvoorwaardelijke functie. De teardowns in evals/ gooiden die fout
-- weg, dus stond er maandenlang een verwijderpad in het plan dat bij de eerste
-- poging zou zijn afgebroken.
--
-- Dit is de eis die de klant expliciet stelde en waar volgens hem iedereen op
-- faalt. Dus: een echt pad, met de garanties eromheen intact.

-- 1. De historie van voorstellen blijft onwijzigbaar, behalve tijdens een purge.
--
-- Een aparte functie, want private.reject_mutation() is ook de functie van
-- audit_log_append_only. Daar mag geen enkele uitzondering in: het punt van die
-- trigger is dat hij geen voorwaarden heeft. Wie er een aan toevoegt, hoe
-- zorgvuldig ook, maakt het audit-log wijzigbaar onder een voorwaarde.
--
-- Wat hier wel verzwakt: de garantie "elke schrijfactie op field_proposals is
-- ook gelogd" geldt niet tijdens een purge. Dat is aanvaardbaar omdat de rol die
-- de vlag kan zetten al volledige rechten op het schema heeft, en omdat de purge
-- zelf één samenvattende regel in het audit-log achterlaat. Wat NIET verzwakt:
-- bestaande historie herschrijven of wissen buiten een purge blijft onmogelijk.
create or replace function private.reject_mutation_unless_purging()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.purge_in_progress', true) = 'on' then
    return null;
  end if;
  raise exception 'medical.field_proposals is append-only';
end;
$$;

drop trigger if exists field_proposals_append_only on medical.field_proposals;

create trigger field_proposals_append_only
  before update or delete on medical.field_proposals
  for each statement execute function private.reject_mutation_unless_purging();

-- 2. Tijdens een purge geen rijtriggers, maar één samenvatting.
--
-- Zonder dit levert het verwijderen van één atleet honderden audit-regels op:
-- een per verwijderde rij, allemaal met detail {"op":"delete"}, allemaal
-- verwijzend naar entiteiten die niet meer bestaan.
--
-- Deze codebase heeft die afweging al eens gemaakt, bij saveDossier in
-- lib/db/medical.ts: 41 regels per keer dat iemand een dossier opende begroeven
-- het echte spoor onder ruis, en de oplossing was de ruis niet maken. Een purge
-- is hetzelfde gebrek maal tien.
--
-- De samenvatting is ook beter bewijs, niet minder: "atleet X gewist, 2 intakes,
-- 3 documenten, 178 voorstellen, 3 toestemmingen" is één regel die een
-- functionaris kan lezen. Wat het kost: een purge die de verkeerde atleet raakt
-- is niet rij voor rij te reconstrueren. De tellingen begrenzen de schade, en de
-- bewijstest in evals/purge.test.ts is de eigenlijke waarborg.
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
  -- Zie de toelichting bij deze migratie: tijdens een purge schrijft
  -- medical.purge_athlete één regel met de tellingen in plaats van honderden.
  if current_setting('app.purge_in_progress', true) = 'on' then
    return null;
  end if;

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

-- 3. Het verwijderen zelf.
--
-- In `medical` en niet in `private`: de serverrol heeft al usage op medical, en
-- PostgREST kan dat schema niet zien, dus deze functie is per constructie niet
-- over HTTP te bereiken. Hem in `private` zetten zou usage op dat schema vragen
-- en dan liggen audit_row en reject_mutation ook binnen bereik van die rol.
--
-- security definer omdat geen enkele applicatierol beide helften kan wissen:
-- intake_server mag niets schrijven in public.athletes, en service_role heeft
-- geen enkel recht op medical. In TypeScript zou het dus twee verbindingen zijn
-- en daarmee twee transacties, en een crash ertussen laat een half verwijderde
-- atleet achter. Zo is de databankhelft één statement dat slaagt of niets doet.
--
-- Idempotent: een atleet die er niet is levert nullen op en geen fout. Dat is
-- wat een herstart van een half gelukte purge nodig heeft.
create or replace function medical.purge_athlete(
  p_athlete_id uuid,
  p_actor_id uuid default null,
  p_actor_kind text default 'system'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intake_ids uuid[];
  v_document_ids uuid[];
  v_session_ids uuid[];
  v_storage_paths text[];
  v_profile_id uuid;
  v_counts jsonb;
  v_manifest jsonb;
begin
  if p_actor_kind not in ('coach', 'admin', 'system') then
    raise exception 'onbekende actorsoort: %', p_actor_kind;
  end if;

  -- Alles wat later nodig is EERST vastleggen. Na de delete bestaan de rijen
  -- die dit beschrijven niet meer, en de orkestratie heeft de storage-paden en
  -- het profiel-id nog nodig om buiten Postgres op te ruimen.
  select a.profile_id into v_profile_id
    from public.athletes a
   where a.id = p_athlete_id;

  select coalesce(array_agg(i.id), '{}'::uuid[]) into v_intake_ids
    from public.intakes i
   where i.athlete_id = p_athlete_id;

  select coalesce(array_agg(d.id), '{}'::uuid[]),
         coalesce(array_agg(d.storage_path), '{}'::text[])
    into v_document_ids, v_storage_paths
    from medical.documents d
   where d.intake_id = any(v_intake_ids);

  -- Zowel via athlete_id (cascade) als via intake_id (set null): de eerste
  -- verdwijnt mee, de tweede zou blijven staan met een losgekoppelde intake.
  select coalesce(array_agg(t.id), '{}'::uuid[]) into v_session_ids
    from medical.test_sessions t
   where t.athlete_id = p_athlete_id
      or t.intake_id = any(v_intake_ids);

  v_counts := jsonb_build_object(
    'athletes', (select count(*) from public.athletes where id = p_athlete_id),
    'intakes', coalesce(array_length(v_intake_ids, 1), 0),
    -- Toestemmingen staan er expliciet bij: op public.consents zit geen
    -- delete-trigger, dus zonder deze telling blijft er nergens staan dat het
    -- toestemmingsregister van deze atleet bestond.
    'consents', (select count(*) from public.consents where athlete_id = p_athlete_id),
    'chat_messages', (
      select count(*) from public.chat_messages where intake_id = any(v_intake_ids)
    ),
    'documents', coalesce(array_length(v_document_ids, 1), 0),
    'document_pages', (
      select count(*) from medical.document_pages where document_id = any(v_document_ids)
    ),
    'field_proposals', (
      select count(*) from medical.field_proposals where intake_id = any(v_intake_ids)
    ),
    'dossier_fields', (
      select count(*) from medical.dossier_fields where intake_id = any(v_intake_ids)
    ),
    'injury_events', (
      select count(*) from medical.injury_events
       where athlete_id = p_athlete_id or intake_id = any(v_intake_ids)
    ),
    'test_sessions', coalesce(array_length(v_session_ids, 1), 0),
    'test_measurements', (
      select count(*) from medical.test_measurements
       where test_session_id = any(v_session_ids)
    ),
    'intake_reports', (
      select count(*) from medical.intake_reports where intake_id = any(v_intake_ids)
    )
  );

  v_manifest := jsonb_build_object(
    'athlete_id', p_athlete_id,
    'profile_id', v_profile_id,
    'intake_ids', to_jsonb(v_intake_ids),
    'document_ids', to_jsonb(v_document_ids),
    'test_session_ids', to_jsonb(v_session_ids),
    'storage_paths', to_jsonb(v_storage_paths)
  );

  -- De vlag staat zo kort mogelijk aan: alleen rond de delete, en
  -- transactielokaal, wat exact de scope is waarin de cascade loopt.
  perform set_config('app.purge_in_progress', 'on', true);
  delete from public.athletes where id = p_athlete_id;
  perform set_config('app.purge_in_progress', 'off', true);

  -- Het spoor wordt HIER geschreven en niet vanuit Node. Zo bestaat de regel als
  -- en alleen als de delete gecommit is. Een logAudit() vanuit de applicatie
  -- loopt over een andere verbinding en kan die garantie niet geven.
  insert into public.audit_log (
    actor_id, actor_kind, action, entity_schema, entity_table, entity_id, detail
  )
  values (
    p_actor_id,
    p_actor_kind,
    'purge',
    'public',
    'athletes',
    p_athlete_id::text,
    jsonb_build_object('counts', v_counts, 'manifest', v_manifest)
  );

  return jsonb_build_object('counts', v_counts, 'manifest', v_manifest);
end;
$$;

comment on function medical.purge_athlete(uuid, uuid, text) is
  'Verwijdert alle rijen van een atleet in beide schemas en logt een samenvatting. Storage, auth.users en Notion horen bij de orkestratie in lib/purge/. Idempotent.';

-- Functies zijn standaard uitvoerbaar door PUBLIC. Dat is hier niet bedoeld.
revoke execute on function medical.purge_athlete(uuid, uuid, text) from public;
grant execute on function medical.purge_athlete(uuid, uuid, text) to intake_server;

-- 4. De omwegen dicht.
--
-- Zonder deze twee is de vlag een slot op een deur die ernaast openstaat.
--
-- De serverrol had delete op alles in medical. Geen enkele applicatiecode
-- gebruikt dat (voorstellen zijn append-only, het dossier wordt herberekend en
-- niet gewist), dus dit kost niets en maakt de purge-functie de enige route naar
-- een delete in dat schema.
revoke delete on all tables in schema medical from intake_server;
alter default privileges in schema medical revoke delete on tables from intake_server;

-- En de belangrijkere: een ingelogde coach kon via PostgREST
-- `DELETE /rest/v1/athletes?id=eq...` sturen. De policy athletes_write staat het
-- toe voor behandelaars en de grant stond er. Dat verwijderde de databankrijen
-- en liet de bestanden in Storage, het inlogaccount en de Notion-kaart staan:
-- precies de wees-situatie waar dit hele verwijderpad tegen bestaat. De enige
-- route naar het wissen van een atleet is nu de orkestratie die die drie ook
-- opruimt.
revoke delete on public.athletes from authenticated;
