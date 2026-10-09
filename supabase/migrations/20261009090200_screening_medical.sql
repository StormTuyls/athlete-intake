-- De screeningsgegevens zelf. Bijzondere categorie persoonsgegevens.
--
-- De oude medical.test_sessions en test_measurements uit 20260902090200 waren
-- een plaatshouder voor deze module. Ze worden in de volgende migratie
-- verwijderd, nadat purge_athlete() omgezet is.
--
-- Waarom vervangen en niet uitbreiden: de stub heeft een intake_id (een
-- screening hangt aan een atleet, niet aan een intakegesprek) en een vrije-tekst
-- kolom `protocol` waar nu een foreign key naar een versie hoort. Die twee
-- kolommen blijven anders eeuwig meelopen als dode vorm. Er valt niets te
-- migreren: er bestaat geen schrijfpad naar die tabellen, alleen het
-- verwijderpad en zijn test raakten ze.
--
-- De laagindeling:
--   screening_sessions  wanneer, door wie, in welke context
--   test_items          een test binnen die sessie, in een protocolversie, per zijde
--   test_trials         elke poging, geldig of niet
--   trial_values        de ruwe getallen per poging (een CMJ-poging levert er meerdere)
--   measurements        de representatieve waarde, gekozen volgens de protocolregel
--   derived_results     alles wat berekend is, met formule- en regelversie erin

-- ── 1. De sessie ──────────────────────────────────────────────────────────────

create table medical.screening_sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,

  -- timestamptz en apart de lokale datum. Spec §12.1: "Time zones and local
  -- test/session time must be preserved." Een ochtendtest en een avondtest op
  -- dezelfde dag zijn niet uitwisselbaar, en bij een testkamp in een andere
  -- tijdzone schuift een kale date-kolom de meting een dag op.
  occurred_at timestamptz not null,
  occurred_on date not null,

  tester_profile_id uuid references public.profiles (id) on delete set null,
  season_phase public.season_phase not null default 'unknown',
  -- Vrije tekst en geen enum: dit is klinische context ("derde week opbouw na
  -- enkelverstuiking"), geen categorie waarop gefilterd wordt.
  injury_status text,
  readiness_note text,
  notes text,

  -- Lichaamsmassa en lengte van die dag, GEKOPIEERD en niet gejoind.
  --
  -- Spec §8 zegt dat relatieve kracht de lichaamsmassa van dezelfde dag
  -- gebruikt. Een join naar public.athletes zou betekenen dat elke historische
  -- N/kg-waarde stilletjes verandert zodra de atleet opnieuw gewogen wordt.
  -- Niemand ziet dat gebeuren en elke oude grafiek klopt daarna niet meer.
  -- Zelfde redenering als consents.consent_version: wat gold op dat moment.
  body_mass_kg numeric check (body_mass_kg is null or body_mass_kg > 0),
  body_height_cm numeric check (body_height_cm is null or body_height_cm > 0),

  source_document_id uuid references medical.documents (id) on delete set null,

  -- Herkomst, in dezelfde vorm voor handmatig, CSV en een latere API. Spec §12.1
  -- eist source_system, source_record_id, oorspronkelijk tijdstip en
  -- importtijdstip op elke externe observatie.
  --
  -- Staat er nu al in terwijl fase 1 alleen handmatige invoer en CSV kent: dit
  -- is precies wat een VALD-adapter later nodig heeft, en nu toevoegen kost
  -- niets.
  source_system text not null default 'manual',
  source_record_id text,
  source_recorded_at timestamptz,
  imported_at timestamptz,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

-- Idempotente import. FR-11 en spec §12.1: "re-syncing the same VALD item must
-- update or ignore it, not create duplicates." Werkt identiek voor CSV en API,
-- dus de adapter die later komt vraagt geen schemawijziging. Partieel, want
-- handmatige sessies hebben geen bronrecord.
create unique index screening_sessions_source_key
  on medical.screening_sessions (source_system, source_record_id)
  where source_record_id is not null;

create index screening_sessions_athlete_idx
  on medical.screening_sessions (athlete_id, occurred_at desc);
create index screening_sessions_document_idx
  on medical.screening_sessions (source_document_id);
create index screening_sessions_tester_idx on medical.screening_sessions (tester_profile_id);
create index screening_sessions_created_by_idx on medical.screening_sessions (created_by);

-- ── 2. Een test binnen de sessie ──────────────────────────────────────────────
--
-- Het niveau dat in de stub ontbrak en zonder welke protocolversionering niet
-- bestaat. Een rij per (sessie x protocolversie x zijde). Dit is ook wat een
-- kaart op het scherm is: "heupabductie links, ForceFrame v2, 310 N, beste van 3".
--
-- Afgewezen alternatief: protocol_id op de proef zetten en deze tabel overslaan.
-- Dan is er geen plek voor de aangedane zijde, geen plek voor een afwijking van
-- het protocol, en geen integriteit tussen de proeven en de meting van dezelfde
-- test.

create table medical.test_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references medical.screening_sessions (id) on delete cascade,
  -- restrict en geen cascade: een protocol wordt uitgefaseerd, nooit verwijderd
  -- (de trigger protocols_immutable verbiedt delete). Stond hier cascade, dan
  -- zou het opruimen van een verkeerd ingevoerd protocol stilletjes metingen van
  -- atleten meenemen.
  protocol_id uuid not null references public.test_protocols (id) on delete restrict,
  side public.body_side not null default 'bilateral',

  -- Welke zijde aangedaan is, voor de involved/uninvolved-conventie van LSI.
  -- Null betekent onbekend; dan valt de motor terug op weaker/stronger EN legt
  -- vast dat hij dat deed. Nooit stil gokken. Spec §8: "Store which convention
  -- was used."
  involved_side public.body_side,

  trial_selection public.trial_selection not null default 'single',
  external_load_kg numeric,     -- afwijking van het protocol, als die er is
  notes text,

  created_at timestamptz not null default now(),

  constraint test_items_unique_side unique (session_id, protocol_id, side)
);

