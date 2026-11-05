-- Twee keer bewaren mag geen twee screenings maken.
--
-- De route deed een kale insert. Er is met opzet GEEN uniciteit op
-- (athlete_id, occurred_on), want twee screenings op dezelfde dag zijn
-- toegestaan: een ochtend- en een avondmeting zijn niet uitwisselbaar, en
-- occurred_at houdt ze uit elkaar. Daarmee was er ook niets dat een herhaalde
-- POST tegenhield.
--
-- Vandaar een sleutel van de client in plaats van een sleutel op de inhoud. Het
-- formulier maakt er een bij het openen en stuurt hem bij elke poging mee, dus
-- een dubbele tik en een herhaling na een trage verbinding dragen dezelfde
-- sleutel. Een nieuw formulier is een nieuwe sleutel, en dus een nieuwe sessie:
-- dat is juist, want dan is het ook een nieuwe intentie.
--
-- Nullable, en dat blijft zo. De bestaande rijen hebben er geen, en een oud
-- tabblad dat hem niet meestuurt hoort te blijven werken. In Postgres zijn
-- null-waarden onderling verschillend, dus een gewone unique laat er zoveel toe
-- als er zijn.
alter table medical.screening_sessions
  add column client_token uuid unique;

comment on column medical.screening_sessions.client_token is
  'Idempotentiesleutel van het invoerformulier. Een herhaalde POST met dezelfde '
  'sleutel geeft de bestaande sessie terug in plaats van een tweede te maken. '
  'Null voor alles wat van voor deze kolom is, en voor bronnen die er geen sturen.';
