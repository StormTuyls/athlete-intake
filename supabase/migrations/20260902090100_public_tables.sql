-- Het `public`-schema: identiteit, administratie, consent, audit.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'athlete',
  full_name text,
  locale text not null default 'nl' check (locale in ('nl', 'en')),
  created_at timestamptz not null default now()
);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id) on delete set null,
  full_name text,
  email text,
  phone text,
  club text,
  federation text,
  locale text not null default 'nl' check (locale in ('nl', 'en')),
  -- Afgedwongen door de retentiejob. Null betekent: nog geen termijn bepaald,
  -- wat alleen mag tussen aanmaak en het geven van consent.
  retention_until date,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index athletes_profile_id_idx on public.athletes (profile_id);
create index athletes_retention_idx on public.athletes (retention_until)
  where deleted_at is null;

create table public.intakes (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  status public.intake_status not null default 'draft',
  locale text not null default 'nl' check (locale in ('nl', 'en')),
  -- Capability token voor de publieke intakelink uit de linktree. Alleen de
  -- hash staat hier; de token zelf leeft in een httpOnly cookie en komt nooit
  -- in een URL of in een log.
  access_token_hash text not null,
  consent_granted_at timestamptz,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  -- Een intake kan niet ingediend zijn zonder consent.
  constraint intakes_submit_requires_consent check (
    submitted_at is null or consent_granted_at is not null
  ),
  -- Goedkeuren kan alleen na indienen, en registreert altijd wie.
  constraint intakes_approval_complete check (
    (approved_at is null and approved_by is null)
    or (approved_at is not null and approved_by is not null and submitted_at is not null)
  )
);

create unique index intakes_access_token_hash_key on public.intakes (access_token_hash);
create index intakes_athlete_id_idx on public.intakes (athlete_id);
create index intakes_status_idx on public.intakes (status);
create index intakes_approved_by_idx on public.intakes (approved_by);

-- De taxonomie. Bevroren aan het einde van M1: nieuwe velden zijn een change
-- request, geen commit. Zie supabase/seed.sql voor de inhoud.
create table public.field_definitions (
  key text primary key,
  section text not null,
  sort_order integer not null,
  label_nl text not null,
  label_en text not null,
  data_type public.field_data_type not null,
  required boolean not null default false,
  -- Bepaalt of de waarde in het medische deel van het rapport hoort en of de
  -- commerciele laag hem ooit mag zien.
  is_medical boolean not null default false,
  enum_options text[],
  -- Wat de assistent vraagt als het veld ontbreekt.
  question_nl text,
  question_en text,
  constraint field_definitions_enum_has_options check (
    data_type <> 'enum' or (enum_options is not null and array_length(enum_options, 1) > 0)
  )
);

create unique index field_definitions_order_key on public.field_definitions (section, sort_order);

create table public.consents (
  id bigint generated always as identity primary key,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  intake_id uuid not null references public.intakes (id) on delete cascade,
  -- Versie van de tekst die de atleet werkelijk gezien heeft. Zonder dit is een
  -- consentregistratie waardeloos zodra de tekst wijzigt.
  consent_version text not null,
  purposes jsonb not null,
  granted_at timestamptz not null default now(),
  ip inet,
  user_agent text,
  withdrawn_at timestamptz
);

create index consents_athlete_id_idx on public.consents (athlete_id);
create index consents_intake_id_idx on public.consents (intake_id);

-- Append-only. Zowel de grants als een trigger blokkeren update en delete,
-- zie 20260902090400_audit.sql.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- Null bij acties van een atleet met een capability token, of van het systeem.
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('coach', 'athlete', 'admin', 'system')),
  action text not null check (action in ('insert', 'update', 'delete', 'read', 'purge', 'export')),
  entity_schema text not null,
  entity_table text not null,
  entity_id text,
  detail jsonb
);

create index audit_log_entity_idx on public.audit_log (entity_schema, entity_table, entity_id);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);

create table public.chat_messages (
  id bigint generated always as identity primary key,
  intake_id uuid not null references public.intakes (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Welk veld deze vraag probeerde te vullen. Null voor vrije tekst.
  about_field_key text references public.field_definitions (key) on delete set null,
  created_at timestamptz not null default now()
);

create index chat_messages_intake_idx on public.chat_messages (intake_id, id);
create index chat_messages_about_field_idx on public.chat_messages (about_field_key);