create index test_items_session_idx on medical.test_items (session_id);
create index test_items_protocol_idx on medical.test_items (protocol_id);

-- ── 3. Proeven ────────────────────────────────────────────────────────────────
--
-- FR-04 en spec §4: meerdere pogingen bewaren, met geldigheid en een
-- uitsluitingsreden, en volgens het protocol de beste, de gemiddelde of de
-- mediaan kiezen.
--
-- Waarom een eigen tabel en geen array op de meting: een ongeldige poging met
-- een reden ("atleet gleed weg") is informatie die een behandelaar wil zien, en
-- in een array is ze niet te bevragen, niet te tellen en niet te auditen.

create table medical.test_trials (
  id bigint generated always as identity primary key,
  test_item_id uuid not null references medical.test_items (id) on delete cascade,
  trial_number integer not null check (trial_number >= 1),
  valid boolean not null default true,
  exclusion_reason text,
  source_record_id text,
  created_at timestamptz not null default now(),

  constraint test_trials_unique_number unique (test_item_id, trial_number),
  -- Een ongeldige proef zonder reden is een proef die niemand later kan
  -- beoordelen. Spec §4 noemt exclusion_reason niet voor niets naast validity.
  constraint test_trials_invalid_has_reason check (
    valid or exclusion_reason is not null
  ),
  constraint test_trials_valid_has_no_reason check (
    not valid or exclusion_reason is null
  )
);

create index test_trials_item_idx on medical.test_trials (test_item_id);

-- De ruwe waarden per proef. Een CMJ-proef levert sprunghoogte EN time to
-- take-off EN piekkracht: een proef is dus geen waarde.
create table medical.trial_values (
  test_trial_id bigint not null references medical.test_trials (id) on delete cascade,
  metric_key text not null references public.metric_definitions (key) on delete restrict,
  value numeric not null,
  constraint trial_values_pk primary key (test_trial_id, metric_key)
);

create index trial_values_metric_idx on medical.trial_values (metric_key);

-- ── 4. De representatieve meting ──────────────────────────────────────────────
--
-- Apart van trial_values en niet als "de proef met een vlag erop". Dat is
-- dezelfde splitsing als field_proposals/dossier_fields: wat aangeleverd is
-- versus wat eruit volgt. In een tabel persen maakt "precies een geldige waarde
-- per metriek per test" een afspraak die de databank niet kent.

