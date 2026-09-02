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
  nodig tot document content blocks met pagina-locaties, de Files API, expliciete prompt-caching en
  structured outputs.
- **Geen aparte OCR-dienst.** Gescande PDF's gaan als `document` content block naar Claude,
  screenshots als `image` block. Eén integratie en één subverwerker minder.
- **Tailwind 4**, **next-intl** (NL/EN).

## Databescheiding

Twee Postgres-schema's, met opzet gescheiden:

- **`public`** — identiteit, administratie, consent, audit-log. De browser mag hier via RLS bij.
- **`medical`** — documenten, veldwaarden, blessuretijdlijn, testmetingen, rapporten. Dit schema is
  **niet** via PostgREST bereikbaar (zie de waarschuwing in `supabase/config.toml`). Alle toegang
  loopt via server-side route handlers met de service role, na autorisatie en een audit-log entry.

Medische data valt onder artikel 9 AVG. De consequenties daarvan (rechtsgrond, bewaartermijn,
subverwerkerslijst, verwijderingspad) zijn geen bijzaak maar een deel van de opdracht.

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

## Structuur

```
app/
  api/            route handlers. Alles wat medische data raakt, gebeurt hier.
  intake/         publieke intake, bereikbaar via de linktree
  review/         coach-reviewscherm, één pagina
lib/
  claude/         Anthropic client en documentextractie
  extract/        paginatekst uit PDF's, WhatsApp-exportparser
  verify/         citaatverificatie
  dossier/        merge, conflictdetectie, volledigheid en betrouwbaarheid
  supabase/       browserclient (RLS) en serviceclient (medical)
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

M1 in opbouw: repo-fundament staat, datamodel en migraties volgen. De pipeline-modules in `lib/`
bestaan als contract (types en signatures) en gooien bewust een fout tot ze in hun milestone
geïmplementeerd worden. Zie [docs/plan.md](docs/plan.md).
