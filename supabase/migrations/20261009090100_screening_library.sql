-- De screeningsbibliotheek: tests, protocollen, metrieken en referentieregels.
--
-- Waarom in `public` en niet in `medical`: hier staat geen persoon in. Een
-- protocol beschrijft hoe je meet, een referentieregel is een drempel met een
-- bronvermelding. Het invoerscherm leest deze tabellen rechtstreeks via
-- PostgREST, net als public.field_definitions, en de praktijk bewerkt ze zonder
-- deploy.
--
-- De UITKOMST van een classificatie is wel een patientgegeven en staat dus in
-- medical.derived_results. De regel en het resultaat horen niet in hetzelfde
-- schema; daar loopt hier de scheidslijn.

-- ── 0. Wat de atleet mist voor referentiefilters ──────────────────────────────
--
-- Spec §5 laag 2 en 3 filteren op geslacht, sport, onderdeel, niveau en
-- leeftijd. sport, discipline (= onderdeel) en date_of_birth staan er al sinds
-- 20260915100000_identity_from_profile.sql. Deze twee niet, en zonder geslacht
-- is laag 2 en 3 niet eens te bevragen.
--
-- Geen nieuw veld in de intake-taxonomie: die is bevroren na M1 en een veld
-- erbij raakt de extractieprompt, de chat, het reviewscherm, het rapport en de
-- evalset. Dit zijn kolommen op het profiel, zoals adres en behandelaar dat ook
-- zijn.

alter table public.athletes
  add column sex public.athlete_sex not null default 'unspecified',
  add column competition_level text;

comment on column public.athletes.sex is
  'Meetvariabele voor referentiefilters (spec §5), geen identiteitsveld. Default unspecified, zodat de kolom nooit een antwoord afdwingt dat de atleet niet gegeven heeft.';

-- ── 1. De test ────────────────────────────────────────────────────────────────
--
-- Gescheiden van het protocol, en dat is de kern van spec §4's non-negotiable.
-- Een test is een identiteit die jaren meegaat ("heupabductie, ForceFrame").
-- Een protocol is HOE hij op een moment uitgevoerd werd: hefboomlengte, hoek,
-- fixatie, positie. Verandert dat, dan is de nieuwe meting niet langs de oude te
-- leggen, en dat moet de databank weten.
--
-- Metrieken hangen hieronder aan de TEST en niet aan het protocol. Zou dat
-- andersom zijn, dan dupliceert elke protocolherziening alle metriekrijen, en
-- dan is "piekkracht" in versie 1 en versie 2 twee verschillende sleutels
-- waartussen geen enkele grafiek doorloopt.

create table public.test_definitions (
  key text primary key,                 -- 'forceframe.hip_abduction'
  -- Het blok uit spec §7. Tekst en geen enum, net als field_definitions.section:
  -- de lijst hoort bij de seed en wordt door een test bewaakt.
  block text not null,
  sort_order integer not null,
  label_nl text not null,
  label_en text not null,
  -- Of deze test per zijde gemeten wordt. Bepaalt of LSI en asymmetrie
  -- uberhaupt berekenbaar zijn. Spec §7.9 waarschuwt expliciet: forceer geen LSI
  -- op CKCUEST, dat is een bilaterale test. Dit is de kolom die dat afdwingt.
  laterality text not null check (laterality in ('bilateral', 'per_side', 'either')),
  body_region text,
  source_note text,
  retired_at timestamptz
);

create unique index test_definitions_order_key on public.test_definitions (block, sort_order);

-- ── 2. Het protocol, versiegebonden en onveranderlijk ─────────────────────────
--
-- Een herziening is een NIEUWE rij met version + 1; de oude blijft staan en de
-- metingen die eraan hangen blijven kloppen.
--
-- Het alternatief, de bestaande rij bewerken, herschrijft stilzwijgend de
-- betekenis van elke historische meting: iemand corrigeert de hefboomlengte van
-- 30 naar 40 cm en drie jaar heupdata betekent ineens iets anders, zonder een
-- enkele foutmelding. Dat is dezelfde faalwijze die deze codebase al benoemd
-- heeft bij field_proposals: historie is deel van het spoor, geen kolom die
-- bijgewerkt wordt.

