-- Waar een afgeleide metriek haar invoer vandaan haalt.
--
-- Zie docs/change-request-testbibliotheek.md §6.2 in athlete-intake.
--
-- metric_definitions.derived_key zegt WELKE formule, niet waar de invoer vandaan
-- komt. Voor LSI en asymmetrie hoefde dat niet: die nemen links en rechts van
-- dezelfde metriek. Voor per_body_mass en per_body_weight wel, en "de ruwe
-- metriek van dezelfde test" is geen antwoord: de ankle iso-push heeft er drie
-- (piekkracht, kracht op 100 ms, RFD) en alleen de eerste hoort genormaliseerd
-- te worden.
alter table public.metric_definitions
  add column derived_from_key text
    references public.metric_definitions (key) on delete restrict;

alter table public.metric_definitions
  add constraint metric_definitions_derived_from_is_derived check (
    derived_from_key is null or kind = 'derived'
  );

-- Een metriek die uit zichzelf volgt is een lus, geen formule.
alter table public.metric_definitions
  add constraint metric_definitions_derived_from_not_self check (
    derived_from_key is null or derived_from_key <> key
  );

-- De twee normalisaties kunnen niet zonder bron. De motor zou er anders een
-- rij voor aanmaken die altijd op unavailable staat, en dat leest als een
-- ontbrekende meting terwijl het een ontbrekende definitie is.
alter table public.metric_definitions
  add constraint metric_definitions_normalised_has_source check (
    derived_key is null
    or derived_key not in ('per_body_mass', 'per_body_weight')
    or derived_from_key is not null
  );

comment on column public.metric_definitions.derived_from_key is
  'De metriek die als invoer dient. Verplicht bij per_body_mass en per_body_weight.';
