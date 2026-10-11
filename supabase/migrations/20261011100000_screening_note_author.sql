-- De naam van wie een opmerking schreef, bevroren bij het schrijven.
--
-- Zelfde afweging als tester_name in 20261011090000, en om dezelfde twee
-- redenen: intake_server heeft met opzet geen select op public.profiles, en een
-- join zou met terugwerkende kracht veranderen wie iets geschreven heeft zodra
-- die persoon van naam verandert of vertrekt.
--
-- Bij een opmerking weegt dat zwaarder dan bij een meting. Een meting is een
-- getal; een opmerking is een uitspraak van een mens, en wie hem deed hoort
-- vast te staan.
--
--   author_profile_id  WIE het was, nog te volgen naar een account
--   author_name        wat er TOEN stond
--
-- resolved_by houdt alleen de verwijzing: dat iemand een vlag sloot is een
-- feit over het dossier, geen uitspraak die onder een naam hoort te staan.

alter table medical.screening_notes add column author_name text;

comment on column medical.screening_notes.author_name is
  'De naam van de auteur zoals die bij het schrijven gold. Gekopieerd en niet gejoind; zie tester_name op screening_sessions voor dezelfde redenering.';
