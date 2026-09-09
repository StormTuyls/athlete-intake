# Oplevering: wat er staat, wie erbij kan, en wat open blijft

Dit is het overdrachtsdocument bij fase 1. Het beschrijft de draaiende omgeving, de
subverwerkerslijst voor de GDPR-administratie van de klant, en de punten die bewust open staan.

Wat hier niet staat, staat in [plan.md](plan.md) (het bouwplan, met de correcties erin) en in de
[README](../README.md) (hoe je het lokaal draait).

## De draaiende omgeving

| Onderdeel | Waarde |
|---|---|
| Repo | `github.com/StormTuyls/athlete-intake`, productiebranch `main` |
| Productie | https://athlete-intake.vercel.app |
| Vercel-project | `athlete-intake`, team `stormtuyls' projects`, plan Hobby |
| Uitvoeringsregio | `fra1` (Frankfurt), vastgezet in `vercel.json` |
| Supabase-project | `athlete-intake`, ref `iblhyekpyhpzhklfyvyh`, regio `eu-central-1` |
| Supabase-org | `Athlete Intake` (eigen org, los van kaspio), plan Free |
| Retentiejob | `/api/cron/retention`, dagelijks `15 3 * * *` |
| Behandelaarsaccount | `tuylss@factry.io`, rol `coach` |

De uitvoeringsregio is met opzet vastgezet. De standaardregio van Vercel is `iad1` (Virginia), en
dan zou de verwerking van medische data buiten de EU draaien terwijl de databank in Frankfurt staat.
Het CDN van Vercel blijft wereldwijd: dat termineert TLS en haalt de inhoud uit `fra1`.

### Wat er is nagerekend, niet aangenomen

Tegen de echte productie-URL, niet lokaal:

- De CSP staat op elk antwoord en blokkeert niets: geen enkele CSP-melding in de browserconsole bij
  het inloggen en het coachscherm.
- `medical` is niet bereikbaar via de Data API. Ook niet met de service-role-sleutel en een expliciete
  `Accept-Profile: medical`-header: PostgREST antwoordt `Only the following schemas are exposed:
  public, graphql_public`. Dat is laag een van de drie, en die is aantoonbaar.
- `anon` heeft nul rechten in `public`: `permission denied for table athletes`.
- De retentiejob faalt dicht. Zonder header 401, met een verkeerd secret 401, met het juiste secret
  200. Dat antwoord komt uit een echte query op `medical.purge_jobs` over de directe
  Postgres-verbinding, dus daarmee is ook bewezen dat die verbinding vanuit een Vercel-function werkt.
- De rol `intake_server` mag `medical` en `public.field_definitions` lezen, en wordt geweigerd op
  `public.profiles`. Least privilege, gemeten.
- Inloggen als behandelaar werkt op productie, dus de Supabase-auth loopt door de CSP heen.
- Een atleet registreren, consent geven, een intake openen en een vraag beantwoorden werkt. Het
  model haalde uit "I am 182 cm tall and I weigh 74 kg" twee velden (Height en Body mass) en stelde
  daarna zelf de volgende vraag; de voortgang liep van 2/15 naar 4/15 verplichte velden. Daarmee is
  ook de Anthropic-kant en het schrijven naar `field_proposals` en `dossier_fields` op productie
  aangetoond, niet alleen de infrastructuur eromheen.
- Hervatten werkt: het thuisscherm laat "Continue your intake" zien met de juiste voortgang.
- **Het verwijderpad is op productie doorlopen, niet alleen in de test.** Die atleet is via het
  coachscherm verwijderd, en daarna is per tabel geteld: `athletes`, `intakes`, `consents`,
  `chat_messages`, `profiles`, `auth.users`, `medical.field_proposals`, `medical.dossier_fields`,
  `medical.documents`, `medical.injury_events`, `medical.intake_reports` en de Storage-objecten staan
  allemaal op nul. Wat overbleef is precies wat het bevestigingsscherm belooft: een regel in
  `public.audit_log` met `action=purge`, `entity_table=athletes`, `actor_kind=coach`, plus de
  samenvattingsrij in `medical.purge_jobs`.

## Subverwerkers

