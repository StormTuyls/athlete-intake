# AI-intake voor atletenbegeleiding, bouwplan Fase 1

## Context

Klantproject (Frederik, eliteatletenbegeleiding, banden met BOIC en Atletiek Vlaanderen). Nieuwe
atleten dumpen nu een stapel PDF's, scans en WhatsApp-berichten bij de intake. Dat handmatig
uitpluizen kost per atleet uren. Fase 1 automatiseert dat: de atleet uploadt materiaal via een link
in zijn Instagram-linktree, het systeem leest het uit, vraagt gericht naar wat ontbreekt, en de coach
krijgt een gestructureerd dossier plus een intakerapport dat hij in één scherm nakijkt en goedkeurt.

Verkocht als 17 dagen à € 80/u (max € 10.880). Fase 2 (screeningsmodule met referentiedata, volwaardig
CRM) is expliciet buiten scope, maar het datamodel wordt zo gelegd dat het er later op past.

Beslissingen die al vastliggen:
- Nieuwe repo naast kaspio2, volledig gescheiden. Medische data hoort niet in de kaspio-codebase.
- Next.js App Router + Supabase EU (Frankfurt) + Vercel.
- Lokaal eerst, alle schema's als migraties in git. Cloud-project wordt later gelinkt.

## Kernontwerp

Eén principe bepaalt de hele architectuur: **het model schrijft nooit rechtstreeks in het dossier.**
Het stelt veldwaarden voor met bronvermelding (document, pagina, letterlijk citaat). De server
verifieert dat het citaat echt in dat document staat. Een regelengine bepaalt volledigheid en een
betrouwbaarheidsniveau. De coach keurt goed en bevriest een versie. Het rapport komt uit die
bevroren versie, niet uit een live modelcall.

Daarmee is "de professional beslist" technisch waar in plaats van een belofte in een document, en is
de betrouwbaarheidsindicatie regelgebaseerd in plaats van een niet-gekalibreerd getal uit het model.

Pijplijn:

```
browser -> signed upload URL -> Supabase Storage (ruw bestand, permanent, onaangeroerd)
        -> tekstextractie per pagina (opgeslagen, nodig voor citaatverificatie)
        -> Claude-extractie per document, structured output met provenance per veld
        -> citaatverificatie server-side -> quote_verified true/false
        -> merge in dossier, conflictdetectie tegen bestaande waarden
        -> volledigheidsregels -> per veld: status + betrouwbaarheidsniveau
        -> chat vraagt enkel naar velden met status 'missing' of 'conflicting'
        -> coach reviewt in één scherm, corrigeert, keurt goed -> snapshot bevroren
        -> PDF-rapport en JSON/CSV-export uit het snapshot
```

## Stack en keuzes

| Onderdeel | Keuze | Waarom |
|---|---|---|
| Framework | Next.js App Router, TypeScript | Route handlers voor de documentverwerking. Vercel Functions: 300s timeout, ruim genoeg voor een intake met dertig pagina's scans. |
| DB, storage, auth | Supabase, regio Frankfurt | EU-hosting met verwerkersovereenkomst. Postgres als single source of truth vanaf dag één, geen Notion voor medische data. |
| LLM | `@anthropic-ai/sdk`, model `claude-opus-5` | Niet de AI SDK. We hebben eerstelijns toegang nodig tot document-blocks met pagina-locaties, de Files API, expliciete prompt-caching en structured outputs. Door een abstractielaag vecht je daar tegenaan. |
| OCR | Claude vision via `document` en `image` content blocks | Geen aparte OCR-dienst. Gescande PDF's gaan als `document` block (base64 of `file_id`), screenshots als `image` block. Scheelt een integratie en een subverwerker. |
| PDF-rapport | `@react-pdf/renderer` | Draait in Node, geen headless browser nodig. |
| i18n | `next-intl` | NL/EN, uitbreidbaar. |

Modelkeuze en kosten, tegen de actuele tarieven (Opus 5: $5 in / $25 uit per MTok, 1M context):
een intake met dertig gescande pagina's plus een WhatsApp-export komt op ruwweg 60k tot 80k
input-tokens, dus ongeveer $0,35 aan extractie, plus de chatturns. Reken €0,50 tot €1,50 per intake.
Bij twintig intakes per maand blijft het totaal met hosting ver onder de €200 die de klant in gedachten
heeft. Prompt-caching op het documentblok scheelt bij herverwerking ongeveer 90% op de gecachte input.

## Datamodel

Twee schema's, harde scheiding tussen commercieel en medisch. Dit is het antwoord op de open vraag
van de klant of dat in één applicatie mag.

**`public`** (browser mag hier via RLS bij):
- `profiles` (koppeling naar `auth.users`, rol `coach` / `athlete` / `admin`, locale)
- `athletes` (naam, contact, club, federatie, `retention_until`, `deleted_at`)
- `intakes` (athlete_id, status `draft` / `submitted` / `in_review` / `approved`, locale, timestamps, approved_by)
- `field_definitions` (de taxonomie: key, sectie, label_nl, label_en, datatype, verplicht, validatie) via seed
- `consents` (consent_version, purposes jsonb, granted_at, ip, user_agent, withdrawn_at)
- `audit_log` (append-only: actor, actie, entiteit, tijdstip, detail jsonb)
- `chat_messages` (intake_id, rol, inhoud)

