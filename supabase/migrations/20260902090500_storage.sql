-- Opslag voor ruwe intakedocumenten.
--
-- Niet publiek, en zonder policies voor anon of authenticated. Uploads gaan via
-- een signed upload URL die de server aanmaakt na validatie van het capability
-- token; downloads via een kortlevende signed URL na autorisatie en audit. Het
-- bestand gaat daarmee rechtstreeks van browser naar opslag, dus nooit door een
-- function, en er is geen bodylimiet om omheen te werken.
--
-- Ruwe bestanden blijven permanent bewaard naast de afgeleide data. Dat is een
-- expliciet ontwerpprincipe van de klant: niets mag uitsluitend in een
-- AI-samenvatting leven.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'intake-documents',
  'intake-documents',
  false,
  52428800, -- 50 MB per bestand
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/webp',
    'text/plain',
    'text/csv',
    'application/zip'
  ]
)
on conflict (id) do nothing;