create table medical.measurements (
  -- Surrogaatsleutel, en niet alleen de natuurlijke (test_item_id, metric_key).
  --
  -- private.audit_row() lost de entiteit op als coalesce(id, intake_id). Een
  -- tabel met een samengestelde sleutel en geen van beide kolommen levert daar
  -- een auditregel op met entity_id null: je ziet DAT er een meting wijzigde,
  -- niet welke. Dat is een spoor dat precies ophoudt waar je het nodig hebt.
  --
  -- dossier_fields heeft hetzelfde probleem maar valt terug op intake_id; hier
  -- bestaat die uitweg niet. Een uuid kost niets en houdt de trigger generiek.
  id uuid primary key default gen_random_uuid(),
  test_item_id uuid not null references medical.test_items (id) on delete cascade,
  metric_key text not null references public.metric_definitions (key) on delete restrict,

  -- NULLABLE, en dat is een inhoudelijke keuze.
  --
  -- Spec §12.1: "A metric can be unavailable rather than zero. Missing data and
  -- true zero are different states." Een rij met value null betekent: deze
  -- metriek hoorde bij deze test en is NIET gemeten. Geen rij betekent: er is
  -- niets over te zeggen. Een 0 betekent een gemeten nul.
  --
  -- Daarom geen default. Een default 0 zou alle drie de toestanden in een getal
  -- pletten.
  value numeric,
  unavailable_reason public.unavailable_reason,

  selection public.trial_selection not null default 'single',
  selected_trial_id bigint references medical.test_trials (id) on delete set null,
  -- Rechtstreeks ingevoerd zonder proeven (micro-entry, of een waarde uit een
  -- verslag). Dan is er geen proef om naar te wijzen en is dat geen gebrek.
  entered_directly boolean not null default false,

  entered_by uuid references public.profiles (id) on delete set null,
  entered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Nog steeds exact een rij per metriek per test; dat is de echte sleutel.
  constraint measurements_unique_metric unique (test_item_id, metric_key),
  -- Een waarde en een reden waarom er geen waarde is, kunnen niet allebei.
  constraint measurements_value_xor_reason check (
    value is null or unavailable_reason is null
  )
);

create index measurements_metric_idx on medical.measurements (metric_key);
create index measurements_trial_idx on medical.measurements (selected_trial_id);
create index measurements_entered_by_idx on medical.measurements (entered_by);

comment on column medical.measurements.value is
  'Null betekent: hoorde bij deze test, niet gemeten. Nul betekent: gemeten nul. Spec §12.1 eist dat dit twee toestanden zijn.';

-- ── 5. Afgeleide resultaten ───────────────────────────────────────────────────
--
-- Een cache die bij elke herberekening opnieuw geschreven wordt, met de
-- VERSIENUMMERS van de formule en de regel erin vastgezet.
--
-- Waarom gematerialiseerd en niet op leesmoment berekend: spec §8 eist dat
-- historische berekeningen reproduceerbaar blijven, en referentieregels
-- veranderen. Zou dit op leesmoment gebeuren, dan toont een rapport dat volgend
-- jaar opnieuw geprint wordt een andere statusband onder hetzelfde getal, zonder
-- dat ergens staat waarom. Dat is precies de faalwijze waar
-- intake_reports.frozen_snapshot al voor gebouwd is.
--
-- Waarom toch een cache en geen onveranderlijke vastlegging: spec §10 voorspelt
-- een bug met naam (de bronbestanden noemen CMJ-RSI waar RSI-mod bedoeld is).
-- Zonder herberekening zit die fout voor altijd in de historie. De combinatie,
-- herberekenbaar maar met de versies op de rij, geeft allebei: herijken tegen de
-- huidige referenties is een expliciete handeling en nooit een stil gevolg.