**`medical`** (browser komt hier nooit direct; enkel server-side route handlers na authz en audit):
- `documents` (intake_id, storage_path, mime, bytes, sha256, kind, anthropic_file_id)
- `document_pages` (document_id, page_number, extracted_text) voor citaatverificatie
- `field_values` (intake_id, field_key, value jsonb, status, source_document_id, source_page,
  `source_quote`, `quote_verified`, `confidence`, proposed_by `model` / `athlete` / `coach`, model_id,
  `superseded_by`) met historie, niets wordt overschreven
- `injury_events` (body_region, side, diagnosis, onset_date, end_date, `recurrence_of`, bron) voor de blessuretijdlijn
- `test_sessions` en `test_measurements` (atleet, datum, toestel, protocol, metric, waarde, eenheid, zijde)
- `intake_reports` (intake_id, versie, storage_path, `frozen_snapshot` jsonb)
- `purge_jobs` (athlete_id, aangevraagd door, voltooid, resultaat)

`test_sessions` en `test_measurements` bestaan nu al als eigen entiteiten, ook al gebruikt fase 1 ze
alleen om VALD-CSV's in te lezen. Dat kost nu bijna niets en spaart later een migratie wanneer de
screeningsmodule uit fase 2 erop moet.

### Betrouwbaarheid, deterministisch

Geen zelfgerapporteerd percentage van het model. `confidence` wordt door een regel bepaald:

| Niveau | Voorwaarde |
|---|---|
| `high` | Door coach bevestigd, of citaat geverifieerd én typevalidatie geslaagd én geen conflict |
| `medium` | Uit document, citaat niet terugvindbaar, geen conflict |
| `low` | Afgeleid, of conflicterende waarden uit meerdere documenten |

Naast het niveau toont de UI altijd de herkomst: welk document, welke pagina, welk citaat. Dat is
wat een coach nodig heeft om snel te reviewen.

## Milestones

Elke milestone is los te reviewen en levert iets dat draait.

### M1, fundament (dag 1-3)
- `create-next-app` in `~/Projects/athlete-intake`, TypeScript, App Router, Tailwind. Eigen git repo.
- `supabase init`, lokale stack, migraties in `supabase/migrations/`.
- Migraties: beide schema's, alle tabellen hierboven, RLS-policies, audit-triggers op de medische
  tabellen, `field_definitions`-seed met de zeven informatieblokken uit het voorstel (toestemming,
  identiteit, biometrie, trainings- en wedstrijdhistoriek, medische historiek, huidige status en
  doelen, uploads).
- Supabase Auth: magic link voor atleten, coach-rol via `profiles.role`.
- `medical`-schema uit de PostgREST-exposure houden, zodat de browser er per constructie niet bij kan.
- **Taxonomie bevriezen aan het einde van M1.** Nieuwe velden daarna zijn een change request.

### M2, opname en extractie (dag 4-6)
- Uploadscherm: signed upload URL uit een route handler, bestand gaat rechtstreeks van browser naar
  Storage. Geen bestand door een function, dus geen bodylimiet-gedoe.
- `lib/extract/pages.ts`: tekst per pagina uit tekst-PDF's, opgeslagen in `document_pages`.
- `lib/extract/whatsapp.ts`: eigen tolerante parser voor WhatsApp-exports. Meerdere datumformaten en
  locales, afzenderattributie, systeemregels eruit.
- `lib/claude/extractDocument.ts`: één call per document met structured outputs. Het schema eist per
  veld `{ value, source_page, source_quote }`, dus provenance is geen vrije keuze van het model maar
  een schemavereiste. Gescande PDF's als `document` block, screenshots als `image` block,
  prompt-caching op het documentblok.
- `lib/verify/quote.ts`: fuzzy match van `source_quote` tegen `document_pages.extracted_text`, zet
  `quote_verified`. Dit is de kern van de eerlijke betrouwbaarheidsindicatie.

### M3, dossier en volledigheid (dag 7-9)
- `lib/dossier/merge.ts`: voorgestelde velden mergen, conflicten detecteren tegen bestaande waarden,
  historie bewaren via `superseded_by`.
- `lib/dossier/completeness.ts`: `field_definitions` joinen met huidige waarden, per veld status en
  `confidence` volgens de tabel hierboven.
- Blessuretijdlijn opbouwen uit `injury_events`, met recidiefkoppeling.
- **Evalharnas** (`npm run eval`): fixtures in `evals/fixtures/`, verwachte waarden in
  `evals/expected/`, script diff't de pipeline-output. `evals/fixtures/` staat in `.gitignore`, echte
  klantdocumenten komen nooit in git. Een kleine synthetische set wordt wel gecommit zodat de eval in
  CI draait.

### M4, intakegesprek (dag 10-12)
- Publieke intakepagina, bereikbaar via de linktree. Consent-flow eerst: doel van verwerking,
  medische toestemming, bewaartermijn. Consent wordt versienummerd opgeslagen voor er iets anders
  gebeurt.
