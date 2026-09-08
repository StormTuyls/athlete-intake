-- Welke velden een terugkerende atleet niet opnieuw hoeft te vertellen.
--
-- Bij een tweede intake stelde het gesprek alle identiteitsvragen opnieuw: naam,
-- geboortedatum, sport, club, federatie. Dat is precies het handwerk dat dit
-- systeem moet weghalen, en het geeft de atleet het gevoel dat er niet naar hem
-- geluisterd is.
--
-- Wat de vlag WEL betekent: dit veld mag als "bekend van vorige keer" aan de
-- atleet voorgelegd worden ter bevestiging.
--
-- Wat de vlag NIET betekent: automatisch overnemen. Een waarde uit een vorige
-- intake is geen uitspraak over vandaag, en een dossierveld dat niemand deze
-- keer bevestigd heeft ondermijnt de hele opzet: elke waarde in het dossier is
-- door een mens of een geverifieerd citaat gedekt. De carry-forward levert dus
-- een vraag op, geen voorstel. Zie lib/intake/carryForward.ts.
--
-- Geen taxonomiewijziging: er komt geen veld bij en geen sleutel verandert. Dit
-- is gedrag van bestaande velden, en het hoort bij `required` en `is_medical` in
-- dezelfde tabel, zodat de praktijk het kan bijstellen zonder deploy.

alter table public.field_definitions
  add column if not exists carry_forward boolean not null default false;

comment on column public.field_definitions.carry_forward is
  'Mag bij een volgende intake als bekend-van-vorige-keer ter bevestiging worden voorgelegd. Nooit automatisch overgenomen.';

-- Alleen wat over maanden niet verandert, en alleen niet-medisch.
--
-- Gewicht staat er met opzet niet bij: dat verandert, en het is klinisch juist
-- op het moment van de intake relevant. Lengte wel: die verandert bij een
-- junior nog, maar de atleet krijgt hem ter bevestiging te zien en niet als
-- feit. Medische velden blijven er in deze eerste stap buiten, ook de stabiele:
-- een openingsbericht dat de medische historiek opsomt is een ander gesprek dan
-- "kloppen je contactgegevens nog".
--
-- Deze lijst staat ook in supabase/seed.sql, want een `db reset` voert eerst de
-- migraties uit en daarna de seed. Ze horen gelijk te blijven.
update public.field_definitions
   set carry_forward = true
 where key in (
   'identity.full_name',
   'identity.date_of_birth',
   'identity.email',
   'identity.phone',
   'identity.sport',
   'identity.discipline',
   'identity.club',
   'identity.federation',
   'identity.coach_name',
   'biometrics.height_cm',
   'biometrics.dominant_side'
 );