create table medical.derived_results (
  id bigint generated always as identity primary key,
  session_id uuid not null
    references medical.screening_sessions (id) on delete cascade,
  -- Null voor resultaten die twee zijden combineren (LSI, asymmetrie): die horen
  -- bij geen van beide items.
  test_item_id uuid references medical.test_items (id) on delete cascade,
  metric_key text not null references public.metric_definitions (key) on delete restrict,

  value numeric,
  unit public.metric_unit not null,
  status text not null check (status in ('computed', 'unavailable')),
  unavailable_reason public.unavailable_reason,

  -- Reproduceerbaarheid. Spec §18: "store formula version so historic
  -- calculations remain reproducible."
  -- Sleutel in de formulecatalogus van lib/screening/derive.ts. Geen foreign
  -- key: de formules zijn code en geen rijen. Gevalideerd bij het laden.
  derived_key text,
  derived_version integer,
  engine_version integer not null,

  -- De regel waartegen geclassificeerd is, als exacte VERSIE (de id, niet de
  -- rule_key). Een latere cut-offwijziging raakt deze rij niet.
  reference_rule_id bigint references public.reference_rules (id) on delete restrict,
  reference_layer public.reference_layer,
  band_status text,
  band_score smallint check (band_score is null or band_score between 0 and 3),

  -- Wat erin ging. Spec §11: "For ratios, show both numerator and denominator
  -- next to the ratio. A 'good' ratio can otherwise hide two poor absolute
  -- values." Een asymmetrie van 17% zegt niets zonder te weten of dat 70 en 84
  -- is of 7 en 8,4, en al helemaal niet welke kant lager is.
  --
  -- Dit is ook de plek waar de RICHTING van een asymmetrie vandaan komt. Die
  -- hoort niet in band_status: een band zonder regel is een kleur zonder
  -- onderbouwing, en derived_band_needs_rule hieronder verbiedt dat terecht.
  inputs jsonb not null default '{}'::jsonb,

  -- Divergentie tussen referentielagen staat hier NIET. Spec §3E vraagt erom,
  -- maar er is op dit moment maar een classificerende laag: cohortpercentielen
  -- horen bij fase 4 en interne streefwaarden zijn nog niet geseed. Twee
  -- kolommen die niemand vult zijn geen voorbereiding maar ruis, en een kolom
  -- toevoegen is later een eenregelige migratie.

  computed_at timestamptz not null default now(),

  -- Uniciteit loopt OOK over derived_key, want een metriek levert meerdere
  -- uitkomsten op: de ruwe waarde (derived_key null), de asymmetrie, en de
  -- verandering tegenover de vorige sessie. Zonder die kolom erin zou de tweede
  -- uitkomst van dezelfde metriek de eerste verdringen.
  --
  -- Zie de unieke index derived_unique_metric_idx onder deze tabel: een
  -- constraint kan geen coalesce, en zonder dat zouden twee ruwe waarden
  -- (derived_key null) naast elkaar mogen bestaan.
  constraint derived_unavailable_has_no_value check (
    status <> 'unavailable' or (value is null and unavailable_reason is not null)
  ),
  constraint derived_computed_has_value check (
    status <> 'computed' or value is not null
  ),
  -- Een band zonder de regel die hem gaf is een kleur zonder onderbouwing.
  constraint derived_band_needs_rule check (
    band_status is null or reference_rule_id is not null
  )
);

-- Een rij per (sessie, test, metriek, soort uitkomst). coalesce omdat null in
-- een unieke index per rij verschillend is, en twee ruwe waarden van dezelfde
-- metriek binnen een test juist NIET mogen.
create unique index derived_unique_metric_idx on medical.derived_results
  (session_id, test_item_id, metric_key, coalesce(derived_key, ''));

create index derived_results_session_idx on medical.derived_results (session_id);
create index derived_results_item_idx on medical.derived_results (test_item_id);
create index derived_results_metric_idx
  on medical.derived_results (metric_key, computed_at desc);
create index derived_results_rule_idx on medical.derived_results (reference_rule_id);

-- ── 6. Opmerkingen en vlaggen (FR-13, spec §4) ────────────────────────────────

create table medical.screening_notes (
  id bigint generated always as identity primary key,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  session_id uuid references medical.screening_sessions (id) on delete cascade,
  test_item_id uuid references medical.test_items (id) on delete cascade,
  metric_key text references public.metric_definitions (key) on delete restrict,

  author_profile_id uuid references public.profiles (id) on delete set null,
  severity public.note_severity not null default 'info',
  state public.note_state not null default 'open',
  body text not null check (length(btrim(body)) > 0),
  action text,

  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,

  -- Spec §14: een klacht blijft actief tot iemand hem expliciet sluit.
  constraint screening_notes_resolution_complete check (
    (state = 'open' and resolved_at is null and resolved_by is null)
    or (state = 'resolved' and resolved_at is not null and resolved_by is not null)
  ),
  -- Een opmerking over een metriek zonder test slaat nergens op.
  constraint screening_notes_metric_needs_context check (
    metric_key is null or test_item_id is not null or session_id is not null
  )
);

create index screening_notes_athlete_idx
  on medical.screening_notes (athlete_id, created_at desc);
create index screening_notes_open_idx on medical.screening_notes (athlete_id)
  where state = 'open';