- Chat die enkel vraagt naar velden met status `missing` of `conflicting`, in volgorde van de
  verplichte velden. Streaming antwoorden uit een route handler.
- Antwoorden landen als `field_values` met `proposed_by: 'athlete'`.
- NL/EN via `next-intl`, ook de promptteksten.

### M5, review en output (dag 13-15)
- Coach-reviewscherm: één pagina, secties uit `field_definitions`, per veld de waarde, de status, het
  niveau en de herkomst met een klikbaar citaat naar de brondocumentpagina. Inline corrigeren.
  Goedkeuren bevriest een snapshot in `intake_reports.frozen_snapshot`.
- Intakerapport als PDF uit het snapshot, met expliciete scheiding tussen feitelijke data en
  interpretatie, plus de lijst openstaande informatie.
- JSON- en CSV-export uit hetzelfde snapshot.

### M6, governance en oplevering (dag 16-17)
- Retentiejob: cron die `retention_until` afdwingt.
- Verwijderingspad: RPC `purge_athlete(id)` plus een job die de Storage-objecten en de
  `anthropic_file_id`-uploads opruimt. **Met een test die bewijst dat er niets achterblijft.** Dit is
  de eis waar iedereen op faalt en die de klant expliciet gevraagd heeft.
- Audit-log afronden: mutaties via triggers, leesacties op medische velden via een expliciete
  `log_medical_access()`-call in de data-access-laag. Triggers kunnen leesacties niet zien.
- Vercel-project, Supabase Frankfurt gelinkt, security headers en CSP naar het model van
  [kaspio's vercel.json](vercel.json).
- Volledige evalrun, overdrachtsdocument, subverwerkerslijst voor de GDPR-administratie van de klant.

## Randvoorwaarden

Zonder deze vier gaan de 17 dagen niet halen. Ze horen in de opdrachtbrief.

1. Taxonomie en veldenlijst bevroren na M1. Nieuwe velden nadien zijn een change request.
2. Testset van 20 tot 30 echte, geanonimiseerde documenten bij ons voor M2 start. Anders schuift alles.
3. Finetuning en het literatuurcorpus expliciet buiten fase 1. De mappenstructuur van de klant wordt
   later gescheiden retrieval-collecties per domein, geen getraind model. Dit moet zwart op wit, anders
   wordt fase 1 afgerekend op een verwachting die niet verkocht is.
4. Reviewweergave is één scherm. Geen dashboards, geen grafieken, geen atleetportaal.

Als er dagen tekortkomen sneuvelt M4 (de chat) als eerste. Een adaptief formulier bovenop sterke
extractie levert het grootste deel van de tijdswinst. De chat is de meest demo-vriendelijke en de
minst waardevolle post.

**Bijgesteld na overleg met de klant:**

- De Notion-koppeling zit in fase 1, niet in 1b. Gebouwd als drie databases (Atleten, Facturatie,
  Opvolgacties) met een harde filter: alleen niet-medische velden gaan mee, en de sync weigert als
  een veld uit de synclijst als medisch gemarkeerd raakt.
- Bewaartermijn is standaard onbeperkt in plaats van 60 maanden, met een verplichte grond in
  `retention_basis`. Het verwijderingspad blijft los daarvan werken.
- Het `medical`-schema wordt niet via PostgREST benaderd maar via een directe Postgres-verbinding met
  een beperkte rol. Sterkere garantie dan RLS zonder policies, en het antwoord op "wie kan bij onze
  medische data".

Buiten scope in fase 1, bewust: VALD API (in fase 1 alleen CSV-import, API-toegang is per klant
gelicentieerd en dat weten we nu niet), wearables, de anonieme benchmark op 150 VALD-profielen
(heridentificatierisico bij kleine n in nichesporten is een apart traject).

## Verificatie

1. `npx supabase db reset` draait alle migraties schoon door, seed inbegrepen.
2. `npm run eval` op de synthetische fixtures: extractie haalt de verwachte velden, citaten
   verifiëren, geen regressie. Draait in CI op elke promptwijziging.
3. Handmatige end-to-end run met de Browser-tools: intakepagina openen, consent geven, een gescande
   PDF plus een WhatsApp-export uploaden, chat de gaten laten vullen, in het coach-scherm reviewen en
   goedkeuren, PDF en JSON downloaden. Screenshots als bewijs.
4. Negatieve tests: een document zonder relevante inhoud (mag geen velden verzinnen), twee
   documenten met tegenstrijdige geboortedatum (moet `conflicting` opleveren, niet stil kiezen), een
   citaat dat niet in de brontekst staat (moet op `medium` uitkomen, niet op `high`).
5. `purge_athlete` test: atleet aanmaken met documenten, purgen, dan controleren dat er geen rijen,
   geen Storage-objecten en geen Files-API-uploads meer bestaan.
6. RLS-test: als atleet ingelogd proberen de intake van een andere atleet te lezen, en proberen het
   `medical`-schema direct te queryen. Beide moeten falen.
