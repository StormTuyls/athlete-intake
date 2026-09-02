-- Het `medical`-schema. Bijzondere categorie persoonsgegevens.
--
-- Kernprincipe in tabelvorm: het model schrijft nooit rechtstreeks in het
-- dossier. Het levert voorstellen (field_proposals, append-only, altijd met
-- herkomst). De opgeloste toestand staat in dossier_fields, exact een rij per
-- veld per intake, afgedwongen door de primary key. Zonder die scheiding is
-- "de coach beslist" een belofte in plaats van een eigenschap.

create table medical.documents (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.intakes (id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  -- Inhoudshash. Dezelfde scan twee keer uploaden kost geen tweede modelcall.
  sha256 text not null check (char_length(sha256) = 64),
  kind public.document_kind not null,
  page_count integer check (page_count is null or page_count >= 1),
  -- Files API id, zodat een document niet per call opnieuw geupload wordt.
  anthropic_file_id text,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create unique index documents_storage_path_key on medical.documents (storage_path);
create unique index documents_intake_sha256_key on medical.documents (intake_id, sha256);
create index documents_intake_idx on medical.documents (intake_id);
-- Voor de verwerkingsqueue: wat is nog niet gelukt of nog niet gedaan.
create index documents_unprocessed_idx on medical.documents (uploaded_at)
  where processed_at is null;

-- Paginatekst is de bron van waarheid voor citaatverificatie. Zonder deze tabel
-- kan quote_verified niet bestaan en valt de betrouwbaarheidsindicatie terug op
-- geloof in het model.
create table medical.document_pages (
  id bigint generated always as identity primary key,
  document_id uuid not null references medical.documents (id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  text text not null,
  constraint document_pages_unique_page unique (document_id, page_number)
);

-- Append-only log van elk voorstel, van model, atleet of coach.
create table medical.field_proposals (
  id bigint generated always as identity primary key,
  intake_id uuid not null references public.intakes (id) on delete cascade,
  field_key text not null references public.field_definitions (key) on delete restrict,
  value jsonb,
  proposed_by public.proposed_by not null,
  source_document_id uuid references medical.documents (id) on delete set null,
  source_page integer check (source_page is null or source_page >= 1),
  source_quote text,
  -- Server-side geverifieerd tegen document_pages. Nooit door het model gezet.
  quote_verified boolean not null default false,
  model_id text,
  created_at timestamptz not null default now(),
  -- Een voorstel van het model moet een brondocument en een citaat hebben.
  -- Dit is de reden dat provenance geen optioneel veld is maar een garantie.
  constraint field_proposals_model_needs_provenance check (
    proposed_by <> 'model'
    or (source_document_id is not null and source_quote is not null and model_id is not null)
  ),
  -- Een geverifieerd citaat zonder citaat is onmogelijk.
  constraint field_proposals_verified_needs_quote check (
    quote_verified = false or source_quote is not null
  )
);

create index field_proposals_intake_field_idx on medical.field_proposals (intake_id, field_key, id desc);
create index field_proposals_source_document_idx on medical.field_proposals (source_document_id);

-- De opgeloste toestand van het dossier. Exact een rij per veld per intake.
create table medical.dossier_fields (
  intake_id uuid not null references public.intakes (id) on delete cascade,
  field_key text not null references public.field_definitions (key) on delete restrict,
  value jsonb,
  status public.field_status not null,
  confidence public.confidence_level not null,
  -- Het voorstel dat het geworden is. Null alleen bij status 'missing'.
  winning_proposal_id bigint references medical.field_proposals (id) on delete set null,
  -- Rivaliserende waarden bij status 'conflicting', met hun herkomst. Het
  -- systeem kiest niet stil, de coach ziet beide en beslist.
  conflicts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (intake_id, field_key),
  constraint dossier_fields_missing_has_no_value check (
    status <> 'missing' or (value is null and winning_proposal_id is null)
  ),
  constraint dossier_fields_present_has_proposal check (
    status = 'missing' or winning_proposal_id is not null
  ),
  constraint dossier_fields_conflicting_has_rivals check (
    status <> 'conflicting' or jsonb_array_length(conflicts) > 0
  )
);

create index dossier_fields_winning_proposal_idx on medical.dossier_fields (winning_proposal_id);
create index dossier_fields_open_idx on medical.dossier_fields (intake_id)
  where status in ('missing', 'conflicting');

-- Blessuretijdlijn. Eigen entiteit, niet losse tekst in het dossier, zodat
-- recidieven te koppelen zijn en fase 2 er later op kan bouwen.
create table medical.injury_events (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  intake_id uuid references public.intakes (id) on delete set null,
  body_region text not null,
  side public.body_side not null default 'unknown',
  diagnosis text,
  onset_date date,
  end_date date,
  recurrence_of uuid references medical.injury_events (id) on delete set null,
  source_document_id uuid references medical.documents (id) on delete set null,
  source_page integer,
  source_quote text,
  quote_verified boolean not null default false,
  created_at timestamptz not null default now(),
  constraint injury_events_dates_ordered check (
    onset_date is null or end_date is null or end_date >= onset_date
  ),
  constraint injury_events_not_own_recurrence check (recurrence_of is distinct from id)
);

create index injury_events_athlete_idx on medical.injury_events (athlete_id, onset_date);
create index injury_events_intake_idx on medical.injury_events (intake_id);
create index injury_events_recurrence_idx on medical.injury_events (recurrence_of);
create index injury_events_source_document_idx on medical.injury_events (source_document_id);

-- Testmomenten bestaan nu al als eigen entiteit, ook al leest fase 1 alleen
-- VALD-CSV's in. Dat kost nu bijna niets en spaart later een migratie wanneer
-- de screeningsmodule uit fase 2 hierop moet.
create table medical.test_sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  intake_id uuid references public.intakes (id) on delete set null,
  occurred_on date not null,
  -- ForceDecks, NordBord, ForceFrame, DynaMo.
  device text,
  protocol text,
  source_document_id uuid references medical.documents (id) on delete set null,
  created_at timestamptz not null default now()
);

create index test_sessions_athlete_idx on medical.test_sessions (athlete_id, occurred_on desc);
create index test_sessions_intake_idx on medical.test_sessions (intake_id);
create index test_sessions_source_document_idx on medical.test_sessions (source_document_id);

create table medical.test_measurements (
  id bigint generated always as identity primary key,
  test_session_id uuid not null references medical.test_sessions (id) on delete cascade,
  metric text not null,
  value numeric not null,
  unit text not null,
  limb public.body_side not null default 'unknown',
  constraint test_measurements_unique_metric unique (test_session_id, metric, limb)
);

-- Het rapport komt uit een bevroren snapshot, niet uit een live modelcall.
-- Anders verandert een rapport onder de handen van de coach.
create table medical.intake_reports (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.intakes (id) on delete cascade,
  version integer not null check (version >= 1),
  storage_path text,
  frozen_snapshot jsonb not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles (id) on delete set null,
  constraint intake_reports_unique_version unique (intake_id, version)
);

create index intake_reports_generated_by_idx on medical.intake_reports (generated_by);

-- Geen foreign key naar athletes: de atleet is juist weg als deze rij afgerond is.
create table medical.purge_jobs (
  id bigint generated always as identity primary key,
  athlete_id uuid not null,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb
);

create index purge_jobs_pending_idx on medical.purge_jobs (requested_at)
  where completed_at is null;
create index purge_jobs_requested_by_idx on medical.purge_jobs (requested_by);
