# De screening als aparte webapp

Beslisdocument, geen bouwplan. Er staat in wat er moet worden besloten voordat er een regel code
verhuist, en wat we al weten omdat het is nagekeken. Waar iets niet nagekeken is, staat dat erbij.

## Waarom

De screeningsmodule is in oktober in deze repo gebouwd, naast de intake. Dat was de goedkoopste weg om
hem te laten werken, niet de juiste plek om hem te laten groeien. De spec die eronder ligt
(`UNBOUND_Screening_Performance_Ecosystem_Specification`) beschrijft geen module maar een platform:
VALD-import, wearables, trainingsbelasting, cohortpercentielen, alerts. Dat is een product met een
eigen levensloop, en mogelijk met eigen klanten die de intake niet afnemen.

**Vastgelegd:** eigen repo, eigen deploy, **hetzelfde Supabase-project**.

Die laatste is de belangrijkste en de minst omkeerbare. De spec zegt in §1 waarom: "The athlete
profile is the single source of truth. VALD, manual tests, training systems and wearables are data
sources feeding that profile; they are not separate destinations." Een eigen databank zou betekenen
dat er twee atleetprofielen bestaan die gesynchroniseerd moeten blijven, en dan is de eerste vraag bij
elk verschil "welke klopt".

## 1. Wat verhuist, wat wordt gedeeld

### Verhuist, en is gesloten

De screeningcode hangt nauwelijks aan de rest. Negen modules in `lib/screening/*` hebben als enige
externe import `zod` (in `bands.ts`). Daarbovenop:

| | |
|---|---|
| Data en rekenwerk | `lib/screening/*`, `lib/db/screening.ts`, `screeningNotes.ts`, `referenceRules.ts` |
| Rapport | `lib/report/screeningFreeze.ts`, `screeningSnapshot.ts` |
| Schermen | `app/coach/screening/*`, `app/coach/library/*`, `app/api/coach/screening/*`, `app/api/coach/reference-rules/*` |
| Componenten | `ScreeningEntry`, `ScreeningNotes`, `MetricTrend`, `RuleEditor`, `ClassificationToggle` |
| Seed | `scripts/seed-screening.ts` plus `lib/screening/library.ts` als bron |
| Migraties | `20261009090000` tot en met `20261011100000` |
| Tests | `evals/screening.test.ts` en zeven `evals/unit/screening-*.test.ts` plus `reference-rules.test.ts` |

### Wordt door beide gebruikt

Dit is de eigenlijke beslissing, en de duurste om later terug te draaien:

`lib/db/sql.ts` + `lib/db/supabaseCa.ts`, `lib/supabase/service.ts` + `server.ts`, `lib/audit.ts`,
`lib/http.ts`, `lib/review/access.ts`, `lib/i18n/*`, `i18n/request.ts`, `proxy.ts`, `app/layout.tsx`,
`app/globals.css` (Tailwind 4, geen config, alle tokens in `@theme`), `lib/db/athletes.ts`,
`lib/report/branding.ts`, `components/review/AutoPrint.tsx`, en de hele loginkant
(`app/coach/login`, `components/coach/CoachLogin.tsx`, `app/auth/*`).

Drie manieren, in volgorde van wat ik zou doen:

1. **Kopiëren en laten divergeren.** Snelst, en eerlijk over wat er gebeurt: twee producten die
   toevallig dezelfde oorsprong hebben. De prijs is dat een fix in `lib/db/sql.ts` (zoals de
   date-parser en de `sslmode`-truc, allebei duur bevochten) twee keer gedaan moet worden, en de
   tweede keer vergeten wordt.
2. **Een gedeeld npm-pakket** (`@unbound/core` of zo). Netter op papier, maar het betekent versies,
   releases en een build-stap tussen een wijziging en het effect ervan. Voor twee apps van één team is
   dat meestal meer ceremonie dan winst.
3. **Een monorepo met twee Vercel-projecten.** Gedeelde code zonder publicatiestap, allebei de apps
   deployen uit dezelfde repo met een eigen root directory. Dit is wat Vercel hiervoor heeft, en het
   houdt de belofte "eigen deploy" zonder de belofte "eigen repo".

Optie 3 geeft het meeste voor het minste, maar botst met "eigen repo". Als dat laatste er vooral is om
de screening apart te kunnen verkopen of overdragen, dan is 1 het antwoord en moet dat bewust gekozen
worden, niet als gevolg.

### Eén koppeling moet sowieso doorgeknipt

