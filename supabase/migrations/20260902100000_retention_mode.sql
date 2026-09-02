-- Bewaartermijn expliciet maken.
--
-- Eerder betekende retention_until null "nog geen termijn bepaald". Dat is
-- dubbelzinnig zodra we ook onbepaald willen bewaren: null zou dan "voor altijd"
-- kunnen betekenen, en het verschil tussen "vergeten in te vullen" en "bewust
-- onbeperkt" is precies het verschil dat een toezichthouder wil zien.
--
-- Nu is de modus een eigen kolom en dwingt een constraint de combinatie af.
-- Onbepaald bewaren vraagt om een benoemde grond in retention_basis: onder
-- artikel 5(1)(e) AVG is "we bewaren het gewoon" geen antwoord. Voor een
-- zorgdossier in Belgie is de gangbare grond 30 jaar na het laatste contact.

create type public.retention_mode as enum ('indefinite', 'until_date');

alter table public.athletes
  add column retention_mode public.retention_mode not null default 'indefinite',
  add column retention_basis text;

-- Bestaande rijen naar de nieuwe standaard, zodat de constraint kan landen.
update public.athletes set retention_until = null where retention_mode = 'indefinite';

alter table public.athletes
  add constraint athletes_retention_consistent check (
    (retention_mode = 'indefinite' and retention_until is null)
    or (retention_mode = 'until_date' and retention_until is not null)
  );

comment on column public.athletes.retention_mode is 'indefinite: geen automatische verwijdering, grond verplicht in retention_basis. until_date: retentiejob verwijdert na retention_until.';
comment on column public.athletes.retention_basis is 'Waarom dit dossier onbeperkt bewaard mag worden. Verplicht bij mode indefinite.';

-- De grond is niet optioneel bij onbepaald bewaren.
alter table public.athletes
  add constraint athletes_indefinite_needs_basis check (
    retention_mode <> 'indefinite'
    or (retention_basis is not null and length(btrim(retention_basis)) > 0)
  );

-- De retentiejob hoeft alleen naar dossiers met een einddatum te kijken.
drop index if exists public.athletes_retention_idx;
create index athletes_retention_due_idx on public.athletes (retention_until)
  where retention_mode = 'until_date' and deleted_at is null;
