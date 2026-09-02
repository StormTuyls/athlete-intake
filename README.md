# Atleetintake

AI-intake voor een praktijk die eliteatleten begeleidt. Nieuwe atleten leveren hun voorgeschiedenis
aan als een stapel PDF's, scans en WhatsApp-berichten. Dit systeem leest dat uit, vraagt gericht naar
wat ontbreekt, en levert de coach een gestructureerd dossier plus een intakerapport dat hij in één
scherm nakijkt en goedkeurt.

Fase 1 van een gefaseerd traject. Zie [docs/plan.md](docs/plan.md) voor de volledige scope, de
milestones en wat bewust buiten scope valt.

## Kernprincipe

**Het model schrijft nooit rechtstreeks in het dossier.**

Het stelt veldwaarden voor met bronvermelding: welk document, welke pagina, welk letterlijk citaat.
De server verifieert dat het citaat echt in dat document staat. Een regel bepaalt daaruit het
betrouwbaarheidsniveau. De coach keurt goed en bevriest een versie. Het rapport komt uit dat
bevroren snapshot, niet uit een live modelcall.

Daarmee is "de professional beslist" een eigenschap van het systeem in plaats van een belofte in een
document. En de betrouwbaarheidsindicatie is controleerbaar in plaats van een niet-gekalibreerd
getal dat het model over zichzelf rapporteert.

| Niveau | Voorwaarde |
| --- | --- |
| `high` | Door coach bevestigd, of citaat geverifieerd én typevalidatie geslaagd én geen conflict |
| `medium` | Uit document, citaat niet terugvindbaar, geen conflict |
| `low` | Afgeleid, of conflicterende waarden uit meerdere documenten |

## Pijplijn

```
browser -> signed upload URL -> Supabase Storage (ruw bestand, permanent, onaangeroerd)
        -> tekstextractie per pagina (nodig voor citaatverificatie)
        -> Claude-extractie per document, structured output met provenance per veld
        -> citaatverificatie server-side -> quote_verified
        -> merge in dossier, conflictdetectie
        -> volledigheidsregels -> per veld status + betrouwbaarheidsniveau
        -> chat vraagt enkel naar wat ontbreekt of conflicteert
        -> coach reviewt, keurt goed -> snapshot bevroren
        -> PDF-rapport en JSON/CSV-export uit het snapshot
```

## Stack

- **Next.js 16** (App Router) op Vercel. Route handlers doen de documentverwerking.
- **Supabase** in regio Frankfurt: Postgres, Storage, Auth. Postgres is de single source of truth
  vanaf dag één, niet Notion.
- **Anthropic SDK** met `claude-opus-5`. Niet via een abstractielaag: we hebben eerstelijns toegang
  nodig tot document content blocks met pagina-locaties, expliciete prompt-caching en structured
  outputs.
- **Notion** voor de commerciele laag: facturatie en opvolgacties. Met opzet zonder medische data.
- **Geen aparte OCR-dienst.** Gescande PDF's gaan als `document` content block naar Claude,
  screenshots als `image` block. Eén integratie en één subverwerker minder.
- **Tailwind 4**, **next-intl** (NL/EN).

## Databescheiding

Twee Postgres-schema's, met opzet gescheiden:

- **`public`** — identiteit, administratie, consent, audit-log. De browser mag hier via RLS bij.
- **`medical`** — documenten, voorstellen, dossier, blessuretijdlijn, testmetingen, rapporten. Dit
  schema staat **niet** in de exposed schemas van Supabase, dus PostgREST heeft er geen route naartoe.
  De server praat er rechtstreeks met Postgres, via de rol `intake_server` die verder niets mag.

Die tweede regel is het belangrijkste ontwerpbesluit in deze repo. De gebruikelijke aanpak (schema
wel exposen, en toegang tegenhouden met RLS zonder policies) werkt tot iemand een policy of een
grant toevoegt. Nu kan de HTTP-API die het internet aanspreekt medische data per constructie niet
bereiken. Bij artikel 9-data is dat het verschil tussen een uitleg en een incident.

Drie lagen, elk voldoende op zichzelf:

1. `medical` staat niet in `[api] schemas` in `supabase/config.toml`. PostgREST antwoordt
   `Invalid schema: medical`.
