-- Enums voor de screeningsmodule (fase 2).
--
-- public.body_side wordt hergebruikt: een meting heeft dezelfde zijdebegrippen
-- als een blessure, en een tweede zijde-enum naast de eerste is precies hoe
-- 'left' en 'links' naast elkaar in een databank terechtkomen.

-- ── Eenheden ──────────────────────────────────────────────────────────────────
--
-- Een enum en geen vrije tekst. Spec §10 noemt dit met zoveel woorden een
-- HIGH-gap: "N/kg, xBW and 'system weight' are mixed. These must be three
-- explicit metric definitions, never interchangeable labels."
--
-- Met vrije tekst zijn 'N/kg', 'N kg-1' en 'Nkg' drie eenheden die de motor
-- voor dezelfde aanziet, of erger, voor verschillende. Met een enum is een
-- typefout een insert die faalt.
--
-- n_per_kg en xbw staan er allebei in, en dat is het hele punt: ze schelen een
-- factor 9,80665 en in de bronsheets zijn ze door elkaar gehaald.
create type public.metric_unit as enum (
  'n',            -- newton
  'n_per_kg',     -- newton per kilogram lichaamsmassa
  'xbw',          -- veelvoud van lichaamsgewicht (massa x 9.80665), dimensieloos
  'nm',
  'nm_per_kg',
  'deg', 'cm', 'mm', 'm',
  's', 'ms',
  'm_per_s',      -- RSI, RSI-mod
  'w',            -- vermogen
  'n_per_s',      -- RFD
  'kg',
  'reps', 'count',
  'ratio',        -- dimensieloze verhouding (ADD:ABD, H:Q, EUR, DSI)
  'percent',      -- LSI, asymmetrie, procentuele verandering
  'score',        -- ordinale bronscore, 0-3 of 0-1
  'hand_lengths'  -- Apley, spec §6. Bestaat echt en is geen lengte-eenheid.
);

-- ── Richting ──────────────────────────────────────────────────────────────────
--
-- Spec §8 is expliciet dat de verkeerde richting op een tijdmetriek een fout is
-- en geen smaak: "Avoid using the higher-is-better formula on time."
--
-- target_range staat apart omdat genu recurvatum (spec §6: 1 bij 0-10 graden,
-- 0 bij <0 of >10) aan twee kanten slechter wordt. Dat in higher_better persen
-- levert een band op die bovenaan onbegrensd doorloopt.
--
-- neutral is voor metrieken die beschrijven en niet beoordelen: totale
-- schouderrotatie, IR:ER-verdeling. Die hebben geen goede kant, alleen een
-- trend. Zonder deze waarde moet iemand er een richting op verzinnen.
create type public.metric_direction as enum (
  'higher_better', 'lower_better', 'target_range', 'neutral'
);

create type public.metric_kind as enum ('raw', 'derived');

-- ── Referentielagen ───────────────────────────────────────────────────────────
--
-- De vier lagen uit spec §5. Als enum, zodat een vijfde laag een migratie is en
-- geen tekstwaarde die ergens in een seed ontstaat.
create type public.reference_layer as enum (
  'self',            -- 1. baseline, PB, vorige test. Levert een delta, nooit een band.
  'published',       -- 3. peer-reviewed of klinisch gebruikte drempel
  'internal_target'  -- 4. streefgetal van de praktijk, nooit als wetenschap tonen
);

-- Laag 2 (cohortpercentielen) staat hier NIET in. Die hoort bij fase 4 en de
-- praktijk heeft er de aantallen niet voor; spec §10 noemt percentielen over een
-- klein cohort actief schadelijk. Een enumwaarde toevoegen is later een
-- eenregelige migratie, een ongebruikte waarde verwijderen niet.

-- Hoe hard de herkomst van een regel is. Spec §10 eist provenance per cut-off.
-- Dit onderscheidt "uit de bronsheet, protocol onbevestigd" van "peer-reviewed
-- norm voor deze populatie en dit protocol".
create type public.evidence_quality as enum (
  'source_sheet',   -- uit de Screening 2025-bestanden, protocol onbevestigd
  'published',      -- peer-reviewed, met citatie
  'internal'        -- operationeel doel van de staf (spec §9)
);

-- Welke proef de representatieve waarde levert. FR-04.
create type public.trial_selection as enum (
  'single', 'best', 'mean', 'median', 'last'
);

-- ── Waarom een waarde er niet is ──────────────────────────────────────────────
--
-- Spec §12.1: "A metric can be unavailable rather than zero. Missing data and
-- true zero are different states."
--
-- Een enum en geen vrije tekst, omdat het scherm per reden iets anders moet
-- zeggen: 'single_side_only' is een actie voor de tester, 'classification_disabled'
-- is een beslissing van de praktijk, en 'no_rule_for_protocol' is een gat in de
-- seed. Drie keer "geen waarde" met drie verschillende vervolgstappen.
create type public.unavailable_reason as enum (
  'missing_input',
  'zero_denominator',
  'single_side_only',
  'protocol_mismatch',
  'unit_mismatch',
  'no_body_mass',
  'classification_disabled',
  'no_rule_for_protocol',
  'no_baseline'
);

create type public.note_severity as enum ('info', 'watch', 'action');
create type public.note_state as enum ('open', 'resolved');

-- Geslacht als meetvariabele voor referentiefilters (spec §5), niet als
-- identiteit. 'unspecified' is de default, zodat de kolom nooit een antwoord
-- afdwingt dat de atleet niet gegeven heeft.
create type public.athlete_sex as enum ('female', 'male', 'unspecified');

create type public.season_phase as enum (
  'off_season', 'pre_season', 'in_season', 'transition', 'unknown'
);
