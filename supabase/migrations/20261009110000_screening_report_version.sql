-- Een screeningrapport hoort bij een SESSIE, niet bij een atleet.
--
-- 20261009090200 zette de unieke sleutel op (athlete_id, version). Dat telt
-- door over sessies heen: de screening van juli bevriezen levert versie 1 op,
-- die van oktober versie 2, en als de juli-screening daarna gecorrigeerd wordt
-- heet zijn tweede rapport versie 3. Dan is "welke versie van het julirapport"
-- niet meer te beantwoorden.
--
-- Per sessie tellen is wat medical.intake_reports ook doet (daar per intake),
-- en het is wat de vraag beantwoordt die een behandelaar stelt: dit rapport,
-- welke versie.
--
-- Geen data om te migreren: er bestaat nog geen schrijfpad naar deze tabel.

alter table medical.screening_reports
  drop constraint screening_reports_unique_version;

alter table medical.screening_reports
  add constraint screening_reports_unique_version unique (session_id, version);