Voor de GDPR-administratie van de klant. Vier partijen, en drie ervan zien medische data.

| Subverwerker | Rol | Wat er heen gaat | Waar |
|---|---|---|---|
| Supabase Inc. | Databank, authenticatie, objectopslag | Alles: alle dossiervelden, de blessurehistoriek, en de ruwe documenten in de bucket `intake-documents` | `eu-central-1`, Frankfurt |
| Vercel Inc. | Hosting en uitvoering | Alle requests lopen hierlangs, dus medische velden gaan door hun infrastructuur | Functions `fra1`; CDN wereldwijd |
| Anthropic PBC | Extractie uit documenten, klinische samenvatting | Documentinhoud en dossierinhoud, in de API-call zelf | VS |
| Notion Labs Inc. | Commerciele laag: atleten, facturatie, opvolgacties | Met opzet geen medische velden | VS |

Drie dingen die bij deze lijst horen en die makkelijk verkeerd opgeschreven worden:

**Bij Anthropic staan geen bestanden.** De Files API is niet gebruikt; elk document gaat als base64
mee in de call. Er is dus niets om op te ruimen bij Anthropic, en het verwijderpad gaat er ook niet
langs. Zie de correctie in [plan.md](plan.md). Gaat fase 2 de Files API wel gebruiken, dan verandert
deze lijst en moet het verwijderpad erheen.

**Naar Notion gaat niets medisch, en dat is afgedwongen.** De sync heeft een vaste lijst velden en
weigert als een veld uit die lijst in `field_definitions` als medisch gemarkeerd raakt. Dat is een
test (`evals/unit/notion-guard.test.ts`), niet een afspraak. Notion is op dit moment niet
geconfigureerd: de vier `NOTION_*`-variabelen staan leeg, en dan slaat de sync zichzelf over.

**Vercel staat op Hobby.** Zie de open punten hieronder: dat is een licentiekwestie, niet alleen een
kwestie van limieten.

## Twee processen die handwerk zijn

Deze twee staan hier omdat ze in een overdracht makkelijk als "geregeld" worden gelezen terwijl er
een mens aan te pas komt. Ze zijn niet stuk, ze zijn handmatig, en dat hoort de klant te weten.

### 1. Een verwijderverzoek van de atleet

Er is geen knop voor de atleet. Het verzoek komt per e-mail of telefoon binnen bij de praktijk, en een
behandelaar voert het uit via het atleetprofiel in het coachscherm. Dat verwijderpad zelf is wel echt
en getest (`npm run test:purge`): het loopt over de databank, Supabase Storage, de Notion-kaart en de
authserver, en laat niets achter.

Wat daarbij hoort en wat gauw over het hoofd gezien wordt: **`consents.withdrawn_at` wordt door niets
geschreven.** De kolom bestaat en wordt alleen gelezen, in het rapport. Er is dus geen enkele plek in
het systeem waar "de atleet heeft zijn toestemming ingetrokken" als gebeurtenis vastligt. Een
intrekking eindigt in de praktijk als een purge, en na een purge is er geen consentrij meer om een
intrekking op te schrijven. Dat is verdedigbaar (het dossier is weg, dus de grondslag doet niet meer
mee) maar het is niet hetzelfde als een intrekkingsregister, en wie dat laatste verwacht komt bedrogen
uit. Wil de klant intrekking los van verwijdering kunnen registreren, dan is dat een change request.

### 2. De Notion-kaart wordt niet vernietigd

Bij een purge wordt de Notion-pagina gearchiveerd en wordt de inhoud eruit gehaald, blok voor blok.
Dat is niet hetzelfde als vernietigen: de API van Notion kan een pagina niet hard verwijderen. De
kaart belandt dus leeg in de prullenbak van de werkruimte, en vanaf dat moment geldt de bewaartermijn
van Notion tot iemand die prullenbak leegmaakt.

Praktisch betekent dit dat het legen van de Notion-prullenbak een handmatige stap in de
verwijderprocedure van de praktijk is. Er staat na een purge geen medische inhoud meer in die kaart,
want die stond er nooit in.

## Wat open blijft

Op volgorde van wat eerst opgelost moet worden.

### Opgelost tijdens de oplevering: een atleet kon zich niet registreren

