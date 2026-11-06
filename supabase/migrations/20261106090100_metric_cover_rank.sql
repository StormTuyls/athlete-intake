-- Welke vijf cijfers op de kaft van het rapport komen.
--
-- Die keuze is van de praktijk en niet van de code: welke meting een screening
-- samenvat kan per seizoen verschuiven, en een deploy hoort daar niet voor
-- nodig te zijn. Vandaar een kolom en geen constante.
--
-- Niet is_core hergebruikt, al staat die er en doet hij niets: 'core' leest als
-- 'hoort bij de kern van de bibliotheek', niet als 'staat op de voorpagina', en
-- hij staat nu op alle 26 metrieken aan. Ook niet sort_order, want die heeft al
-- werk: hij ordent de metrieken binnen een test.
--
-- Null is het normale geval. Een getal is de plek op de kaft, van boven naar
-- beneden.
alter table public.metric_definitions
  add column cover_rank integer;

comment on column public.metric_definitions.cover_rank is
  'Plek op pagina 1 van het screeningrapport, van 1 af. Null betekent: wel in '
  'het rapport, niet op de kaft. De praktijk stelt dit in; de code leest het '
  'alleen.';

create unique index metric_definitions_cover_rank_key
  on public.metric_definitions (cover_rank)
  where cover_rank is not null;

-- Een beginkeuze, geen besluit. De drie isometrische duwtests zijn de enige
-- cijfers in de bibliotheek die kracht in een getal uitdrukken en over sessies
-- heen te vergelijken zijn; de twee bewegingsscores vatten samen wat de
-- behandelaar zag. Wie dit anders wil, zet er andere nummers in.
update public.metric_definitions set cover_rank = 1 where key = 'forcedecks.knee_iso_push.value';
update public.metric_definitions set cover_rank = 2 where key = 'forcedecks.hip_iso_push.value';
update public.metric_definitions set cover_rank = 3 where key = 'forcedecks.ankle_iso_push.value';
update public.metric_definitions set cover_rank = 4 where key = 'movement_ll.overhead_deep_squat.value';
update public.metric_definitions set cover_rank = 5 where key = 'movement_ll.lateral_step_down.value';