create table public.test_protocols (
  id uuid primary key default gen_random_uuid(),
  test_key text not null references public.test_definitions (key) on delete restrict,
  version integer not null check (version >= 1),
  label_nl text not null,
  label_en text not null,

  -- De geometrie. Dit is wat spec §4 "belongs to the data" noemt.
  device text,                  -- 'ForceFrame', 'NordBord', 'DynaMo', 'ForceDecks', 'manual'
  body_position text,
  joint_angle_deg numeric,
  lever_arm_cm numeric,
  fixation text,
  warm_up text,
  external_load_kg numeric,     -- loaded CMJ
  drop_height_cm numeric,       -- drop jump; spec §8 zegt dat dit het resultaat sterk bepaalt

  trial_count integer check (trial_count is null or trial_count >= 1),
  trial_selection public.trial_selection not null default 'single',

  -- Is het protocol werkelijk bevestigd, of is het een reconstructie uit de
  -- bronsheets? Spec §10 en §18 noemen 90-90, Thomas, MHFAKE, gastrocnemius en
  -- de Iso Push-testen als onbevestigd. Een onbevestigd protocol mag gemeten
  -- worden; het mag alleen niet automatisch scoren.
  protocol_confirmed boolean not null default false,
  protocol_source text,

  -- Wanneer dit protocol in bereik is voor een atleet. Dezelfde gesloten vorm en
  -- dezelfde evaluator als field_definitions.ask_when (lib/dossier/askWhen.ts).
  -- Een screeningsbank is precies het geval waarvoor die engine gebouwd is: veel
  -- tests waarvan het merendeel niet op deze atleet slaat.
  ask_when jsonb,

  notes text,
  created_at timestamptz not null default now(),
  retired_at timestamptz,

  constraint test_protocols_unique_version unique (test_key, version),
  constraint test_protocols_ask_when_is_object
    check (ask_when is null or jsonb_typeof(ask_when) = 'object')
);

create index test_protocols_test_idx on public.test_protocols (test_key, version desc);
-- Precies een actieve versie per test. Zonder dit kan het invoerscherm twee
-- "huidige" versies aanbieden en is niet te zeggen welke de behandelaar gebruikt
-- heeft.
create unique index test_protocols_current_idx on public.test_protocols (test_key)
  where retired_at is null;

comment on table public.test_protocols is
  'Versiegebonden uitvoeringsafspraak van een test. Onveranderlijk zodra hij bestaat; een herziening is version + 1. Zie de trigger protocols_immutable.';

-- Het slot eronder. Alleen retired_at mag bewegen.
--
-- Een afspraak dat niemand een protocol bewerkt is geen garantie; dit wel. De
-- vorm is dezelfde als field_proposals_append_only, met dat verschil dat hier
-- een kolom wel mag wijzigen: uitfaseren is geen herschrijving.
create or replace function private.protocol_only_retire()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'public.test_protocols is append-only: faseer uit met retired_at';
  end if;
  if to_jsonb(new) - 'retired_at' is distinct from to_jsonb(old) - 'retired_at' then
    raise exception 'public.test_protocols is onveranderlijk; maak versie % aan', old.version + 1;
  end if;
  return new;
end;
$$;

revoke execute on function private.protocol_only_retire() from public;

create trigger protocols_immutable
  before update or delete on public.test_protocols
  for each row execute function private.protocol_only_retire();

-- ── 3. Metrieken ──────────────────────────────────────────────────────────────
--
-- Verandert de eenheid, dan is dat per spec §10 een NIEUWE metriek en geen nieuw
-- label op dezelfde: "peak force in N" en "peak force in N/kg" zijn twee dingen,
-- en ze door elkaar laten lopen is precies de fout die de bronbestanden maken.