Dit stond hier als het enige echte defect. Het is opgelost en nagerekend; de beschrijving blijft
staan omdat de eerste helft een instelling is die bij een volgend project weer zo staat.

`supabase/config.toml` zet `enable_confirmations = false` voor de lokale stack. Een nieuw
Supabase-cloudproject staat standaard omgekeerd: e-mailbevestiging staat aan. Gemeten op productie:

```
POST /auth/v1/signup  ->  429  {"error_code":"over_email_send_rate_limit"}
```

Twee dingen gaan daardoor stuk, en ze stapelen:

1. Het project probeert een bevestigingsmail te sturen. De ingebouwde mailer van Supabase is
   gelimiteerd op een paar berichten per uur en is niet bedoeld voor productie, dus de registratie
   loopt al op het versturen vast.
2. Ook als die mail wel weg zou gaan, geeft `signUp()` met bevestiging aan **geen sessie** terug.
   `components/athlete/AthleteAuth.tsx` roept direct daarna `POST /api/athlete/register` aan, en die
   route heeft een ingelogde gebruiker nodig om het profiel en de atleetrij te maken. Zonder sessie
   faalt hij met "could not finish signing up".

De registratieflow is dus gebouwd op de aanname die `config.toml` maakt: bevestiging uit, meteen een
sessie. Het cloudproject moet daarop gezet worden.

**Wat er gedaan is**, via de Management API op het cloudproject:

| Instelling | Was | Nu |
|---|---|---|
| `mailer_autoconfirm` | `false` | `true` |
| `site_url` | `http://localhost:3000` | `https://athlete-intake.vercel.app` |
| `uri_allow_list` | leeg | `https://athlete-intake.vercel.app/**` |
| `password_min_length` | 6 | 8 |

Die `site_url` was ook precies waarom de bevestigingsmail naar localhost wees. Hij staat nu goed, ook
al wordt er voorlopig geen mail meer gestuurd: een instelling die naar een ontwikkelmachine wijst gaat
een keer iemand bijten.

`password_min_length` stond op 6 terwijl het registratieformulier zelf 8 eist en het coachscript 12.
De server was dus zwakker dan de UI beloofde. Nu 8, gelijk aan het formulier.

Dat autoconfirm aan staat is een bewuste keuze en geen omissie: atleetaccounts worden niet per e-mail
geverifieerd. Voor deze opzet is dat verdedigbaar, want de intakelink wordt door de praktijk gedeeld
en een coach kijkt elk dossier na voor het iets betekent.

**Wil de klant wel verifieren, gebruik dan Resend en niet de mailer van Supabase.** Die ingebouwde
mailer is gelimiteerd op een paar berichten per uur, en de standaardtemplate ziet er niet uit. Dat is
een change request met drie delen: Resend als SMTP-provider instellen, de e-mailtemplate vervangen, en
in de UI een "kijk in je mailbox"-toestand bouwen tussen registreren en het intakegesprek. `site_url`
en de allowlist staan dan al goed.

### En het tweede deel: /intake liep dood na registreren

Met autoconfirm aan bleef er een tweede gat, en dat zat wel in de code. De linktree wijst naar
`/intake`. Een atleet zonder account ging van daar naar `/start?next=/intake`, registreerde zich, en
kwam door dat `next` weer op `/intake` uit. Daar stond dan "Your session has expired", 0 van 0 velden,
en twee 401's.

`POST /api/athlete/register` maakt namelijk het profiel, de atleetrij en de toestemming, en zet geen
intakecookie. Dat doet `POST /api/intake`, en dat gebeurt op het thuisscherm. De eerste pagina die een
atleet ooit zag was dus een doodlopend scherm.

Opgelost in `app/intake/page.tsx`: zonder account naar `/start?next=/home`, en met account maar zonder
geldige intakesessie naar `/home`. Die tweede redirect dekt hetzelfde gat voor een bestaande atleet,
want het intakecookie is een capability token van dertig dagen en reist niet mee naar een ander
toestel.

`supabase config push` is hier met opzet niet gebruikt. Dat commando duwt de hele `config.toml` naar
het project, inclusief `site_url = "http://127.0.0.1:3000"` en de localhost-redirects, en dat is op
een klantproject een grotere ingreep dan het probleem.

