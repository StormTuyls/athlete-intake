-- Bereik: welke vragen gelden voor wie, en wat er niet meer gevraagd hoeft.
--
-- Het gesprek kende tot nu een veld in twee toestanden: beantwoord of niet.
-- Daardoor was elk veld een gat tot het een waarde had, en was er geen manier
-- om te zeggen "dit geldt hier niet" of "dit weet hij niet". Met 41 velden gaf
-- dat een vragenreeks zonder einde; met een vraagbank van 85 wordt dat twee
-- keer zo erg.
--
-- Deze migratie voegt de twee ontbrekende begrippen toe. Ze verandert op zichzelf
-- NIETS aan het gedrag: `tier` staat standaard op 'standard' en `ask_when` op
-- null, en dat is precies wat er nu al gebeurt. Het gedrag verandert pas als de
-- praktijk de taxonomie invult, en dat is de bedoeling: de inhoudelijke keuze
-- welke vraag naar de behandelaar gaat is een klinische, geen technische.

-- 1. Wat de bot vraagt en wat de behandelaar vraagt.
--
-- Als enum en niet als booleans: 'core' en 'deep' zijn geen twee onafhankelijke
-- vlaggen maar drie punten op een lijn, en twee booleans laten een vierde
-- toestand toe die niets betekent.
create type public.field_tier as enum ('core', 'standard', 'deep');

alter table public.field_definitions
  add column tier public.field_tier not null default 'standard';

comment on column public.field_definitions.tier is
  'core: de bot vraagt altijd, ook zonder dat ask_when klopt. standard: de bot vraagt als ask_when waar is. deep: de bot vraagt nooit; het veld komt als voorbereide vraag op het scherm van de behandelaar.';

-- 2. Wanneer een veld in bereik is.
--
-- jsonb en geen tekst met een expressie erin. Deze kolom wordt door de praktijk
-- bewerkt, en alles wat je erin kunt schrijven kun je er ook fout in schrijven.
-- Een gesloten vorm die door een schema gevalideerd wordt is te controleren; een
-- expressietaal is dat niet. De vorm staat in lib/dossier/askWhen.ts.
--
-- Null betekent: altijd in bereik. Dat is de bestaande situatie voor elk veld.
alter table public.field_definitions
  add column ask_when jsonb;

comment on column public.field_definitions.ask_when is
  'Voorwaarde waaronder dit veld gevraagd wordt, als gesloten JSON ({field, equals|not_equals|in|gte|lte} met all/any/not). Null is altijd. Levert drie waarden op: waar, onwaar, of nog onbekend; onbekend is geen gat. Zie lib/dossier/askWhen.ts.';

-- Een object en geen array of scalair, zodat een verkeerde vorm hier al strandt
-- en niet pas in de evaluator. De inhoudelijke controle (bestaat het veld waar
-- naar verwezen wordt?) kan een check constraint niet doen, want die kijkt niet
-- naar andere rijen; die zit in de laadfunctie en in een test over de seed.
alter table public.field_definitions
  add constraint field_definitions_ask_when_is_object
  check (ask_when is null or jsonb_typeof(ask_when) = 'object');

-- Een deep veld wordt nooit gevraagd, dus een voorwaarde erop zegt niets en
-- wekt de indruk dat er iets geregeld is.
alter table public.field_definitions
  add constraint field_definitions_deep_has_no_condition
  check (tier <> 'deep' or ask_when is null);

-- 3. Waar niet meer naar gevraagd hoeft te worden.
--
-- Een aparte tabel, en dat is een betekeniskeuze. medical.dossier_fields is
-- "wat we weten"; een overgeslagen veld weten we juist niet. De constraints daar
-- zeggen dat ook al: dossier_fields_present_has_proposal eist een winnend
-- voorstel voor alles wat niet 'missing' is, en een skip heeft dat niet.
--
-- Een voorstel met een lege waarde was het alternatief, en dat is erger: dan
-- betekent "voorstel" zowel een voorgestelde waarde als de afwezigheid daarvan,
-- en moet lib/dossier/merge.ts dat onderscheid overal maken.
--
-- Append-only zoals de rest van medical: een skip die later toch beantwoord
-- wordt blijft staan. Dat het veld ooit overgeslagen is, is deel van het spoor.
create table medical.field_skips (
  id bigint generated always as identity primary key,
  intake_id uuid not null references public.intakes (id) on delete cascade,
  field_key text not null references public.field_definitions (key) on delete restrict,
  -- Waarom er niets kwam. 'unknown' is de atleet die het niet weet, 'declined'
  -- is de atleet die het niet wil zeggen. Dat verschil doet ertoe voor de
  -- behandelaar: het eerste is een gat, het tweede is een grens.
  reason text not null check (reason in ('unknown', 'declined')),
  at timestamptz not null default now()
);

-- Per intake per veld hoogstens een keer overslaan. Twee keer "weet ik niet"
-- op hetzelfde veld is dezelfde gebeurtenis, geen tweede.
create unique index field_skips_intake_field_key on medical.field_skips (intake_id, field_key);
create index field_skips_intake_idx on medical.field_skips (intake_id);

comment on table medical.field_skips is
  'Velden waar deze intake niet meer naar vraagt omdat de atleet ze niet kon of wilde beantwoorden. Sluit het gat zonder een waarde vast te leggen. Zie lib/dossier/completeness.ts.';

grant select, insert on medical.field_skips to intake_server;
