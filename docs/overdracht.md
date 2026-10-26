# Overdracht

Voor wie dit project overneemt. Wat er draait, wat er besloten is, wat er open staat, en de
valkuilen die ons tijd gekost hebben.

Dit document veroudert. Klopt iets niet meer, werk het bij in plaats van het te negeren; het is
bedoeld om één keer gelezen te worden en dan vertrouwd.

Laatst bijgewerkt: 26 oktober 2026, bij `main` op `6bb72a1`.

---

## 1. Wat er draait

| | |
|---|---|
| Repo | `github.com/StormTuyls/athlete-intake`, productiebranch `main` |
| Vercel | https://athlete-intake.vercel.app, project `athlete-intake`, plan **Hobby** |
| Droplet | `142.93.101.125`, DigitalOcean fra1, Ubuntu 24.04, 1 vCPU, 961 MB + 2 GB swap |
| Droplet-URL | https://142.93.101.125.sslip.io |
| Supabase | project `iblhyekpyhpzhklfyvyh`, regio `eu-central-1` (Frankfurt), plan Free |
| Databank | 30 migraties toegepast, nul open |

**Beide deployments lezen dezelfde databank.** Dat is een tussenstand, geen eindtoestand: de droplet
is er omdat Vercel Hobby niet voor commercieel gebruik mag en dit een betaald klantproject is (zie
`oplevering.md`, open punt 2). Zet Vercel uit zodra de droplet bewezen is.

### Uitrollen naar de droplet

```bash
ssh root@142.93.101.125 unbound-deploy
```

Haalt `main` op, draait `npm ci`, bouwt, herstart en controleert `/api/health`. Komt er geen 200, dan
stopt het script met de laatste 30 logregels in plaats van stil een kapotte versie te laten staan.

Wat waar staat op de droplet:

- App als gebruiker `unbound` in `/srv/unbound/app`, gebonden aan **loopback** 3000.
- Caddy ervoor doet TLS en draagt de zeven security headers die eerst in `vercel.json` stonden.
- `/srv/unbound/app/.env.production`, modus 600, eigendom van `unbound`.
- systemd: `unbound-intake.service`, plus `unbound-retention.timer` om 03:15 (verving de Vercel-cron).
- Deploy-sleutel van de droplet staat als read-only deploy key bij GitHub.
- Het deploy-script staat **alleen op de droplet** (`/usr/local/bin/unbound-deploy`) en niet in de
  repo. Bus-factor van één; zet hem in `scripts/` bij de eerste gelegenheid.

### De tijdelijke hostnaam

`142.93.101.125.sslip.io` is gewoon het IP met een naam eromheen, zodat Let's Encrypt er een
certificaat op kan zetten. HSTS staat daarom bewust op `max-age=86400` **zonder** `includeSubDomains`
en `preload`: het is een gedeeld domein en die vlaggen zouden andere gebruikers raken. Komt er een
eigen domein, zet dan de strenge variant terug; dat staat als commentaar in de Caddyfile.

---

## 2. Beslissingen die niet uit de code te lezen zijn

**De screening wordt een aparte webapp.** Eigen repo, eigen deploy, **dezelfde** Supabase. De gedeelde
code wordt gekopieerd, niet gedeeld, omdat de intake wordt overgedragen aan de klant en de screening
niet; een monorepo kun je niet half overdragen. Alles staat in
[screening-app.md](screening-app.md), inclusief de prijs (een fix in `lib/db/sql.ts` moet twee keer).

**Wie eigenaar wordt van de databank is bewust uitgesteld.** Zodra de intake overgaat, delen twee
verschillende eigenaren één databank met artikel 9-gegevens. Dat is een juridische vraag met drie
uitkomsten, en hij moet beslist zijn **vóór** de overdracht, niet erdoor. Zie §"De vraag die bij de
overdracht valt" in screening-app.md.

**Dicteren heeft twee motoren.** Staat `TRANSCRIBE_API_KEY` gezet, dan loopt het over onze eigen route
naar een partij in het verwerkingsregister. Staat hij leeg (**nu het geval, ook in productie**), dan
valt het terug op de spraakherkenning van de browser en hoort Google of Apple de spraak. Dat staat in
de interface tegen de atleet en in de subverwerkerstabel. Die zin in de interface weghalen is een
juridische wijziging, geen tekstuele.

De browserherkenning is in het Nederlands matig op anatomische termen: "hamstring" wordt "handen
string". Voxtral en Whisper verstonden "adductoren" wél correct. Dat is het argument voor de sleutel.

**Het rapport blijft licht, het dashboard mag donker.** Spec §11. Het intakerapport is ook de
printweergave.

---

## 3. Wat er open staat, op volgorde

### Moet gebeuren voor de klant het gebruikt

1. **Een echte ronde door de intake op productie.** Niemand heeft ingelogd en de klachtvragen zien
   langskomen. De databank zegt dat ze er zijn; dat is niet hetzelfde.
2. **Supabase Auth wijst mogelijk nog naar Vercel.** Controleer `site_url` en de allow list onder
   Authentication → URL Configuration. Staan ze verkeerd, dan breken wachtwoordherstel en
   uitnodigingslinks stil. De gebruiker zei dat hij dit gedaan heeft; het is van buitenaf niet te zien,
   dus kijk bij de eerste herstelmail waar de link heen wijst.
3. **Vercel uitzetten** zodra de droplet bewezen is. Tot dan draaien er twee deployments op één
   databank.

### Gaten in de screening, los van de splitsing

