-- In welke taal stond de tekst waar de atleet mee instemde.
--
-- `consent_version` legt vast WELKE tekst iemand zag, en dat was het argument om
-- die kolom te hebben: zonder versie is een consentregistratie waardeloos zodra
-- de tekst verandert. Maar één versie bestaat hier in twee talen, en het scherm
-- rendert in de taal van het cookie. Twee atleten met dezelfde versie in hun rij
-- kunnen dus twee verschillende zinnen gelezen hebben, en het register kan niet
-- zeggen welke.
--
-- Dat is dezelfde redenering als bij de versie zelf, één stap verder
-- doorgetrokken. Vandaar een kolom en geen afleiding uit `athletes.locale`: dat
-- is een voorkeur die de atleet morgen kan omzetten, en een register hoort niet
-- van een wijzigbare kolom af te hangen.

alter table public.consents
  add column locale text check (locale in ('nl', 'en'));

comment on column public.consents.locale is
  'De taal waarin de consenttekst op het scherm stond. Null betekent: vastgelegd voordat deze kolom bestond, dus niet vastgesteld. Bewust geen default: een taal invullen die niemand heeft waargenomen is precies wat deze kolom moet voorkomen.';