`lib/http.ts` importeert `IntakeAuthError` en `IntakeLockedError` uit `lib/intake/session.ts`, puur
voor twee `instanceof`-takken in `handleError`. Elke screeningroute importeert `handleError`, en
sleept daarmee de hele intake-sessielaag mee (die op zijn beurt `appDb` en `createServerSupabase`
binnentrekt). Dat is een paar regels werk en het moet gebeuren vóór de splitsing, niet erna.

## 2. Databanktoegang voor een tweede applicatie

Hoe het nu staat, en dat is bewust zo:

- Het `medical`-schema staat **niet** in de exposed schemas van Supabase (`supabase/config.toml`
  noemt alleen `public` en `graphql_public`). De HTTP-API die het internet aanspreekt heeft dus geen
  route naar artikel 9-gegevens, ook niet als iemand later per ongeluk een policy toevoegt.
- Alles wat `medical` raakt loopt over een directe Postgres-verbinding met de rol `intake_server`
  (`lib/db/sql.ts`). Die rol heeft `bypassrls`, mag alles in `medical`, en in `public` alleen `select`
  op `field_definitions`, `intakes` en `athletes` plus `insert` op `audit_log`
  (`20260902110000_grants.sql`).
- Op de screeningstabellen staat RLS **aan met nul policies**
  (`20261009090200_screening_medical.sql`). De serverrol is het slot; RLS is het vangnet voor als er
  ooit een andere verbinding bijkomt.

**Te beslissen:** een eigen rol voor de screening-app, of dezelfde `intake_server`.

Een eigen rol (`screening_server`) is één migratie en levert twee dingen op: het wachtwoord van
`intake_server` blijft bij één applicatie, en de grants zeggen wat de screening-app mag. Dezelfde rol
delen betekent dat twee deploys hetzelfde wachtwoord dragen en dat het intrekken ervan beide apps
raakt. Ook de poolinstelling is gedeeld: `lib/db/sql.ts` zet `max: 4` per instantie, en dat telt bij
elkaar op over twee apps.

