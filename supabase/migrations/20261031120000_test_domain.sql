-- Welke batterij een test is: klinische screening of performancediagnostiek.
--
-- Zie docs/change-request-testbibliotheek.md §2a in athlete-intake.
--
-- test_definitions.block onderscheidt vandaag anthropometry, mobility_ll,
-- mobility_ul, core, movement_ll, forcedecks en strength_ul. Dat zijn
-- onderwerpen, geen batterijen: forcedecks hoort bij de toestellen en core bij
-- de hand, maar dat staat nergens. Het invoerscherm moet die twee groepen
-- kunnen scheiden, want bij de ene hoort een importknop en bij de andere niet.
--
-- Een enum en geen text + check, anders dan laterality en block ernaast. Die
-- twee zijn lijsten die bij de seed horen en door een test bewaakt worden; deze
-- kolom heeft twee waarden en krijgt er geen derde bij. Twee schrijfwijzen van
-- hetzelfde zijn hier erger dan geen kolom.
create type public.test_domain as enum ('clinical', 'performance');

alter table public.test_definitions
  add column domain public.test_domain not null default 'clinical';

-- De default heeft zijn werk gedaan: de bestaande rijen zijn klinisch. Weg
-- ermee, zodat een nieuwe test de keuze moet maken. Een performancetest die
-- stilletjes als klinisch binnenkomt, landt in het verkeerde scherm en onder de
-- verkeerde verantwoording.
alter table public.test_definitions
  alter column domain drop default;

comment on column public.test_definitions.domain is
  'Klinische screening of performancebatterij. Bepaalt het scherm en de verwachte herkomst van de banden.';