create table public.metric_definitions (
  key text primary key,          -- 'forceframe.hip_abduction.peak_force_n'
  test_key text references public.test_definitions (key) on delete restrict,
  kind public.metric_kind not null,
  label_nl text not null,
  label_en text not null,
  unit public.metric_unit not null,
  direction public.metric_direction not null,
  sort_order integer not null default 0,
  -- Toont de UI deze standaard, of alleen in drill-down? Spec §18: "Define which
  -- metrics from VALD are core KPIs per test; do not import every available
  -- variable into the main UI by default." ForceDecks levert er tientallen per
  -- sprong.
  is_core boolean not null default false,
  decimals integer not null default 1 check (decimals between 0 and 4),

  -- Meetruis. Spec §10 (MEDIUM): het systeem registreert nu geen typical error,
  -- CV, SEM of MDC, waardoor een trendalarm niet weet of een verschil echt is.
  -- Kolommen nu, leeg nu, zodat het later geen migratie is. Null betekent
  -- onbekend, en dan toont de UI geen interval in plaats van een verzonnen
  -- interval.
  typical_error numeric,
  mdc numeric,

  -- Een afgeleide metriek verwijst naar zijn definitie. Null voor raw.
  derived_key text,

  constraint metric_definitions_derived_has_formula check (
    (kind = 'derived') = (derived_key is not null)
  ),
  -- Een ruwe metriek hangt altijd aan een test; een afgeleide hoeft dat niet
  -- (een LSI over twee zijden hangt aan geen van beide).
  constraint metric_definitions_raw_has_test check (
    kind <> 'raw' or test_key is not null
  )
);

create index metric_definitions_test_idx on public.metric_definitions (test_key, sort_order);

-- ── 4. Referentieregels (spec §5, §6, §9) ─────────────────────────────────────
--
-- Versiegebonden, net als protocollen. Een cut-off die wijzigt is een nieuwe
-- versie en geen update. Zonder dat kan een rapport uit 2026 in 2028 opnieuw
-- gerenderd worden met andere banden eronder, en dat is precies de faalwijze
-- waar intake_reports.frozen_snapshot al voor bestaat.

