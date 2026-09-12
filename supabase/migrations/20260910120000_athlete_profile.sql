-- Het profiel van de atleet: adres, en de behandelaar bij wie hij hoort.
--
-- Tot nu was een atleet een naam, een e-mailadres en een stapel intakes. Twee
-- dingen ontbraken die geen intake-eigenschap zijn maar een persoonseigenschap:
-- waar hij woont, en wie hem in deze praktijk behandelt.
--
-- Let op het onderscheid met `identity.coach_name` in de taxonomie. Dat is de
-- eigen trainer van de atleet, een naam die uit een document kan komen en die
-- bij een intake hoort. Dit hier is iemand met een login in dit systeem, en de
-- koppeling is dus een foreign key en geen tekstveld.

-- ── Wie is er te kiezen ───────────────────────────────────────────────────────
--
-- Geen nieuwe waarde in public.user_role. Die enum bepaalt wat iemand MAG:
-- private.is_staff() leest hem, en er 'physio' bij zetten betekent elke
-- autorisatiecontrole in dit schema nalopen. Wat iemand doet en wat iemand mag
-- zijn twee vragen, dus twee kolommen.

create type public.practitioner_kind as enum ('physio', 'coach');

alter table public.profiles
  add column practitioner_kind public.practitioner_kind,
  -- Een vakgebied hoort bij staf. Zonder deze regel kan een atleetprofiel
  -- 'physio' dragen en in de keuzelijst van een andere atleet opduiken.
  add constraint profiles_kind_requires_staff check (
    practitioner_kind is null or role in ('coach', 'admin')
  );

comment on column public.profiles.practitioner_kind is
  'Vakgebied van een behandelaar, en tegelijk de schakelaar die hem kiesbaar maakt voor atleten. Null betekent: verschijnt niet in de keuzelijst. De rol bepaalt wat iemand mag, deze kolom wat hij doet.';

-- ── Waar woont de atleet ──────────────────────────────────────────────────────
--
-- Losse kolommen en geen vrij tekstveld: een postcode die een postcode is kan
-- straks een factuur of een rapport in, en een adresblok van vier regels tekst
-- kan dat niet.

alter table public.athletes
  add column street text,
  add column postal_code text,
  add column city text,
  add column country text,
  -- ISO 3166-1 alpha-2, hoofdletters. De server normaliseert; dit is het slot
  -- eronder, zodat 'Belgie' en 'be' niet naast 'BE' in de kolom komen te staan.
  add constraint athletes_country_iso check (country is null or country ~ '^[A-Z]{2}$');

-- ── Bij wie hoort hij ─────────────────────────────────────────────────────────
--
-- on delete set null: een behandelaar die vertrekt maakt geen atleet ongeldig.
-- Dat de rij waarnaar gewezen wordt ook echt staf is, kan Postgres hier niet
-- afdwingen (een foreign key kan niet op een gefilterde verzameling wijzen).
-- De route valideert tegen dezelfde query die de keuzelijst opbouwt. Een
-- verkeerde waarde is daarmee een gegevensfout en geen lek: deze kolom geeft
-- niemand toegang tot iets, want autorisatie hangt aan profiles.role.

alter table public.athletes
  add column practitioner_id uuid references public.profiles (id) on delete set null;

create index athletes_practitioner_id_idx on public.athletes (practitioner_id)
  where deleted_at is null;

comment on column public.athletes.practitioner_id is
  'De behandelaar in deze praktijk bij wie de atleet hoort. Niet te verwarren met identity.coach_name in de taxonomie: dat is de eigen trainer van de atleet.';
