-- Identiteit komt uit het profiel, niet uit het gesprek.
--
-- Naam, geboortedatum, sport, club: dat verandert zo goed als nooit. Het in een
-- gesprek uitvragen kost negen beurten, elke keer opnieuw, voor gegevens die de
-- praktijk na de eerste keer al heeft. Een formulier met acht invulvakjes is
-- daar het juiste gereedschap voor; een chat niet.
--
-- De richting draait dus om. Tot nu liep het intake -> dossier -> atleetpagina:
-- de coachpagina toonde sport en club uit het DOSSIER van een intake. Vanaf nu
-- loopt het profiel -> dossier, en is het profiel de bron.

-- 1. Welke velden uit het profiel komen.
--
-- Een eigen kolom en geen vierde waarde op `tier`. Tier is een lijn: core,
-- standard, deep, oplopend in hoe diep in het gesprek een veld zit. "Komt uit
-- het profiel" ligt niet op die lijn maar ernaast: het veld zit helemaal niet
-- in het gesprek, en het heeft een andere bron. Twee begrippen in een kolom
-- persen levert een enum op waarvan de helft van de combinaties niets betekent.
alter table public.field_definitions
  add column from_profile boolean not null default false;

comment on column public.field_definitions.from_profile is
  'Dit veld wordt nooit in het intakegesprek gevraagd; het komt uit public.athletes en wordt bij het starten van een intake als voorstel weggeschreven. Zie lib/intake/profileFields.ts voor de koppeling tussen veldsleutel en kolom.';

-- 2. De kolommen die nog ontbraken.
--
-- phone, club, federation en full_name stonden er al vanaf het begin; die waren
-- alleen nooit op het profielscherm te bewerken. Deze vier bestonden nergens
-- behalve als dossierveld dat per intake opnieuw uitgevraagd werd.
alter table public.athletes
  add column date_of_birth date,
  add column sport text,
  add column discipline text,
  add column coach_name text;

comment on column public.athletes.sport is
  'Vrije tekst in de databank, maar gevalideerd tegen enum_options van identity.sport in de taxonomie. Bewust geen postgres-enum: de lijst met sporten hoort bij te stellen te zijn zonder migratie, net als de rest van de taxonomie.';

comment on column public.athletes.coach_name is
  'De eigen trainer van de atleet. Niet te verwarren met athletes.practitioner_id: dat is de behandelaar in deze praktijk.';

-- 3. De negen velden aanzetten.
--
-- identity.medical_network staat er met opzet NIET bij. Dat is "met welke arts,
-- kinesist of osteopaat werk je samen", en het staat als is_medical = true in
-- de taxonomie. Het atleetprofiel is bewust vrij van medische inhoud; dat staat
-- letterlijk op dat scherm en de query erachter filtert erop. Een medisch veld
-- erin trekken zou die scheiding stilzwijgend opheffen.
update public.field_definitions
   set from_profile = true
 where key in (
   'identity.full_name',
   'identity.date_of_birth',
   'identity.email',
   'identity.phone',
   'identity.sport',
   'identity.discipline',
   'identity.club',
   'identity.federation',
   'identity.coach_name'
 );

-- 4. En carry-forward uit voor precies diezelfde velden.
--
-- Die vlag bestaat om een gegeven bij een volgende intake ter bevestiging voor
-- te leggen: "ik heb nog naam, geboortedatum, sport, club - klopt dat?". Komt
-- het veld uit het profiel, dan valt er niets te bevestigen, en zou het
-- openingsbericht alsnog de hele administratieve opsomming doen. Precies het
-- gedrag dat deze migratie weg wil hebben, alleen via een andere weg.
--
-- biometrics.height_cm en biometrics.dominant_side blijven WEL op carry
-- forward: die komen niet uit het profiel en horen daar ook niet, want lengte
-- is een meting en geen administratief gegeven.
update public.field_definitions
   set carry_forward = false
 where from_profile;

-- Een veld dat uit het profiel komt heeft geen voorwaarde nodig: het wordt
-- sowieso niet gevraagd, dus een ask_when erop zegt niets en wekt de indruk dat
-- er iets geregeld is. Zelfde redenering als bij tier 'deep'.
alter table public.field_definitions
  add constraint field_definitions_profile_has_no_condition
  check (not from_profile or ask_when is null);
