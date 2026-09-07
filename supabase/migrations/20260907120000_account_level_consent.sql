-- Toestemming op accountniveau.
--
-- Tot nu toe hoorde elke consentregistratie bij precies één intake, en dus werd
-- dezelfde vraag ("mag ik je gezondheidsgegevens verwerken") bij elke nieuwe
-- intake opnieuw gesteld. Sinds de atleet een account heeft, is dat de verkeerde
-- plek: hij stemt in bij het aanmaken van zijn account, en dat geldt zolang het
-- account bestaat.
--
-- Vandaar twee niveaus in dezelfde tabel, onderscheiden door intake_id:
--
--   intake_id is null  toestemming voor het account: verwerken en bewaartermijn
--   intake_id gevuld   toestemming die bij één intake hoort, nu alleen het
--                      delen van een samenvatting met een behandelaar
--
-- Eén tabel en geen tweede, want het is hetzelfde soort feit met dezelfde
-- bewijslast: welke tekst, welk moment, welk IP. Een tweede tabel zou die
-- kolommen dupliceren en de vraag "waar stemde deze atleet mee in" over twee
-- plekken verdelen.
alter table public.consents
  alter column intake_id drop not null;

comment on column public.consents.intake_id is
  'Null betekent toestemming op accountniveau (verwerken, bewaartermijn). Gevuld betekent toestemming die bij die ene intake hoort, zoals delen met een behandelaar.';

-- Per atleet hoogstens één geldige accountconsent per versie. Twee keer
-- hetzelfde vastleggen maakt het register niet completer maar onleesbaar.
create unique index consents_account_level_unique
  on public.consents (athlete_id, consent_version)
  where intake_id is null;

create index consents_athlete_account_idx
  on public.consents (athlete_id, granted_at desc)
  where intake_id is null;
