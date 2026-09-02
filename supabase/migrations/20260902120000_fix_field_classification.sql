-- Correctie op de taxonomie.
--
-- identity.medical_network stond als niet-medisch. Dat is fout: een lijst van de
-- artsen, kinesisten en osteopaten waar iemand mee werkt verraadt dat er iets
-- aan de hand is, ook zonder diagnose. Onder artikel 9 AVG is dat een gegeven
-- over gezondheid.
--
-- Dit corrigeren in de taxonomie in plaats van in de Notion-sync is het punt:
-- de sync leest is_medical, dus een goede classificatie beschermt automatisch
-- elke afnemer die er ooit bijkomt. Een uitzondering in de sync beschermt alleen
-- die ene sync.

update public.field_definitions
set is_medical = true
where key = 'identity.medical_network';

comment on column public.field_definitions.is_medical is 'True bij elk gegeven over gezondheid, ook indirect. Behandelrelaties en lichaamsmaten horen hierbij. Bepaalt of het veld naar een externe afnemer als Notion mag.';
