-- Een behandelaar die weggaat, zonder zijn vakgebied kwijt te raken.
--
-- `practitioner_kind` deed tot nu twee dingen tegelijk: het zei WAT iemand is
-- en of hij KIESBAAR is. Dat was een bewuste vereenvoudiging, en ze houdt geen
-- stand zodra er personeel vertrekt. Iemand uit de lijst halen betekende zijn
-- vakgebied op null zetten, en dan staat er op de dossiers die hij behandeld
-- heeft ineens een naam zonder discipline. Het verleden hoort niet te
-- veranderen omdat het heden verandert.
--
-- Dus twee kolommen voor twee vragen. Het vakgebied blijft staan zolang de rij
-- bestaat; `archived_at` zegt of hij nog nieuwe atleten aanneemt.

alter table public.profiles
  add column archived_at timestamptz;

comment on column public.profiles.archived_at is
  'Gezet zodra deze behandelaar geen nieuwe atleten meer aanneemt. Verdwijnt daarmee uit de keuzelijst, maar blijft zichtbaar op de atleten die al aan hem gekoppeld zijn: die koppeling is geschiedenis en geen keuze van vandaag.';

-- Alleen de kiesbare behandelaars, want dat is de enige lijst die per render
-- wordt opgevraagd.
create index profiles_selectable_practitioner_idx on public.profiles (practitioner_kind)
  where practitioner_kind is not null and archived_at is null;
