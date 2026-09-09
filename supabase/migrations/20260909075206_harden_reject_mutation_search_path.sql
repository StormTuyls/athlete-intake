-- Een vergeten `set search_path` op private.reject_mutation().
--
-- Elke andere functie in dit schema zet hem al leeg: audit_row, log_access,
-- actor_kind, is_staff, current_role, reject_mutation_unless_purging en
-- medical.purge_athlete. Deze ene niet, en dat is geen keuze geweest maar een
-- gaatje. De linter van Supabase vindt hem ook (`function_search_path_mutable`),
-- en een security-waarschuwing die blijft staan op een klantproject leert mensen
-- waarschuwingen negeren.
--
-- De praktische impact is hier klein: de functie is SECURITY INVOKER en doet
-- niets anders dan een exception gooien, dus er is geen naam om te ontfutselen.
-- Maar het is de trigger die "public.audit_log is append-only" afdwingt, en dat
-- is precies het soort functie waar je niet over impact wil hoeven nadenken.
--
-- Alleen de functie wordt herschreven, niet de triggers: `create or replace`
-- laat bestaande triggers ongemoeid, ze blijven naar dezelfde functie wijzen.

create or replace function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'public.audit_log is append-only';
end;
$$;
