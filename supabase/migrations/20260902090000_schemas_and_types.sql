-- Schema's en enums.
--
-- Twee gescheiden domeinen, want medische data valt onder artikel 9 AVG en de
-- klant vroeg expliciet om scheiding tussen commercieel en medisch:
--
--   public   identiteit, administratie, consent, audit. Browser mag hier via RLS bij.
--   medical  documenten, dossierwaarden, blessures, testmetingen, rapporten.
--            NIET via PostgREST bereikbaar (zie supabase/config.toml).
--   private  helperfuncties. Nooit exposed, nooit direct aanroepbaar.
--
-- Sleutelkeuze: uuid v4 voor alles wat in een URL of link terechtkomt
-- (athletes, intakes, documents), zodat id's niet te raden zijn. bigint identity
-- voor append-only tabellen met volume (audit_log, paginateksten, voorstellen),
-- waar sequentiele locality wel telt en de id nooit naar buiten gaat.

create schema if not exists medical;
create schema if not exists private;

comment on schema medical is 'Bijzondere categorie persoonsgegevens (art. 9 AVG). Alleen server-side toegankelijk via de service role, na autorisatie en audit.';
comment on schema private is 'Interne helperfuncties. Niet exposed via PostgREST.';

create type public.user_role as enum ('coach', 'athlete', 'admin');

create type public.intake_status as enum ('draft', 'submitted', 'in_review', 'approved');

-- Status van een dossierveld. 'conflicting' bestaat zodat het systeem nooit
-- stilzwijgend een van twee tegenstrijdige bronnen kiest.
create type public.field_status as enum (
  'extracted', 'inferred', 'confirmed', 'missing', 'conflicting'
);

-- Betrouwbaarheid is een afgeleide regel over geverifieerde herkomst, geen
-- getal dat het model over zichzelf rapporteert. Zie lib/dossier/completeness.ts.
create type public.confidence_level as enum ('high', 'medium', 'low');

create type public.proposed_by as enum ('model', 'athlete', 'coach');

create type public.document_kind as enum (
  'pdf_text', 'pdf_scanned', 'image', 'whatsapp_export', 'vald_csv'
);

create type public.field_data_type as enum (
  'text', 'long_text', 'number', 'date', 'boolean', 'enum', 'list'
);

create type public.body_side as enum ('left', 'right', 'bilateral', 'unknown');