Alle drie staan uitgewerkt in [screening-app.md](screening-app.md).

4. **Geen koppeling coach-atleet in enig autorisatiepad.** Elke ingelogde behandelaar ziet en schrijft
   elke screening van elke atleet. Bij één behandelaar een beperking; zodra atleten zelf invoeren een
   gat. De athleteId mag bij zelfinvoer **nooit** uit het verzoek komen.
5. **Zelfinvoer door atleten.** Gevraagd door de klant. Klein qua code (`currentAthlete()`,
   `source_system = 'self'` past zonder migratie), maar punt 4 moet eerst, en het rapport moet tonen
   dat een waarde zelf gemeten is.
6. **Cohortpercentielen** (laag 2 van de vier vergelijkingsgroepen). Bewust nog niet gebouwd: spec §10
   noemt percentielen over een klein cohort actief schadelijk. Vraagt een minimum-N-poort met een getal.

### De splitsing zelf

7. **`unbound-screening` aanmaken.** Besloten: publiek, mét opschoonronde. Die ronde is nog niet
   gedaan en bestaat uit drie dingen: de afkapwaarden uit `lib/screening/library.ts` naar een seed die
   niet in git staat, de Supabase-projectverwijzing uit `vercel.json` naar een env-variabele, en
   `docs/oplevering.md` blijft in de privérepo.

   **Frederik moet weten dat zijn screeningprotocol openbaar wordt.** Het komt uit zijn Screening
   2025-bestanden; het is niet van ons om weg te geven. Dit is geen formaliteit.
8. **Migraties verdelen** als de databank gedeeld blijft: eigendom per tabel, met een `baseline.sql`
   voor lokaal ontwikkelen in de screening-repo. Zie §2b in screening-app.md.
9. **VALD, wearables, trainingsdata.** Fase 2 tot 4 uit spec §16. Nog niets van gebouwd.

---

## 4. Ontwerp

Twee ontwerpen als klikbaar prototype, met echte tokens, verzonnen maar plausibele data:

- Resultaatscherm (licht, bestaande tokens): https://claude.ai/artifact/6uHErTLFwmWwkBZEMn7YUD
- Invoerscherm (zwart met groen en goud): https://claude.ai/artifact/9hMKszx1Gnq4fkYz9goMqz

**Let op: die twee spreken nu twee visuele talen.** Het resultaatscherm volgt de bestaande lichte app;
het invoerscherm volgt een richting die Frederik zou willen (zwart, groen, goud). Dat is een open
keuze, geen inconsistentie die per ongeluk ontstond. Wordt het donker, dan moet het resultaatscherm
mee; de informatie-indeling daarvan blijft dan gelden, alleen het palet verandert.

**Figma lukt niet.** Het account heeft een **View-seat op een starter-team** en kan geen bestand
aanmaken of bewerken. Niet opnieuw proberen zonder edit-seat; de foutmelding is misleidend
("don't have edit access to this file" bij het aanmaken van een nieuw bestand).

---

## 5. Valkuilen die tijd gekost hebben

Deze staan hier omdat ze alle vijf stil faalden.

**Gemerged is niet live.** Migraties draaien niet mee met een deploy. De klachtmodule stond twee dagen
in de code op productie zonder dat iemand hem kon gebruiken: de databank had nog 41 velden in plaats
van 57. Controleer na elke merge met een migratie: `npx supabase migration list`.

**Een gestapelde PR gaat niet vanzelf mee.** PR #26 stond op de branch van PR #25. Toen #25 gemerged
werd en zijn branch verdween, sloot GitHub #26 in plaats van hem om te hangen naar main. De commits
zaten daardoor nergens in. Zet een PR op `main` tenzij er een reden is om dat niet te doen.

**Vercel geeft "sensitive" variabelen niet terug.** `vercel env pull` schrijft `[SENSITIVE]` als
placeholder en meldt dat met een waarschuwing die erger klinkt dan het is. Bij ons waren het alleen de
vijf `NOTION_*`, die in productie toch leeg staan. Controleer welke het zijn voor je conclusies trekt.

**`next start` negeert `HOSTNAME`.** De app luisterde op alle interfaces in plaats van op loopback.
De firewall hield het tegen, maar dat was één regel verwijderd van de app naakt aan het internet.
Staat nu hard op `--hostname 127.0.0.1` in de systemd-unit.

**`npm ci` en `next build` passen niet in 961 MB.** Vandaar 2 GB swap. Verdwijnt die swap bij een
herinstallatie, dan faalt de build met een onduidelijke melding.

---

## 6. Hoe hier gewerkt wordt

- Nederlands, in code en commits. Commentaar legt vast **waarom** iets zo staat, vaak met een gemeten
  uitkomst erbij. Dat is het geheugen van dit project; haal het niet weg bij een opruiming.
- Een branch en een PR per onderwerp, met een beschrijving die het probleem benoemt en niet de diff
  navertelt.
- Nieuwe niet-triviale logica krijgt een test ernaast. Er zijn er 31, ze draaien zonder databank, en ze
  zijn snel: `for f in evals/unit/*.test.ts; do npx tsx "$f"; done`.
- `evals/chat.test.ts` en `evals/screening.test.ts` hebben wél een databank nodig, en de eerste ook een
  `ANTHROPIC_API_KEY`. Die vier modelcalls kosten centen, niet meer.
- De taxonomie in `supabase/seed.sql` is bevroren: een veld erbij is een change request. De laatste was
  `20261015090000`, de klachtmodule.