create index screening_notes_session_idx on medical.screening_notes (session_id);
create index screening_notes_item_idx on medical.screening_notes (test_item_id);
create index screening_notes_author_idx on medical.screening_notes (author_profile_id);
create index screening_notes_resolved_by_idx on medical.screening_notes (resolved_by);
create index screening_notes_metric_idx on medical.screening_notes (metric_key);

-- ── 7. Ruwe import ────────────────────────────────────────────────────────────
--
-- Spec §10 (MEDIUM): "Derived ForceDecks numbers alone limit future reanalysis.
-- At minimum retain raw-file/API identifier."
--
-- Apart van test_trials zodat de proeftabel klein blijft en de ruwe blob als
-- geheel te wissen is bij een purge.

create table medical.test_imports (
  id bigint generated always as identity primary key,
  session_id uuid not null
    references medical.screening_sessions (id) on delete cascade,
  source_system text not null,
  source_record_id text,
  source_document_id uuid references medical.documents (id) on delete set null,
  payload jsonb not null,
  imported_at timestamptz not null default now()
);

create index test_imports_session_idx on medical.test_imports (session_id);
create index test_imports_document_idx on medical.test_imports (source_document_id);

-- ── 8. Bevroren screeningrapport ──────────────────────────────────────────────
--
-- Zelfde machinerie en zelfde reden als medical.intake_reports: een rapport mag
-- niet onder de handen van de behandelaar veranderen.
--
-- Een eigen tabel en niet intake_reports erbij, omdat een screening aan een
-- ATLEET hangt en niet aan een intake. FR-03 laat micro-entry toe zonder dat er
-- een intakegesprek loopt.

create table medical.screening_reports (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  session_id uuid references medical.screening_sessions (id) on delete set null,
  version integer not null check (version >= 1),
  content_hash text not null,
  storage_path text,
  frozen_snapshot jsonb not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles (id) on delete set null,

  constraint screening_reports_unique_version unique (athlete_id, version)
);

create index screening_reports_session_idx on medical.screening_reports (session_id);
create index screening_reports_generated_by_idx on medical.screening_reports (generated_by);

-- ── 9. RLS ────────────────────────────────────────────────────────────────────
--
-- Zelfde regime als de rest van medical: RLS aan, nul policies. De browser komt
-- hier per constructie niet, want het schema staat niet in config.toml onder
-- [api].schemas. De server leest als intake_server, die bypassrls heeft.
--
-- Grants zijn niet nodig: 20260902110000 heeft
-- `alter default privileges in schema medical` gezet, en 20260908150000 heeft
-- delete er weer af gehaald zodat purge_athlete() de enige route naar een delete
-- blijft.

alter table medical.screening_sessions enable row level security;
alter table medical.test_items         enable row level security;
alter table medical.test_trials        enable row level security;
alter table medical.trial_values       enable row level security;
alter table medical.measurements       enable row level security;
alter table medical.derived_results    enable row level security;
alter table medical.screening_notes    enable row level security;
alter table medical.test_imports       enable row level security;
alter table medical.screening_reports  enable row level security;

-- ── 10. Audit ─────────────────────────────────────────────────────────────────

create trigger audit_screening_sessions
  after insert or update or delete on medical.screening_sessions
  for each row execute function private.audit_row();

create trigger audit_test_items
  after insert or update or delete on medical.test_items
  for each row execute function private.audit_row();

create trigger audit_measurements
  after insert or update or delete on medical.measurements
  for each row execute function private.audit_row();

create trigger audit_screening_notes
  after insert or update or delete on medical.screening_notes
  for each row execute function private.audit_row();

create trigger audit_test_imports
  after insert or update or delete on medical.test_imports
  for each row execute function private.audit_row();

create trigger audit_screening_reports
  after insert or update or delete on medical.screening_reports
  for each row execute function private.audit_row();

-- Met opzet GEEN trigger op derived_results en trial_values.
--
-- derived_results wordt bij elke herberekening geschreven; een rijtrigger daar
-- herhaalt exact het probleem dat saveDossier in lib/db/medical.ts al eens
-- opleverde: 41 auditregels per keer dat iemand een dossier opende begroeven het
-- echte spoor onder ruis. trial_values hangt een-op-een aan test_trials en wordt
-- met de proef meegeschreven. De schrijfacties die ertoe doen, de meting en de
-- sessie, zijn wel gelogd.
