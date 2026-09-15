-- Een concept weggooien en opnieuw beginnen.
--
-- Waarom dit er moet zijn: een intake kende maar één uitgang, en dat was hem
-- afmaken. De assistent stopt pas met vragen als er geen enkel gat meer open
-- staat, en na de vijftien verplichte velden staan er nog vijfentwintig
-- optionele. Wie op een vraag stuit die hij niet kan beantwoorden, of wie
-- gewoon opnieuw wil beginnen, had geen enkele knop. Vanuit de stoel van de
-- atleet is dat een gesprek zonder einde.
--
-- ALLEEN een concept, en dat is de hele veiligheidsgrens van deze functie. Een
-- ingediende intake is iets dat een behandelaar mogelijk al gelezen heeft; een
-- goedgekeurde is een vastgelegd klinisch document met een rapportversie en een
-- hash eronder. Die twee horen niet te verdwijnen omdat iemand op een knop in
-- een chatscherm drukt. Wie die wil laten wissen, vraagt het de praktijk, en
-- daar bestaat medical.purge_athlete() voor.
--
-- De controle staat HIER en niet alleen in de route. Een status die in
-- TypeScript gecontroleerd wordt is een controle die iemand kan vergeten bij de
-- volgende aanroeper; een exception in de functie geldt voor elke aanroeper die
-- er ooit bij komt.
--
-- Dezelfde vorm als medical.purge_athlete: security definer omdat geen enkele
-- applicatierol beide helften mag wissen, alles wat de orkestratie later nog
-- nodig heeft eerst vastleggen, en het auditspoor vanuit de functie zelf zodat
-- de regel bestaat als en alleen als de delete gecommit is.
--
-- Idempotent: een intake die er niet is levert nullen op en geen fout.

create or replace function medical.discard_intake(
  p_intake_id uuid,
  p_actor_id uuid default null,
  p_actor_kind text default 'athlete'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.intake_status;
  v_athlete_id uuid;
  v_document_ids uuid[];
  v_storage_paths text[];
  v_counts jsonb;
begin
  if p_actor_kind not in ('athlete', 'coach', 'admin', 'system') then
    raise exception 'onbekende actorsoort: %', p_actor_kind;
  end if;

  select i.status, i.athlete_id
    into v_status, v_athlete_id
    from public.intakes i
   where i.id = p_intake_id;

  -- Bestaat niet: nullen, geen fout. Twee keer op weggooien drukken hoort geen
  -- foutmelding op te leveren nadat de eerste klik gelukt is.
  if v_status is null then
    return jsonb_build_object('discarded', false, 'reason', 'not_found');
  end if;

  if v_status <> 'draft' then
    raise exception 'intake % heeft status % en is geen concept meer', p_intake_id, v_status
      using errcode = 'check_violation';
  end if;

  -- De opslagpaden eerst, want na de delete bestaan de documentrijen die ze
  -- beschrijven niet meer en kan de aanroeper de bestanden niet meer vinden.
  -- De bucket opruimen gebeurt buiten Postgres; deze functie levert de lijst.
  select coalesce(array_agg(d.id), '{}'::uuid[]),
         coalesce(array_agg(d.storage_path), '{}'::text[])
    into v_document_ids, v_storage_paths
    from medical.documents d
   where d.intake_id = p_intake_id;

  v_counts := jsonb_build_object(
    'chat_messages', (
      select count(*) from public.chat_messages where intake_id = p_intake_id
    ),
    'documents', coalesce(array_length(v_document_ids, 1), 0),
    'document_pages', (
      select count(*) from medical.document_pages where document_id = any(v_document_ids)
    ),
    'field_proposals', (
      select count(*) from medical.field_proposals where intake_id = p_intake_id
    ),
    'dossier_fields', (
      select count(*) from medical.dossier_fields where intake_id = p_intake_id
    ),
    'injury_events', (
      select count(*) from medical.injury_events where intake_id = p_intake_id
    )
  );

  -- De vlag staat zo kort mogelijk aan: alleen rond de delete, en
  -- transactielokaal, precies de scope waarin de cascade loopt. Zonder hem
  -- weigert reject_mutation_unless_purging() de delete op field_proposals,
  -- terecht: die tabel is append-only en dit is de enige uitzondering.
  perform set_config('app.purge_in_progress', 'on', true);
  delete from public.intakes where id = p_intake_id;
  perform set_config('app.purge_in_progress', 'off', true);

  -- public.consents blijft staan. Die hangt aan de atleet en niet aan deze
  -- intake: de toestemming om gezondheidsgegevens te verwerken is bij het
  -- aanmaken van het account gegeven en geldt nog steeds. Hem hier weggooien
  -- zou de atleet uit zijn eigen account werken.

  insert into public.audit_log (
    actor_id, actor_kind, action, entity_schema, entity_table, entity_id, detail
  )
  values (
    p_actor_id,
    p_actor_kind,
    'purge',
    'public',
    'intakes',
    p_intake_id::text,
    jsonb_build_object(
      'scope', 'intake',
      'athlete_id', v_athlete_id,
      'counts', v_counts,
      'storage_paths', to_jsonb(v_storage_paths)
    )
  );

  return jsonb_build_object(
    'discarded', true,
    'athlete_id', v_athlete_id,
    'counts', v_counts,
    'storage_paths', to_jsonb(v_storage_paths)
  );
end;
$$;

comment on function medical.discard_intake(uuid, uuid, text) is
  'Gooit een intake met status draft volledig weg, inclusief gesprek, documentrijen en voorstellen, en geeft de opslagpaden terug zodat de aanroeper de bucket kan opruimen. Weigert alles wat geen concept meer is.';

revoke execute on function medical.discard_intake(uuid, uuid, text) from public;
grant execute on function medical.discard_intake(uuid, uuid, text) to intake_server;