**Leaked password protection kan niet aan op het Free-plan.** De API antwoordt letterlijk
"Configuring leaked password protection via HaveIBeenPwned.org is available on Pro Plans and up". Dat
is de enige overgebleven bevinding van `supabase db advisors`, en hij is opgelost op het moment dat de
org naar Pro gaat (punt 1 hieronder). Zet hem dan meteen aan: behandelaars en atleten loggen met een
wachtwoord in, en dit is het soort standaardmaatregel waarvan je niet wil hoeven verantwoorden dat hij
uit stond.

De rest van de linter is schoon. Er stond nog een `function_search_path_mutable` op
`private.reject_mutation()`, de trigger die `public.audit_log` append-only houdt; die is opgelost in
`20260909075206_harden_reject_mutation_search_path.sql`, en daarna is nagerekend dat de trigger nog
steeds weigert.

### Moet gebeuren voordat de klant het gebruikt

1. **Supabase staat op het Free-plan.** Een gratis project wordt gepauzeerd na zeven dagen zonder
   activiteit, en dan staat de productiesite stil. Er zijn ook geen dagelijkse back-ups en geen
   point-in-time recovery. Voor een zorgdossier is dat het verkeerde plan. Upgrade de org `Athlete
   Intake` naar Pro (ongeveer $25 per maand).

2. **Vercel staat op het Hobby-plan, en dat mag niet voor commercieel gebruik.** De voorwaarden van
   Vercel beperken Hobby tot niet-commercieel gebruik, en dit is een betaald klantproject. Los
   daarvan: op Hobby heeft een cron een precisie van plus of min 59 minuten, dus de retentiejob loopt
   ergens tussen 03:15 en 04:14. Voor een dagelijkse bewaartermijn is dat ruim genoeg, maar de
   licentiekwestie staat los daarvan. Upgrade naar Pro ($20 per maand).

3. **De service-role-sleutel is nog de oude JWT.** De nieuwe `sb_secret_`-sleutel is niet via de API
   of de CLI op te halen (die komt gemaskeerd terug), dus hij moet uit het dashboard komen. Let op de
   juiste plek: de sleutel die tijdens de oplevering aangeleverd werd begon met `sb_secret_lxK` en gaf
   een 401, terwijl de enige secret key van dit project met `sb_secret_yIK` begint. Die eerste hoorde
   bij een ander project. Haal hem uit het dashboard van **athlete-intake** zelf, zet hem als
   `SUPABASE_SERVICE_ROLE_KEY` in Vercel, controleer dat `/coach` nog werkt, en schakel daarna de oude
   JWT-sleutels uit. De publiekelijke sleutel in de browser is al de nieuwe stijl
   (`sb_publishable_`).

4. **Previews praten met de productiedatabank.** De omgevingsvariabelen staan op `production` en
   `preview`, dus een preview-deployment van een willekeurige branch schrijft in het echte dossier.
   Previews zitten wel achter Vercel Authentication, dus er kan geen buitenstaander bij. Zodra er
   klantdata in staat, hoort een preview naar een Supabase-branch te wijzen of geen databank te
   krijgen.

5. **Het uploadpad is nog niet op productie doorlopen.** Wel doorlopen en opgeruimd: registreren,
   consent, een intake openen, een chatantwoord dat door het model in twee velden werd omgezet
   (`182 cm` en `74 kg` naar Height en Body mass, voortgang van 2/15 naar 4/15), hervatten via het
   thuisscherm, de atleet terugvinden in het coachscherm, en verwijderen. Niet doorlopen: een document
   uploaden, de extractie eruit, de citaatverificatie, goedkeuren en het PDF-rapport. Dat vraagt een
   echt document en het schrijft medische data in de databank van de klant, dus doe die run met een
   synthetisch document en ruim hem daarna op via het verwijderpad.
   **`npm run seed:demo` mag nooit tegen productie draaien.**

6. **Er staat nog een testatleet in de databank.** `stormtuyls@icloud.com`, een intake met status
   `submitted`. Die is met opzet niet verwijderd, want het is niet mijn data. Ruim hem op via het
   coachscherm voor je aan de klant oplevert, zodat die met een leeg dossier begint.

