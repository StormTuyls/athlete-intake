-- Wie de screening afnam, als naam en niet alleen als verwijzing.
--
-- medical.screening_sessions had al tester_profile_id. Dat is de juiste
-- verwijzing, maar een rapport kan er niets mee: de naam staat in
-- public.profiles, en intake_server heeft daar met opzet geen select op. Dat
-- recht verbreden voor een naam is de verkeerde ruil; de medische serverrol
-- hoort niet bij de ledenlijst van de praktijk te kunnen.
--
-- Belangrijker dan het rechtenargument is wat een rapport hoort te zeggen.
-- Spec §4 noemt de tester als veld van een testsessie, en een afdruk van vorig
-- jaar hoort te vermelden wie er toen mat. Een join zou die naam laten
-- meeveranderen: trouwt de fysiotherapeut, of vertrekt ze en wordt haar profiel
-- gearchiveerd, dan verandert met terugwerkende kracht wie er volgens het
-- dossier gemeten heeft.
--
-- Dus allebei, en ze beantwoorden twee verschillende vragen:
--
--   tester_profile_id  WIE het was, nu nog te volgen naar een account
--   tester_name        wat er TOEN stond, bevroren op het moment van meten
--
-- Zelfde redenering als body_mass_kg op deze tabel en als consents.
-- consent_version: wat gold op dat moment.

alter table medical.screening_sessions add column tester_name text;

comment on column medical.screening_sessions.tester_name is
  'De naam van de tester zoals die bij het meten gold. Gekopieerd en niet gejoind: een rapport van vorig jaar hoort niet te veranderen als iemand van naam verandert of vertrekt. tester_profile_id blijft de verwijzing.';
