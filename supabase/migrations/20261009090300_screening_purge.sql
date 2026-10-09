-- Het verwijderpad uitbreiden naar de screeningstabellen, en de stubs opruimen.
--
-- Volgorde is hier niet vrij: eerst purge_athlete() omzetten, dan pas de oude
-- tabellen weggooien. Postgres valideert een plpgsql-body niet bij een drop, dus
-- andersom zou de functie blijven bestaan en pas falen op het moment dat iemand
-- hem echt nodig heeft. Dat is precies de faalwijze die 20260908150000
-- beschrijft en die maandenlang onopgemerkt bleef.

-- ── 1. Een uitzondering op het delete-verbod, met zijn grens erbij ────────────
--
-- 20260908150000 heeft delete op alle medische tabellen bij intake_server
-- weggehaald, zodat purge_athlete() de enige route naar een delete is. De
-- redenering daar: voorstellen zijn append-only en het dossier wordt herberekend
-- en niet gewist.
--
-- medical.derived_results is het ene geval waar herberekenen niet genoeg is. Die
-- rijen zijn volledig afgeleid, en bij een herberekening kan een uitkomst
-- VERDWIJNEN: wordt een proef ongeldig verklaard waardoor er nog maar een zijde
-- gemeten is, dan hoort de LSI van die sessie weg te zijn. Een upsert laat hem
-- staan, en dan toont het scherm een symmetriegetal dat bij geen enkele meting
-- meer hoort.
--
-- De grens van deze uitzondering: alleen deze tabel, en er staat niets in wat
-- niet uit metingen en formules opnieuw te maken is. Geen enkele ruwe
-- waarneming, geen enkele uitspraak van een mens.
grant delete on medical.derived_results to intake_server;

comment on table medical.derived_results is
  'Afgeleide uitkomsten, gematerialiseerd met hun formule- en regelversie. De enige medische tabel waarop intake_server delete heeft: een herberekening moet een uitkomst kunnen laten verdwijnen, en er staat niets in wat niet herleidbaar is.';

-- ── 2. purge_athlete() over de nieuwe tabellen ────────────────────────────────

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
  v_item_ids uuid[];
  v_trial_ids bigint[];
  v_storage_paths text[];
  v_profile_id uuid;
  v_counts jsonb;
  v_manifest jsonb;
begin
  if p_actor_kind not in ('coach', 'admin', 'system') then
    raise exception 'onbekende actorsoort: %', p_actor_kind;
  end if;

  -- Alles wat later nodig is EERST vastleggen. Na de delete bestaan de rijen die
  -- dit beschrijven niet meer, en de orkestratie heeft de storage-paden en het
  -- profiel-id nog nodig om buiten Postgres op te ruimen.
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

  -- Screeningssessies hangen alleen aan de atleet en niet aan een intake: een
  -- screening is een gebeurtenis in de tijdlijn van de atleet, geen eigenschap
  -- van een intakegesprek. Een enkele cascade dus, en niet de twee routes die de
  -- oude test_sessions-stub had.
  select coalesce(array_agg(s.id), '{}'::uuid[]) into v_session_ids
    from medical.screening_sessions s
   where s.athlete_id = p_athlete_id;

  select coalesce(array_agg(ti.id), '{}'::uuid[]) into v_item_ids
    from medical.test_items ti
   where ti.session_id = any(v_session_ids);

  select coalesce(array_agg(tt.id), '{}'::bigint[]) into v_trial_ids
    from medical.test_trials tt
   where tt.test_item_id = any(v_item_ids);

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
    'screening_sessions', coalesce(array_length(v_session_ids, 1), 0),
    'test_items', coalesce(array_length(v_item_ids, 1), 0),
    'test_trials', coalesce(array_length(v_trial_ids, 1), 0),
    'trial_values', (
      select count(*) from medical.trial_values where test_trial_id = any(v_trial_ids)
    ),
    'measurements', (
      select count(*) from medical.measurements where test_item_id = any(v_item_ids)
    ),
    'derived_results', (
      select count(*) from medical.derived_results where session_id = any(v_session_ids)
    ),
    'test_imports', (
      select count(*) from medical.test_imports where session_id = any(v_session_ids)
    ),
    -- Notities en screeningrapporten hangen RECHTSTREEKS aan de atleet en niet
    -- aan een sessie: een opmerking kan over de atleet in het algemeen gaan, en
    -- een rapport blijft bestaan als de sessie uit het rapport verwijderd wordt
    -- (session_id is on delete set null). Daarom tellen ze op athlete_id.
    'screening_notes', (
      select count(*) from medical.screening_notes where athlete_id = p_athlete_id
    ),
    'screening_reports', (
      select count(*) from medical.screening_reports where athlete_id = p_athlete_id
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
    'screening_session_ids', to_jsonb(v_session_ids),
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

revoke execute on function medical.purge_athlete(uuid, uuid, text) from public;
grant execute on function medical.purge_athlete(uuid, uuid, text) to intake_server;

-- ── 3. De stubs weg ───────────────────────────────────────────────────────────
--
-- medical.test_sessions en test_measurements uit 20260902090200 waren een
-- plaatshouder voor deze module. Er bestaat geen schrijfpad naar die tabellen:
-- alleen lib/purge/db.ts telde ze en evals/purge.test.ts vulde ze. Er valt dus
-- niets te migreren.
--
-- Ze blijven niet staan "voor het geval dat". Twee bijna gelijknamige
-- sessietabellen naast elkaar is precies hoe de volgende query tegen de
-- verkeerde geschreven wordt, en die fout is stil: je krijgt nul rijen en geen
-- foutmelding.

drop table if exists medical.test_measurements;
drop table if exists medical.test_sessions;
