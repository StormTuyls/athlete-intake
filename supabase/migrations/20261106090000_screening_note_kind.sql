-- Wat er op pagina 1 van het rapport staat.
--
-- Het rapport opent met twee genummerde tabellen: sterktes en ontwikkelpunten,
-- elk met het werkdoel voor de volgende test. Die drie dingen stonden nergens.
-- Een opmerking had alleen een ernst (info/watch/action), en dat is een ander
-- soort oordeel: ernst zegt hoe dringend iets is, kind zegt of het een plus of
-- een min is. Een sterkte met ernst 'info' en een ontwikkelpunt met ernst
-- 'info' horen niet in dezelfde tabel.
--
-- Alle drie nullable, en dat blijft zo. Een vlag zonder kind is wat er nu al
-- staat: een losse opmerking bij een meting, die het dossier in gaat maar niet
-- op de kaft. Pas wie een kind kiest, zet hem op pagina 1.
create type public.note_kind as enum ('strength', 'development');

alter table medical.screening_notes
  add column kind public.note_kind,
  add column rank integer,
  add column target text;

comment on column medical.screening_notes.kind is
  'Sterkte of ontwikkelpunt, voor de twee tabellen op pagina 1 van het rapport. '
  'Null is een gewone vlag: wel in het dossier, niet op de kaft.';

comment on column medical.screening_notes.rank is
  'De plek in de genummerde tabel. Null betekent ongenummerd, en dan sorteert '
  'de rij achteraan op ernst en datum zoals voorheen.';

comment on column medical.screening_notes.target is
  'Het werkdoel voor de volgende test, in de woorden van de behandelaar. '
  'Losstaand van action: action is wat er nu gebeurt, target is waar het heen '
  'moet.';

-- Een nummer zonder soort is betekenisloos: in welke van de twee tabellen zou
-- hij dan op drie staan.
alter table medical.screening_notes
  add constraint screening_notes_rank_needs_kind
  check (rank is null or kind is not null);

-- Twee keer nummer 1 in dezelfde tabel van dezelfde sessie is geen volgorde.
-- Partieel, want ongenummerde rijen mogen met zovelen zijn als ze willen.
create unique index screening_notes_rank_key
  on medical.screening_notes (session_id, kind, rank)
  where rank is not null;
