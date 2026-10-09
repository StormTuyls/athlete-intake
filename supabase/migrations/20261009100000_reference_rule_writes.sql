-- De praktijk mag haar eigen referentiewaarden beheren. FR-02.
--
-- 20261009090100 gaf intake_server alleen SELECT op de bibliotheek, met de
-- redenering uit 20260902110000: "De serverrol heeft public alleen nodig om
-- foreign keys te kunnen valideren en de taxonomie te lezen."
--
-- Die grens verschuift hier, voor precies een tabel, en dat verdient een reden.
--
-- Een nieuwe versie van een regel is twee schrijfacties die samen moeten
-- slagen: de geldende regel uitfaseren en de opvolger aanmaken. Er ligt een
-- partiele unieke index op (metric_key) where retired_at is null, dus halverwege
-- stoppen laat de metriek ofwel zonder geldende regel achter, ofwel laat de
-- insert falen. Dat moet dus in een transactie.
--
-- service_role heeft wel CRUD op public, maar praat via PostgREST en kent geen
-- transacties over twee statements. intake_server praat rechtstreeks met
-- Postgres en kan het wel. Daarom schuift het recht naar die rol, en niet het
-- schrijfpad naar de andere.
--
-- Wat NIET verschuift: delete. Een regel wordt uitgefaseerd met retired_at,
-- nooit verwijderd, want er hangen beoordeelde metingen aan die naar hun
-- regelversie wijzen.

grant insert, update on public.reference_rules to intake_server;
grant usage, select on sequence public.reference_rules_id_seq to intake_server;

comment on table public.reference_rules is
  'De vier referentielagen uit spec §5, als data met herkomst. Versiegebonden: een gewijzigde drempel is een nieuwe versie, zodat een rapport van vorig jaar blijft zeggen wat het zei. Beheerd vanuit /coach/library; intake_server mag hier invoegen en bijwerken maar nooit verwijderen.';