create table public.reference_rules (
  id bigint generated always as identity primary key,
  rule_key text not null,        -- 'screening2025.passive_slr'
  version integer not null check (version >= 1),

  metric_key text not null references public.metric_definitions (key) on delete restrict,
  layer public.reference_layer not null,

  -- Null betekent: geldt voor elk protocol van deze test. Dat is zwakker en het
  -- hoort zichtbaar te zijn; zie protocol_confirmed op het protocol. Spec §6 zit
  -- vol regels waarvan het protocol niet vaststaat. Die mogen opgeslagen worden,
  -- ze mogen alleen niet automatisch classificeren.
  protocol_id uuid references public.test_protocols (id) on delete restrict,

  -- Populatie. Null is "elke". Spec §5 laag 2 en 3 eisen deze filters.
  sex public.athlete_sex,
  sport text,
  event text,
  competition_level text,
  age_min integer check (age_min is null or age_min >= 0),
  age_max integer check (age_max is null or age_max >= 0),

  -- De banden, als oplopende array van halfopen intervallen [gte, lt).
  --
  --   [{"status":"poor","score":0,"lt":75},
  --    {"status":"fair","score":1,"gte":75,"lt":80},
  --    {"status":"good","score":2,"gte":80,"lt":85},
  --    {"status":"excellent","score":3,"gte":85}]
  --
  -- Halfopen, altijd, als conventie van het schema en niet per regel. Dat
  -- beantwoordt de drie open randvragen uit spec §6 ("decide handling at exactly
  -- 1.0 cm", "Define exactly 60 degrees") in een keer voor alle regels tegelijk,
  -- in plaats van 25 keer afzonderlijk.
  --
  -- Waarom jsonb en niet lower_limit/upper_limit zoals spec §4 suggereert: twee
  -- kolommen kunnen een drempel uitdrukken, maar een 0-3-schaal wordt dan vier
  -- rijen zonder enige manier om af te dwingen dat die vier samen de hele
  -- getallenlijn dekken. Juist die volledigheid is wat spec §10 bij ASH mist.
  -- Een array is atomair te valideren.
  bands jsonb not null,

  -- 'gapped' is voor ASH I/Y/T, waar spec §6 letterlijk gaten heeft (<150, >180,
  -- >200 laat 150-180 ongedefinieerd). Een waarde in een gat levert
  -- 'unclassified' en nooit een buurband.
  coverage text not null default 'total' check (coverage in ('total', 'gapped')),

  -- De schakelaar waar dit ontwerp op draait. Spec §10 en §18.
  --
  -- Een regel mag bestaan en zichtbaar zijn zonder dat hij een atleet indeelt.
  -- 90-90, Thomas en ASH staan op false: de waarde wordt vastgelegd, de band
  -- blijft 'unclassified', en de rest van de screening loopt gewoon door.
  --
  -- Een kolom en geen code-pad, zodat aanzetten na bevestiging door de praktijk
  -- een datawijziging is en geen release.
  classification_enabled boolean not null default false,

  evidence public.evidence_quality not null,
  source_citation text,
  source_note text,

  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  retired_at timestamptz,

  constraint reference_rules_unique_version unique (rule_key, version),
  constraint reference_rules_bands_is_array check (jsonb_typeof(bands) = 'array'),
  constraint reference_rules_bands_not_empty check (jsonb_array_length(bands) > 0),
  constraint reference_rules_age_ordered check (
    age_min is null or age_max is null or age_max >= age_min
  ),
  -- Een gepubliceerde norm zonder citatie is geen gepubliceerde norm. Spec §10:
  -- "'Published value' without provenance is not sufficient."
  constraint reference_rules_published_has_citation check (
    evidence <> 'published' or source_citation is not null
  ),
  -- Een regel met gaten mag niet automatisch classificeren.
  constraint reference_rules_gapped_cannot_classify check (
    classification_enabled = false or coverage = 'total'
  ),
  -- De self-laag is geen regel maar een berekening tegen eigen historie. Hij
  -- komt niet in deze tabel; zie lib/screening/baseline.ts.
  constraint reference_rules_no_self_layer check (layer <> 'self')
);

create index reference_rules_lookup_idx
  on public.reference_rules (metric_key, layer) where retired_at is null;
create index reference_rules_protocol_idx on public.reference_rules (protocol_id);

-- ── 5. RLS ────────────────────────────────────────────────────────────────────
--
-- De bibliotheek is leesbaar voor elke ingelogde gebruiker, net als
-- field_definitions: het invoerscherm heeft labels, eenheden en bandlegenda's
-- nodig. Schrijven loopt via migraties, seeds en route handlers, nooit uit de
-- browser.

alter table public.test_definitions           enable row level security;
alter table public.test_protocols             enable row level security;
alter table public.metric_definitions         enable row level security;
alter table public.reference_rules            enable row level security;

create policy test_definitions_select on public.test_definitions
  for select to authenticated using (true);
create policy test_protocols_select on public.test_protocols
  for select to authenticated using (true);
create policy metric_definitions_select on public.metric_definitions
  for select to authenticated using (true);
create policy reference_rules_select on public.reference_rules
  for select to authenticated using (true);

-- ── 6. Rechten ────────────────────────────────────────────────────────────────
--
-- 20260902110000_grants.sql zegt het expliciet: nieuwe tabellen in public erven
-- dit patroon met opzet niet, wie er een toevoegt schrijft de grants erbij.

grant select on
  public.test_definitions,
  public.test_protocols,
  public.metric_definitions,
  public.reference_rules
  to authenticated;

grant select, insert, update, delete on
  public.test_definitions,
  public.test_protocols,
  public.metric_definitions,
  public.reference_rules
  to service_role;
grant usage, select on all sequences in schema public to service_role;

-- De serverrol voor het medical-schema leest de bibliotheek om metingen af te
-- leiden en te classificeren. Alleen lezen: schrijven loopt via service_role.
grant select on
  public.test_definitions,
  public.test_protocols,
  public.metric_definitions,
  public.reference_rules
  to intake_server;

-- ── 7. Audit ──────────────────────────────────────────────────────────────────
--
-- FR-17 eist een spoor over edits, imports EN wijzigingen in referentieregels.
-- Die laatste is de reden dat deze twee tabellen een trigger krijgen terwijl de
-- rest van de bibliotheek er geen heeft: een gewijzigde cut-off verandert hoe
-- atleten ingedeeld worden, en dat hoort navolgbaar te zijn.

create trigger audit_test_protocols
  after insert or update or delete on public.test_protocols
  for each row execute function private.audit_row();

create trigger audit_reference_rules
  after insert or update or delete on public.reference_rules
  for each row execute function private.audit_row();
