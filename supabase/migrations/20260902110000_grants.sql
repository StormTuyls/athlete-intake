-- Expliciete rechten.
--
-- Supabase geeft tabellen die door `postgres` in `public` worden aangemaakt geen
-- CRUD-rechten meer aan anon, authenticated of service_role; alleen restanten als
-- TRUNCATE en TRIGGER. Dat is een goede standaard, maar het betekent dat rechten
-- hier expliciet horen te staan in plaats van impliciet te ontstaan.
--
-- Die restanten gaan eerst weg: TRUNCATE op public.athletes voor `anon` is
-- nergens voor nodig en is precies het soort recht dat niemand ooit opmerkt.

revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;

-- anon krijgt niets. De publieke intakeflow loopt via route handlers, niet via
-- PostgREST, dus een anonieme bezoeker heeft geen enkele tabel nodig.

-- authenticated is de coach in de browser. Leesrechten waar een RLS-policy op
-- staat, schrijfrechten alleen op wat een coach beheert. RLS filtert daarna nog
-- eens per rij.
grant usage on schema public to authenticated;
grant select on
  public.profiles,
  public.field_definitions,
  public.athletes,
  public.intakes,
  public.consents,
  public.chat_messages,
  public.audit_log
  to authenticated;
grant insert, update, delete on public.athletes, public.intakes to authenticated;

-- service_role is de server. Volledige CRUD op de app-tabellen, want die
-- handelt de intakeflow af namens een atleet zonder account.
grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.profiles,
  public.athletes,
  public.intakes,
  public.consents,
  public.chat_messages
  to service_role;
grant select on public.field_definitions to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Het audit-log: schrijven en lezen, nooit wijzigen of wissen. De trigger
-- blokkeert het al, maar een recht dat niet bestaat kan ook niet misbruikt worden.
grant insert, select on public.audit_log to service_role;

-- Nieuwe tabellen in public volgen ditzelfde patroon niet automatisch: dat is
-- opzet. Wie een tabel toevoegt, schrijft de grants erbij en denkt dus na over
-- wie erbij mag.

-- ── medical: alleen een eigen serverrol ────────────────────────────────────────
--
-- Het `medical`-schema blijft buiten PostgREST. De server praat er rechtstreeks
-- met Postgres, met een eigen rol die verder niets mag. De HTTP-API die het
-- internet aanspreekt heeft dus geen route naar medische data, ook niet als
-- iemand later per ongeluk een policy of een grant toevoegt.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'intake_server') then
    -- Zonder wachtwoord: dat zet de operator buiten git om.
    --   alter role intake_server password '<uit de secrets-store>';
    create role intake_server login noinherit;
  end if;
end
$$;

grant usage on schema medical to intake_server;
grant select, insert, update, delete on all tables in schema medical to intake_server;
grant usage, select on all sequences in schema medical to intake_server;

-- De serverrol heeft public alleen nodig om foreign keys te kunnen valideren en
-- de taxonomie te lezen.
grant usage on schema public to intake_server;
grant select on public.field_definitions, public.intakes, public.athletes to intake_server;
grant insert, select on public.audit_log to intake_server;
grant usage, select on public.audit_log_id_seq to intake_server;

-- De rol moet RLS op medical kunnen omzeilen; die tabellen hebben met opzet geen
-- policies, dus zonder dit ziet ook de server nul rijen.
alter role intake_server bypassrls;

alter default privileges in schema medical
  grant select, insert, update, delete on tables to intake_server;
alter default privileges in schema medical
  grant usage, select on sequences to intake_server;

comment on role intake_server is 'Applicatierol voor het medical-schema. Alleen te gebruiken via een directe Postgres-verbinding uit de server, nooit via PostgREST.';