### Bekende beperkingen, bewust zo

7. **De CSP staat `'unsafe-inline'` toe voor scripts.** Next zet zijn eigen opstartscript inline in de
   pagina, en een statische header in `vercel.json` kan geen nonce per request meegeven. De nette
   oplossing is een nonce in `proxy.ts`, maar dat dwingt elke pagina naar dynamisch renderen en
   `proxy.ts` dekt nu niet alle paden. Zolang dit zo staat, is de CSP wel een echte grens voor
   `connect-src`, `frame-ancestors`, `form-action` en `object-src`, maar geen bescherming tegen een
   geinjecteerd inline script. Als er ooit gebruikersinvoer ongeescaped in een pagina belandt, is dit
   het verschil. Opwaarderen naar een nonce is een afgebakende klus.

8. **De root-CA van Supabase zit in de bundel en verloopt op 26 april 2031.** Zie
   `lib/db/supabaseCa.ts`. Loopt die datum af zonder dat het certificaat vervangen is, dan valt de
   verbinding met het `medical`-schema weg. Dat is geen waarschuwing maar een storing.

9. **`DATABASE_URL` mag geen `sslmode` bevatten.** Staat die parameter er wel in, dan bouwt
   `pg-connection-string` zijn eigen TLS-configuratie en gooit de CA die de applicatie meegeeft weg.
   `sslmode=require` breekt de verbinding volledig; `sslmode=no-verify` doet iets ergers en verbindt
   zonder te verifieren. `lib/db/sql.ts` strippt de parameter er nu uit, dus het gaat niet stuk, maar
   zet hem er niet in met de gedachte dat het strenger is.

10. **Er is geen wachtwoordherstel voor behandelaars.** Een wachtwoord opnieuw zetten gaat via
   `npm run coach:create -- <e-mail> "<naam>"`, dat bestaande accounts bijwerkt. Voor een praktijk met
   een handvol behandelaars werkbaar, maar het hoort een mail te worden.

11. **Notion is niet geconfigureerd.** De vier `NOTION_*`-variabelen staan leeg en de sync slaat
    zichzelf over. Aanzetten gaat via `npm run notion:setup` met een `NOTION_PARENT_PAGE_ID` van een
    pagina die met de integratie gedeeld is; dat script maakt de drie databases aan en geeft de id's
    terug voor `NOTION_ATHLETES_DB`, `NOTION_INVOICES_DB` en `NOTION_TASKS_DB`.

12. **`PRACTICE_LOCALE` bestaat niet.** Die variabele stond in de opleverlijst maar wordt door geen
    enkele regel code gelezen. De taal komt uit `profiles.locale` en `intakes.locale`. Er is dus niets
    te configureren en niets stuk; de naam hoort uit de lijst.

13. **Er is geen favicon.** `/favicon.ico` geeft een 404 en dat is de enige melding in de
    browserconsole op productie. Cosmetisch.

## Sleutels en waar ze staan

Geen enkele sleutel staat in git. `.env.example` bevat alleen namen.

- **Vercel**: alle productievariabelen staan in het project. `CRON_SECRET` en `NEXT_PUBLIC_APP_URL`
  staan alleen op `production`, de rest op `production` en `preview`.
- **`INTAKE_SERVER_PASSWORD` is uit Vercel verwijderd.** Die variabele hoort alleen lokaal te bestaan,
  waar `scripts/db-local.ts` er het rolwachtwoord in de Docker-stack mee zet. In productie deed hij
  niets en zag hij eruit als een geheim.
- **Het wachtwoord van de rol `intake_server`** zit in `DATABASE_URL` en staat nergens anders. Kwijt
  betekent opnieuw zetten met `alter role intake_server password '<nieuw>'` en `DATABASE_URL`
  bijwerken.
- **Het databankwachtwoord van het Supabase-project** is bij het aanmaken gezet en wordt door de
  applicatie niet gebruikt; die verbindt als `intake_server`.
- Het wachtwoord van het coachaccount is eenmalig afgedrukt bij het aanmaken. Zet het opnieuw met
  `npm run coach:create` als het kwijt is.
