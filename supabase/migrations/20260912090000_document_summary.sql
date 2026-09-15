-- Wat er in een aangeleverd document staat, in een paar zinnen.
--
-- Tot nu leverde een document uitsluitend losse velden op. Dat werkt voor een
-- kine-verslag, waar de waarden die ertoe doen ook echt velden zijn, en het
-- werkt slecht voor een trainingsschema: daar zit de inhoud in de STRUCTUUR
-- (welke sessies, in welke volgorde, met hoeveel herstel) en niet in een
-- handvol getallen. Zo'n document belandde in de bijlagenlijst als een
-- bestandsnaam met een paginateller, en wie wilde weten wat erin stond moest
-- het openen.
--
-- Wat hier WEL in komt: een beschrijving van wat het document is en wat het
-- bevat. Feitelijk, in de woorden van de bron.
--
-- Wat hier NIET in komt: een oordeel. Geen "dit schema is te zwaar", geen
-- diagnose, geen advies. Dat is een andere beslissing met een ander
-- aansprakelijkheidsprofiel, en als die er komt hoort ze in een eigen kolom
-- zodat je ze kunt uitzetten zonder de samenvatting kwijt te raken.
--
-- Opgeslagen en niet per keer gegenereerd, anders dan de klinische
-- samenvatting van een dossier. Het verschil: een dossier verandert terwijl de
-- coach het nakijkt, een document niet. Deze tekst hoort bij de ene modelcall
-- die het document toch al las, dus hij kost niets extra en hij verandert
-- daarna nooit meer.

alter table medical.documents
  add column summary text;

comment on column medical.documents.summary is
  'Beschrijving van wat dit document bevat, uit dezelfde modelcall die de velden eruit haalde. Feitelijk en zonder oordeel. Null zolang het document niet gelezen is, of als het lezen mislukte. Nooit een vervanging van het origineel: dat blijft naast deze tekst staan.';

-- Geen index. Er wordt nooit op gezocht of gesorteerd; deze kolom wordt
-- uitsluitend gelezen bij de documenten van een intake die je al te pakken
-- hebt, en daar bestaat documents_intake_idx al voor.

-- Geen grant nodig: de rechten op medical.documents staan op tabelniveau, niet
-- per kolom, dus intake_server mag deze kolom meteen lezen en schrijven.
