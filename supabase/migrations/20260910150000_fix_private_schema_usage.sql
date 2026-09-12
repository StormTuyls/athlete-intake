-- De policies konden hun eigen hulpfunctie niet aanroepen.
--
-- 20260902090300_rls.sql doet drie dingen die elkaar tegenspreken:
--
--   grant execute on function private.current_role() to authenticated;
--   grant execute on function private.is_staff()     to authenticated;
--   ...
--   revoke all on schema private from anon, authenticated;
--
-- EXECUTE op een functie is niet genoeg: zonder USAGE op het schema kun je de
-- naam `private.is_staff` niet eens oplossen. En omdat een nieuw schema die
-- USAGE sowieso niet uitdeelt, heeft `authenticated` hem nooit gehad; de
-- revoke was een no-op op iets dat al dicht stond, en de twee grants erboven
-- waren dode letter.
--
-- Het gevolg is erger dan een foutmelding. Elke policy in het `public`-schema
-- die `private.is_staff()` aanroept (profiles_select_self, athletes_select,
-- intakes_select, consents_select, chat_messages_select, audit_log_select)
-- klapt op "permission denied for schema private" zodra de planner die tak
-- werkelijk uitvoert. Of dat gebeurt hangt af van het plan: bij een filter op
-- de eigen rij kan `id = auth.uid()` de OR kortsluiten en gaat het goed, en bij
-- een ander plan niet. Autorisatie die afhangt van een queryplan is geen
-- autorisatie, en het faalt bovendien de verkeerde kant op voor de gebruiker:
-- een behandelaar krijgt een 404 op zijn eigen werklijst.
--
-- Gevonden doordat /coach en /coach/athletes/[id] na het toevoegen van een
-- kolom aan public.profiles ineens 404 gaven voor een ingelogde coach, terwijl
-- dezelfde login een half uur eerder wel werkte. Er was niets aan de policies
-- veranderd; alleen het plan.

grant usage on schema private to authenticated;

-- De deur staat nu op een kier, dus alles wat er niet doorheen hoeft gaat op
-- slot. Deze vier stonden op de standaard van Postgres, en die is EXECUTE voor
-- PUBLIC. Drie zijn triggerfuncties die je zonder triggercontext niet zinvol
-- kunt aanroepen, maar "je kunt er niets mee" is een zwakkere garantie dan "je
-- mag er niet bij", en dat verschil is precies waarom dit schema bestaat.
revoke execute on function private.actor_kind() from public;
revoke execute on function private.audit_row() from public;
revoke execute on function private.reject_mutation() from public;
revoke execute on function private.reject_mutation_unless_purging() from public;

-- anon houdt niets: geen usage, geen execute. De publieke intakeflow loopt via
-- route handlers en niet via PostgREST.
revoke all on schema private from anon;

comment on schema private is 'Interne helperfuncties. Niet exposed via PostgREST. `authenticated` heeft USAGE omdat de RLS-policies in public hier hun rolcontrole vandaan halen; welke functie hij mag aanroepen staat per functie in de grants.';