Verder nodig, uit `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (voor `profiles`, `athletes` en `audit_log`), `DATABASE_URL` en
`NEXT_PUBLIC_APP_URL`. Niet nodig: `ANTHROPIC_API_KEY`, alle `NOTION_*`, `RETENTION_*`, `CRON_SECRET`,
`TRANSCRIBE_*`.

## 3. Sessies over twee domeinen

`proxy.ts` verlengt de Supabase-sessie via cookies op het eigen domein, en doet verder met opzet geen
autorisatie. Twee apps op twee hostnames betekent dus **twee keer inloggen**, tenzij de cookies op het
bovenliggende domein gezet worden.

Dat laatste kan, maar het is een veiligheidskeuze: een cookie op `.unbound.be` is leesbaar voor elke
subdomein-app, inclusief een toekomstige die je niet zelf bouwt. Voor twee apps van dezelfde praktijk
is dat verdedigbaar; het hoort alleen opgeschreven te worden in plaats van te ontstaan.

**Niet nagekeken.** Of Supabase Auth met een cookie-domein over subdomeinen werkt zoals verwacht, is
niet getest. Dat is het eerste wat je uitprobeert voordat je er een architectuur op baseert.

Let ook op: de matcher in `proxy.ts` dekt `/coach/:path*` maar **niet** `/api/coach/:path*`. Die
API-routes draaien dus zonder tokenvernieuwing vooraf en leunen op de cookie zoals hij binnenkomt. Dat
werkt, maar het betekent dat een net verlopen token op een API-route een 401 geeft waar een
paginanavigatie hem nog had vernieuwd.

## 4. Atleten en coaches leggen allebei screenings af

Gevraagd: beide groepen moeten een screening kunnen afleggen. De kleine helft daarvan is klein. De
grote helft is een bestaand gat.

### Wat al klaarstaat

- `ScreeningEntry` heeft geen enkele coachafhankelijkheid: de props zijn `{ athleteId, tests }` plus
  `next-intl`.
- `medical.screening_sessions.tester_profile_id` is nullable, net als `created_by` en
  `measurements.entered_by`.
- `source_system` is tekst zonder check-constraint en staat hardgecodeerd op `'manual'`
  (`lib/db/screening.ts`). Daar past `'self'` in zonder migratie.
- De bibliotheektabellen in `public` zijn al leesbaar voor elke ingelogde gebruiker
  (`20261009090100`, policies `using (true)` voor `authenticated`).
- `currentAthlete()` in `lib/intake/athlete.ts` levert precies de identiteit die nodig is, met
  `deleted_at is null` erin.

De kleinste vorm is dus: één extra route die dezelfde `createSession()` aanroept met een andere
actorbepaling, plus `actorKind` als parameter in plaats van de vier hardgeschreven `"coach"`-waarden
in `lib/db/screening.ts`. Geen nieuwe tabellen, geen nieuwe rollen.

### Maar niet voordat dit is opgelost

**Er is nergens een koppeling coach-atleet in een autorisatiepad.** `POST /api/coach/screening` doet
`requireCoach()` en schrijft daarna naar de `athleteId` die de client meestuurt, zonder te controleren
of die atleet bestaat, verwijderd is, of iets met de aanroeper te maken heeft. `getSession()` filtert
alleen op sessie-id, `listSessions()` alleen op `athlete_id`, en `athletes.practitioner_id` wordt in
geen enkele autorisatiebeslissing gebruikt. Elke ingelogde behandelaar ziet en schrijft elke screening
van elke atleet.

Bij een praktijk met één behandelaar is dat een beperking. Zodra atleten mogen invoeren is het een
gat: zonder de `athleteId` server-side uit `currentAthlete()` te halen, kan elke atleet een sessie
onder het dossier van een ander wegschrijven.

Twee dingen vastleggen:

1. Bij zelfinvoer komt de `athleteId` **nooit** uit het verzoek. Niet-onderhandelbaar.
2. Wil de praktijk een coach-atleetkoppeling afdwingen? Met één behandelaar niet nodig; met een team
   en een externe kinesist wel. Dit is dezelfde vraag die `athletes.practitioner_id` al stelt maar
   waar nog niets mee doet.

### En een inhoudelijke, geen technische

Een door de atleet zelf gemeten waarde is een ander soort gegeven dan een door de staf gemeten waarde.
Dat verschil hoort in de data te zitten en in het rapport zichtbaar te zijn, niet alleen in wie er
inlogde. `source_system = 'self'` dekt de data; het rapport moet het ook tonen, anders leest een
zelfgemeten hamstringkracht straks als een ForceFrame-meting.

Plus: welke blokken mag een atleet afnemen? Een `ScreeningEntry` met het hele testaanbod erin vraagt
om waarden die zonder toestel of tweede persoon niet te meten zijn. Een deelverzameling kiezen is
klinisch werk, geen technisch werk.

## 5. De vier vergelijkingsgroepen

Spec §5 definieert vier lagen. `public.reference_layer` is een enum met er drie:

| Laag | Spec | In het schema | Gebouwd |
|---|---|---|---|
| 1 | Tegen zichzelf (baseline, vorige test, PB) | `self` | ja, `lib/screening/baseline.ts` |
| 2 | Tegen dezelfde profielen (cohortpercentielen) | **ontbreekt** | nee |
| 3 | Tegen de wetenschap (gepubliceerde drempels) | `published` | ja |
| 4 | Tegen de interne doelwaarde van de praktijk | `internal_target` | ja |

Laag 2 staat er bewust niet in, met de reden in `20261009090000_screening_types.sql`: spec §10 noemt
percentielen over een klein cohort actief schadelijk, en de praktijk heeft de aantallen niet. Een
enumwaarde toevoegen is later een eenregelige migratie; een ongebruikte waarde weghalen niet.

**Wat erbij hoort als laag 2 wel gebouwd wordt:** een minimum-N-poort met een getal erin, en
percentielen nooit tonen zonder N en zonder de filterdefinitie erbij (spec §10 opnieuw).

### Er zit een tweede ding onder, en dat is urgenter

De filterkolommen voor populatie bestaan al op `public.reference_rules` (`sex`, `sport`, `event`,
`competition_level`, `age_min`, `age_max`) en de gegevens staan op `public.athletes` (`sex`,
`competition_level`, `sport`, `discipline`, `date_of_birth`).

`getLibrary()` keek daar niet naar. Hij joinde de regels zonder enige filter, dus lag er één actieve
regel per metriek voor iedereen: een vrouw van 17 in de atletiek werd tegen dezelfde drempel gelegd
als een man van 28 in het roeien.

**Gerepareerd.** `getLibrary(population)` krijgt nu de populatie mee, en `lib/screening/population.ts`
kiest de regel. Drie dingen liggen daarin vast, en de eerste is de gevaarlijkste om fout te hebben:

- **Onbekend is geen match.** Staat het geslacht op `unspecified` (de standaardwaarde van de kolom),
  dan geldt een regel die op geslacht filtert NIET. Iemand indelen tegen een vrouwennorm omdat zijn
  geslacht leeg staat is erger dan hem niet indelen.
- **Specifieker wint**, met de leeftijdsband als één dimensie en niet als twee. Bij gelijkspel de
  hoogste versie, dan het hoogste id.
- **Zonder populatie gelden alleen regels zonder beperking.** Niet de eerste de beste: een
  vrouwendrempel tonen op een scherm dat niet weet over wie het gaat, is precies de stille fout waar
  spec §10 voor waarschuwt.

Dat laatste maakt het ook een keuze in plaats van een filter, en daar zat een latente fout onder: de
unieke sleutel staat op `rule_key` plus `version` en niet op de metriek, dus zodra er regels per
populatie bestaan zijn er meerdere actieve regels per metriek. De oude query zou dezelfde test dan
twee keer in het invoerscherm zetten. `getLibrary()` groepeert nu per metriek en kiest er één.

Nagegaan tegen de lokale databank met een vrouwenregel erbij: vrouw van 17 krijgt die regel, man van
28 krijgt er geen, zonder populatie ook geen, en één rij per metriek in alle drie de gevallen.

## 6. De enige echte afhankelijkheid van de intake

`getTimelineEvents()` in `lib/db/screening.ts` queryt `medical.injury_events` om blessures als markers
op de trendgrafiek te zetten (spec §11). Dat is de enige harde koppeling. Het screeningrapport zelf
raakt niets uit de intake: `lib/report/screeningFreeze.ts` importeert alleen screeningcode, en de
snapshot alleen `node:crypto`.

Omdat de databank gedeeld blijft, blijft dit werken. Was er voor gescheiden data gekozen, dan was dit
het eerste geweest dat sneuvelde, en dan was het antwoord geweest: een API-call naar de intake-app
voor medische gegevens, wat precies de scheiding ondergraaft die het `medical`-schema oplevert.

## 7. Wat er van de spec nog open staat

Als bouwvolgorde, uit §16, met wat er al staat:

| Fase | Scope | Status |
|---|---|---|
| 1 | Screeningkern: profiel, testbibliotheek, protocollen, bronafkapwaarden, afgeleide metrieken, baseline, rapportexport | **staat**, 14 van de 20 functionele eisen |
| 2 | VALD-automatisering: atleetkoppeling, import, deduplicatie, metriekmapping | niets |
| 3 | Training en wearables: Garmin, WHOOP, dagelijkse tijdreeksen, belasting- en herstelcontext | niets |
| 4 | Cohorten en intelligentie: percentielen, alerts, AI-samenvattingen, interventie-naar-hertest | niets |

Open uit §15 (FR-nummers): FR-07 (cohortlaag), FR-09 tot en met FR-11 (integraties en deduplicatie),
FR-12 (event-annotaties op de grafiek bestaan nog niet, de protocolbreuklijn wel), FR-20 (AI-samenvatting
op screening; de intake heeft er een, de screening niet).

## Volgorde die ik zou aanhouden

1. ~~`lib/http.ts` losknippen van `lib/intake/session.ts`.~~ **Gedaan.** De drie foutklassen staan nu
   in `lib/errors.ts`, een bestand zonder enkele import; de oude plekken exporteren ze opnieuw zodat
   bestaande imports blijven werken. De importketen van `lib/http.ts` is daarmee van de halve
   intake-laag teruggebracht tot vijf bestanden: `errors.ts` en de drie i18n-modules.
2. ~~De `athleteId` server-side controleren.~~ **Gedaan.** `POST /api/coach/screening` laadt de atleet
   nu op en geeft 404 bij een onbekende of verwijderde id; daarvoor schreef het metingen weg onder
   elke uuid die de client meestuurde. **Nog open:** of DEZE behandelaar bij DEZE atleet mag. Zie §4.
3. ~~`getLibrary()` op populatie laten filteren.~~ **Gedaan.** Zie de bijgewerkte §5.
4. Zelfinvoer door atleten, inclusief `source_system = 'self'` en zichtbaarheid in het rapport.
5. Pas dan splitsen, met de keuze uit §1 bewust gemaakt.
6. VALD.

## Wat dit document niet beslist

- Welke van de drie deelvormen uit §1 het wordt. Dat hangt aan de vraag of de screening ooit los
  verkocht of overgedragen wordt, en dat weet de praktijk en wij niet.
- Of er een cookie-domein over subdomeinen komt. Eerst uitproberen.
- Welke testblokken een atleet zelf mag afnemen. Klinische vraag.
- Of laag 2 er komt, en bij welke N. Vraagt een uitspraak over hoeveel atleten de praktijk verwacht.
