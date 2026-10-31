# De splitsing, geteld

`screening-app.md` zegt wat er verhuist en waarom. Dit zegt hoeveel het is, welke bestanden het
precies zijn, en wat er af moet voordat de eerste commit valt. De lijsten hieronder komen uit de
boom zoals hij nu is, niet uit het geheugen: elk pad is nagekeken.

Geteld op 30 oktober 2026, bij `main` op `6bb72a1`.

---

## 1. Wat verhuist: 30 bestanden

Alles hieronder is screening en niets anders. De intake heeft er geen enkele import op.

| Groep | Paden |
|---|---|
| Rekenwerk | `lib/screening/` (10 modules) |
| Databank | `lib/db/screening.ts`, `screeningNotes.ts`, `referenceRules.ts` |
| Rapport | `lib/report/screeningFreeze.ts`, `screeningSnapshot.ts` |
| Schermen | `app/coach/screening/`, `app/coach/library/` |
| Routes | `app/api/coach/screening/`, `app/api/coach/reference-rules/` |
| Componenten | `ScreeningEntry`, `ScreeningNotes`, `MetricTrend`, `RuleEditor`, `ClassificationToggle` |
| Seed | `scripts/seed-screening.ts` |

**Migraties: 8 van de 30.** `20261009090000_screening_types` tot en met
`20261011100000_screening_note_author`, aaneengesloten in de tijdstempelvolgorde.

**Tests: 9.** `evals/screening.test.ts`, zeven `evals/unit/screening-*.test.ts` en
`evals/unit/reference-rules.test.ts`.

## 2. Wat mee moet om te compileren: 15 bestanden

De 30 verhuizende bestanden reiken naar precies zeven modules buiten zichzelf. Die zeven trekken er
samen acht mee. Dit is de transitieve sluiting, inclusief relatieve imports.

| Bestand | Regels | |
|---|---:|---|
| `lib/review/access.ts` | 104 | 8 aanroepen vanuit de screening |
| `lib/audit.ts` | 51 | 5 |
| `lib/http.ts` | 40 | 4 |
| `lib/db/sql.ts` | 126 | 3 |
| `lib/i18n/server.ts` | 32 | 1 |
| `lib/report/branding.ts` | 26 | 1 |
| `components/review/AutoPrint.tsx` | 21 | 1 |
| `lib/db/supabaseCa.ts` | 51 | via `sql.ts` |
| `lib/errors.ts` | 43 | via `http.ts` |
| `lib/i18n/locale.ts` | 47 | via `i18n/server.ts` |
| `lib/i18n/translator.ts` | 48 | via `i18n/server.ts` |
| `lib/supabase/server.ts` | 43 | via `access.ts` |
| `lib/supabase/service.ts` | 40 | via `access.ts` |
| `messages/nl.json` | 716 | vertalingen |
| `messages/en.json` | 716 | vertalingen |

Samen 2104 regels, waarvan 1432 de twee berichtenbestanden. De eigenlijke code is dus ongeveer 670
regels.

**De grens is schoon.** Geen enkel verhuizend bestand importeert de intake-sessielaag, het dossier,
de chat of de documenten. Dat bevestigt wat `screening-app.md` claimt over het losknippen van
`lib/http.ts`: die koppeling is weg en er is geen nieuwe bijgekomen.

## 3. Wat er daarnaast nodig is om te draaien

Deze bestanden worden niet geïmporteerd door de screening, maar zonder hen draait er geen app:

`app/layout.tsx`, `app/globals.css`, `proxy.ts`, `i18n/request.ts`, en de hele loginkant
(`app/coach/login/`, `components/coach/CoachLogin.tsx`, `app/auth/`).

`lib/db/athletes.ts` staat in `screening-app.md` op de gedeelde lijst, maar de screeningcode
importeert hem nergens. Of hij mee moet hangt af van wat het atletenscherm in de nieuwe app doet;
vandaag is hij niet nodig om te compileren.

## 4. Wat er af moet vóór de eerste commit

Dit is de volgorde die telt. Wie eerst kopieert en daarna opschoont, heeft de afkapwaarden
alsnog in de geschiedenis van de nieuwe repo staan, en daar krijg je ze niet meer netjes uit.

1. **De afkapwaarden uit `lib/screening/library.ts`.** Dat bestand is 594 regels met 17
   bandenarrays en 72 losse drempelwaarden. Ze komen uit Frederiks Screening 2025-bestanden. Ze
   horen in een seed die niet in git staat, met `library.ts` als lege vorm eromheen.
2. **De Supabase-projectverwijzing uit `vercel.json`.** Staat in de CSP op regel 25, in
   `connect-src`, als volledige projecturl. Moet een env-variabele worden.
3. **`docs/oplevering.md` blijft hier.** En sinds deze week geldt hetzelfde voor
   `change-request-testbibliotheek.md`: daar staan Frederiks benchmarks met citaten en zijn interne
   asymmetriegrenzen in.

## 5. De purge is een gedeeld contract, geen gedeelde code

Het wissen van screeningdata verhuist niet, want het zit niet in de applicatiecode. De intake roept
`medical.purge_athlete()` aan en de databank doet de rest: de drie screeningtabellen hangen met
`athlete_id ... on delete cascade` aan `public.athletes`. In `lib/purge/` staat alleen een
typedeclaratie van de tellingen die die functie teruggeeft.

Die functie wordt door twee migraties gedefinieerd:

| Migratie | Van wie | Geeft terug |
|---|---|---|
| `20260908150000_purge_function.sql` | intake | zeven tellingen |
| `20261009090300_screening_purge.sql` | screening | veertien tellingen plus `screening_session_ids` |

De tweede doet een `create or replace` over de eerste heen. Wie als laatste `supabase db push`
draait bepaalt dus welke versie leeft, en dat is precies het probleem uit §2b van
`screening-app.md`.

**Afgesproken:** de cascade en de functie blijven waar ze zijn. Na de splitsing herdefinieert alleen
`unbound-screening` nog `purge_athlete`. Het json-contract van die functie is de koppeling tussen
de twee repo's, en `PurgeCounts` in `lib/purge/db.ts` volgt dat contract in plaats van er een eigen
waarheid naast te zetten.

**Wat daarbij misgaat als je niets doet:** zodra de acht migraties uit deze repo verdwijnen, levert
`supabase db reset` hier de intakeversie van de functie op, zonder screeningtellingen, terwijl
`PurgeCounts` ze wel verwacht. Lokaal breekt dat stil; in productie niet, want daar is de
screeningmigratie al toegepast. Dat is een reden te meer voor de `baseline.sql` uit §2b.

## 6. Wat niet beslist is, en dus blokkeert

**Wie de repo bezit.** De `gh`-cli hier is ingelogd als `tuylss`, met pushrecht op
`StormTuyls/athlete-intake` maar zonder recht om repo's onder `StormTuyls` aan te maken. De repo is
daarom nog niet gemaakt. Dat is geen technisch ongemak: het is dezelfde eigendomsvraag die
`screening-app.md` stelt over de databank, en die moet beslist zijn vóór de overdracht.

**Publiek of privé.** `overdracht.md` zegt publiek, mét opschoonronde. Die afspraak is van vóór de
change request. Zet het op privé tot punt 4 af is en tot Frederik weet dat zijn protocol en zijn
benchmarks naar buiten gaan. Een repo die eenmaal publiek is geweest, is gekopieerd.

**Een eigen databankrol.** `screening-app.md` §2 laat de keuze open tussen een eigen
`screening_server`-rol en dezelfde `intake_server`. Dat is één migratie en het hoort bij deze stap,
niet erna.