2. `anon` en `authenticated` hebben geen enkel recht op het schema.
3. RLS staat aan op alle tabellen, met nul policies.

Medische data valt onder artikel 9 AVG. De consequenties daarvan (rechtsgrond, bewaartermijn,
subverwerkerslijst, verwijderingspad) zijn geen bijzaak maar een deel van de opdracht.

### Bewaartermijn

`athletes.retention_mode` is `indefinite` of `until_date`, met een constraint die de combinatie
afdwingt: onbeperkt bewaren vraagt een benoemde grond in `retention_basis`, en een einddatum vraagt
een datum. Zo is er geen dubbelzinnige `null` die zowel "vergeten" als "voor altijd" kan betekenen.

Standaard is onbeperkt, want de praktijk wil dossiers houden. Dat is verdedigbaar met een grond zoals
de bewaarplicht voor een zorgdossier, niet als stilzwijgende default. Het verwijderingspad blijft
altijd werken: het recht op wissing staat los van de bewaartermijn.

## Aan de slag

Vereist: Node 20+, Docker (voor de lokale Supabase-stack), Supabase CLI.

```bash
npm install
cp .env.example .env.local
```

Start de lokale database en neem de URL en keys uit de output over in `.env.local`:

```bash
supabase start
```

Draai de migraties en de seed:

```bash
npm run db:reset
```

Start de app:

```bash
npm run dev
```

Health check:

```bash
curl -s http://localhost:3000/api/health
```

## Scripts

| Script | Doet |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Productiebuild |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:reset` | Alle migraties plus seed schoon doorheen draaien |
| `npm run db:diff -- <naam>` | Nieuwe migratie genereren uit lokale schemawijzigingen |
| `npm run eval` | Evalharnas op de fixtures, zie [evals/README.md](evals/README.md) |
| `npm run test` | Unit- en integratietests, inclusief de conflict- en lektests |
| `npm run notion:setup -- <page_id>` | Maakt de Notion-databases eenmalig aan |

## Structuur

```
app/
  api/            route handlers. Alles wat medische data raakt, gebeurt hier.
  intake/         publieke intake, bereikbaar via de linktree
  review/         coach-reviewscherm, één pagina
lib/
  claude/         Anthropic client, documentextractie, intakegesprek
  extract/        paginatekst uit PDF's, WhatsApp-exportparser
  verify/         citaatverificatie
  dossier/        merge, conflictdetectie, validatie, volledigheid, betrouwbaarheid
  db/             sql.ts (directe Postgres), medical.ts (alle medische queries)
  intake/         sessie via capability token, documentverwerking
  notion/         commerciele sync, met de lekcontrole
  supabase/       browserclient (RLS) en serverclient (public + storage)
supabase/
  migrations/     versienummerde schemawijzigingen
evals/            testset en verwachte output
docs/plan.md      scope, milestones, randvoorwaarden
```

## Wat hier niet in hoort

- **Echte klantdocumenten.** `evals/fixtures/real/` staat in `.gitignore`. Alleen synthetische
  fixtures worden gecommit.
- **Secrets.** `.env.local` staat in `.gitignore`. De service role key en de Anthropic key horen in
  de Vercel-omgeving, niet in de repo.

## Status

De intake werkt end-to-end tegen een lokale Postgres in Docker, met echte modelcalls.

Gemeten op de synthetische testset:

| Fixture | Resultaat |
| --- | --- |
| Kinesitherapieverslag (tekst-PDF, 1 pagina) | 20 velden, 20 van 20 citaten geverifieerd, 3 blessures, 17s |
| WhatsApp-export (10 berichten) | 13 velden, 13 van 13 citaten geverifieerd, 1 blessure, 16s |
| Huurcontract (niet relevant) | 0 velden. Het model verzint niets. |
| Beide atletendocumenten in één intake | Gewicht 76,5 tegenover 77 wordt `conflicting`, rivaal met herkomst bewaard, indienen blokkeert |
| Gesprek, één antwoord met zes feiten | Alle zes opgepikt (lengte, gewicht, sport, discipline, club, federatie), niets verzonnen |

Nog te doen: reviewweergave voor de coach, intakerapport als PDF, JSON- en CSV-export, retentiejob,
verwijderingspad en de meertalige UI. Zie [docs/plan.md](docs/plan.md).
