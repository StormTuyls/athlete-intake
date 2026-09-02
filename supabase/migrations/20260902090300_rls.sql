-- Row Level Security.
--
-- Uitgangspunt: `anon` krijgt nergens een policy. De publieke intakeflow loopt
-- niet via PostgREST maar via server-side route handlers die eerst het
-- capability token valideren. Een anonieme bezoeker kan dus niets rechtstreeks
-- uit de databank halen, ook niet als hij de publishable key heeft.

-- Rol van de aanroeper. security definer omdat de policy op public.profiles
-- zelf anders in een cirkel loopt.
create or replace function private.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid());
$$;

comment on function private.current_role() is 'Rol van de ingelogde gebruiker. Leest alleen de eigen rij, dus geen informatielek.';

revoke execute on function private.current_role() from public;
grant execute on function private.current_role() to authenticated;

create or replace function private.is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_role() in ('coach', 'admin');
$$;

revoke execute on function private.is_staff() from public;
grant execute on function private.is_staff() to authenticated;

-- ── public ────────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.athletes enable row level security;
alter table public.intakes enable row level security;
alter table public.field_definitions enable row level security;
alter table public.consents enable row level security;
alter table public.audit_log enable row level security;
alter table public.chat_messages enable row level security;

-- Iedere ingelogde gebruiker leest zijn eigen profiel; staf leest alle profielen.
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));

-- De taxonomie is geen geheim en is nodig om labels te tonen.
create policy field_definitions_select on public.field_definitions
  for select to authenticated
  using (true);

-- Staf beheert atleten. Een atleet met een account ziet alleen zichzelf.
create policy athletes_select on public.athletes
  for select to authenticated
  using (
    (select private.is_staff())
    or profile_id = (select auth.uid())
  );

create policy athletes_write on public.athletes
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy intakes_select on public.intakes
  for select to authenticated
  using (
    (select private.is_staff())
    or athlete_id in (
      select a.id from public.athletes a where a.profile_id = (select auth.uid())
    )
  );

create policy intakes_write on public.intakes
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy consents_select on public.consents
  for select to authenticated
  using (
    (select private.is_staff())
    or athlete_id in (
      select a.id from public.athletes a where a.profile_id = (select auth.uid())
    )
  );

create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using ((select private.is_staff()));

-- Het audit-log is leesbaar voor staf en door niemand te wijzigen. Geen enkele
-- insert-, update- of delete-policy, ook niet voor staf: schrijven gebeurt via
-- triggers en de service role.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select private.is_staff()));

-- ── medical ───────────────────────────────────────────────────────────────────
--
-- RLS aan, en met opzet geen enkele policy. De service role omzeilt RLS, dus de
-- server werkt gewoon. Zou het schema per ongeluk toch exposed raken, dan levert
-- elke query nul rijen op in plaats van een dossier.

alter table medical.documents enable row level security;
alter table medical.document_pages enable row level security;
alter table medical.field_proposals enable row level security;
alter table medical.dossier_fields enable row level security;
alter table medical.injury_events enable row level security;
alter table medical.test_sessions enable row level security;
alter table medical.test_measurements enable row level security;
alter table medical.intake_reports enable row level security;
alter table medical.purge_jobs enable row level security;

-- Tweede slot op dezelfde deur: geen rechten op het schema zelf.
revoke all on schema medical from anon, authenticated;
revoke all on all tables in schema medical from anon, authenticated;
revoke all on all sequences in schema medical from anon, authenticated;

alter default privileges in schema medical revoke all on tables from anon, authenticated;
alter default privileges in schema medical revoke all on sequences from anon, authenticated;

revoke all on schema private from anon, authenticated;
