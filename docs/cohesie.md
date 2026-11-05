# De twee apps, naast elkaar gelegd

`splitsing.md` telt wat er verhuisd is. Dit telt wat de splitsing achterliet: waar de twee apps
uit elkaar lopen terwijl ze één product zijn, en wat er aan te doen is.

Geteld op 5 november 2026, bij `athlete-intake` op `da336cc` en `unbound-screening` op `dad64aa`.
Elk getal hieronder komt uit de boom zoals hij nu is.

Eén ding vooraf, want het bepaalt alles: de twee apps delen één Supabase-project. Dat is geen
toeval en geen tijdelijke toestand. Drie foreign keys in `medical` wijzen met `on delete cascade`
naar `public.athletes`, en `medical.purge_athlete()` leunt daarop. De splitsing was een
repo-splitsing, geen datasplitsing.

---

## 1. Wat de coach merkt

### 1.1 Twee keer inloggen

Beide apps bouwen hun Supabase-client met `createServerClient` zonder `cookieOptions`. Het
sessiecookie krijgt dus geen `domain` en is host-only. `athlete-intake.vercel.app` en
`unbound-screening.vercel.app` zijn twee hosts, dus twee sessies.

Dit is niet weg te programmeren. Eén sessie vraagt twee subdomeinen onder één domein
(`intake.unbound.be`, `screening.unbound.be`) met het cookie op `.unbound.be`. Zolang beide apps
op `*.vercel.app` staan, logt de coach twee keer in.

### 1.2 De taal valt terug

`i18n/request.ts` is in beide repo's byte-identiek en leest alleen het cookie:

```ts
const locale = toLocale(requested ?? store.get(LOCALE_COOKIE)?.value);
```

Datzelfde cookie is host-only. Een coach die in de intake op EN zet, krijgt in screening weer NL.

Het wrange is dat de voorkeur wél gedeeld is: beide `/api/locale`-routes schrijven
`profiles.locale`, in dezelfde rij van dezelfde databank. Niemand leest hem terug. De data staat
er, de koppeling ontbreekt.

### 1.3 Geen weg van atleet naar atleet

De URL-vormen sluiten al op elkaar aan, met dezelfde id uit dezelfde tabel:

| | |
|---|---|
| intake | `/coach/athletes/<athleteId>` |
| screening | `/coach/athletes/<athleteId>/screening` |

Er is geen enkele link tussen die twee. Een behandelaar die het dossier van een atleet open heeft
en de screening wil zien, moet de andere app openen, opnieuw inloggen, zoeken en klikken.

### 1.4 Twee verschillende schillen

Screening kreeg in fase 1 een navigatiebalk in `app/coach/(app)/layout.tsx`. De intake heeft er
geen: `app/coach/` heeft helemaal geen layout, elke pagina tekent zijn eigen header, en
`app/coach/athletes/[athleteId]/page.tsx:123` opent nog met

```tsx
<Link href="/coach" className="text-xs text-ink-muted underline">
```

Dat is precies het patroon dat in screening bij fase 1 verdween. Dezelfde praktijk, twee frames.

De tokens zijn wel gedeeld: `app/globals.css` verschilt over vijf regels, en dat is de printregel
voor de nieuwe wikkel. Knoppen, kleuren en typografie zijn identiek. Het verschil zit in de
omlijsting, niet in de onderdelen.

---

## 2. Eén codebase, twee keer onderhouden

Van de 48 paden die in beide repo's bestaan zijn er 42 byte-identiek.

**2041 regels applicatiecode, in beide repo's hetzelfde bestand:**

| Groep | Bestanden |
|---|---|
| Databank | `lib/db/sql.ts`, `lib/db/supabaseCa.ts` |
| Supabase | `lib/supabase/{browser,server,service}.ts` |
| Autorisatie | `lib/review/access.ts` |
| Spoor | `lib/audit.ts` |
| Taal | `lib/i18n/{locale,server,translator}.ts`, `i18n/request.ts` |
| Merk | `lib/report/branding.ts` |
| Inloggen | `components/auth/` (4), `components/coach/CoachLogin.tsx`, `app/auth/`, `app/coach/login/page.tsx` |
| Schil | `app/layout.tsx`, `app/globals.css`, `proxy.ts` |
| Klein | `lib/cn.ts`, `lib/errors.ts`, `lib/http.ts`, `components/LocaleToggle.tsx` |

Nul afwijking, drie weken na de splitsing. Dat is geen geruststelling maar de nulmeting: het zegt
dat de divergentie nog moet beginnen. `lib/review/access.ts` is de regel om wakker van te liggen.
Een beveiligingsfix die in één repo landt en in de andere niet, is een gat dat niemand ziet.

**1324 regels migraties** staan in screening voor tabellen die het niet in zijn eentje kan
aanmaken. De repo heeft geen baseline (`public.athletes` ontbreekt), dus `supabase start` werkt er
niet. Het grootboek van productie is athlete-intake. Dat staat nergens geschreven.

**543 van de 661 vertaalsleutels** in screening zijn een letterlijke kopie uit de intake,
inclusief elke chat-, dossier- en consentsleutel die screening nooit rendert. Vandaag nul
verschillen in de waarden. Een herformulering aan één kant maakt er één.

**`proxy.ts` is byte-identiek**, dus screening bewaakt routes die het niet heeft:

```
"/", "/home/:path*", "/start/:path*", "/intake/:path*", "/coach/:path*",
"/review/:path*", "/api/intake/:path*", "/api/athlete/:path*", "/api/review/:path*"
```

Zeven van de negen bestaan daar niet.

---

## 3. Configuratie die met de hand gelijk moet blijven

**Vier variabelen staan dubbel**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. Eén per project, met de hand gezet.

Dat is vandaag al misgegaan. Screening kreeg de nieuwe `sb_secret_`-sleutel waar de intake de oude
`service_role`-JWT draait, en `/coach` gaf:

```
Error: audit-log schrijven mislukt: Invalid API key
count=3  routes=/coach.rsc
```

Vercel heeft shared environment variables op teamniveau. Het team gebruikt er nul.

**Node loopt uiteen.** `athlete-intake/.nvmrc` zegt 24, screening heeft geen `.nvmrc`, en Vercel
draait het daarom op 26.x. Dezelfde code, twee majors.

**Twee lockfiles** met vandaag dezelfde Next-, React- en Tailwindversies. De eerstvolgende upgrade
aan één kant maakt daar twee van. Alleen `@anthropic-ai/sdk` en `unpdf` horen echt bij de intake.

---

## 4. Eigenaarschap dat nergens staat

| Onderwerp | Hoe het werkt | Waar het staat |
|---|---|---|
| Migratiegrootboek | athlete-intake draait `db push` tegen productie | nergens |
| Wissen | Drie cascades plus `purge_athlete()`, alles in intake | nergens |
| Lokaal draaien | Screening heeft intake's stack en `coach:create` nodig | nergens |
| Rollen | `intake_server` krijgt in `20260902110000_grants.sql` select op `public.athletes` | in die migratie |

Screening heeft terecht geen regel purge-code. Maar in die repo staat ook niets dat zegt dat
verwijderen elders gebeurt, terwijl het wel elf migraties meedraagt die eruitzien alsof het die
tabellen bezit.

`public.audit_log` noteert actor, actie en entiteit, maar niet welke app de handeling deed. Meestal
af te leiden uit `entity_schema`, niet altijd: beide apps lezen `public.athletes`.

---

## 5. Verbeterpunten

Op volgorde van wat het oplevert gedeeld door wat het kost.

### Nu, klein

1. **Diepe links tussen de atleetschermen.** Van intake's atleetpagina naar
   `${SCREENING_URL}/coach/athletes/<id>/screening` en terug. De ids kloppen al, de URL-vormen ook.
   Twee regels per kant. Dit is het grootste gat in de werkstroom en het goedkoopste om te dichten.
2. **`.nvmrc` in screening**, met dezelfde 24 als de intake.
3. **De matcher in screening's `proxy.ts` terugbrengen** tot `/`, `/coach/:path*` en de routes die
   er zijn. Dood grind dat suggereert dat die paden bestaan.
4. **Shared environment variables op het team** voor de vier Supabase-waarden. Eén plek, beide
   projecten. Dit is de ingreep die de fout van vandaag onmogelijk maakt.

### Daarna, middel

5. **Taal volgt de coach, niet de host.** `i18n/request.ts` laten terugvallen op `profiles.locale`
   als het cookie ontbreekt en er een sessie is. De kolom wordt al geschreven door beide apps.
6. **Een navigatiebalk in de intake**, dezelfde als die van screening, met dezelfde knop naar de
   andere app. Daarmee verdwijnen ook de `text-xs underline` terugkoppelingen.
7. **Snoeien in screening's `messages/*.json`.** De sleutels die alleen over chat, dossier en
   consent gaan horen daar niet. Wat overblijft is kleiner en de pariteitstest bewaakt het.
8. **Opschrijven wie wat bezit.** Eén bladzijde in beide repo's: grootboek, wissen, lokaal
   draaien. Dit kost een uur en voorkomt de fout waarbij iemand vanuit de verkeerde repo pusht.

### Als er een domein is

9. **Eén domein, twee subdomeinen, `cookieOptions.domain` op de parent.** Lost punt 1.1 en 1.2 in
   één keer op, en haalt de Vercel-SSO weg die er nu voor zorgt dat Fre er sowieso niet bij kan.
   Dit blokkeert de oplevering aan de praktijk, dus het is eerder urgent dan groot.

### De grote, pas als de rest staat

10. **De 2041 gedeelde regels uit de kopieerslag halen.** Drie wegen, in oplopende omvang:
    een npm-pakket (`@unbound/core`) vanaf een private registry, een git submodule, of de twee
    repo's terug in één monorepo met twee apps en één `packages/core`. De monorepo is het eerlijkst
    tegenover wat dit feitelijk is: één product, twee deploys. Maar het is ook het meeste werk, en
    het is pas de moeite waard als de divergentie echt begint te bijten.

    Wat er in elk geval in hoort: `lib/supabase/`, `lib/db/sql.ts`, `lib/db/supabaseCa.ts`,
    `lib/review/access.ts`, `lib/audit.ts`, `lib/i18n/`, de auth-schermen en `globals.css`. Begin
    bij `access.ts`, want daar is divergentie een beveiligingsfout en niet een schoonheidsfout.

11. **De screeningmigraties uit één repo laten komen.** Zolang beide repo's dezelfde elf bestanden
    dragen tegen één databank, is het een kwestie van tijd voor er een twaalfde aan de verkeerde
    kant verschijnt.

---

## Wat hier niet in staat

Niets over de schermen zelf: bereikbaarheid, het rapport en de meetstroom staan in het plan en in
`screening-app.md`. Dit stuk gaat alleen over de naad tussen de twee apps.

Niet nagekeken: of de productiedatabank afwijkt van wat de migraties beschrijven, en of beide apps
onder last dezelfde poolerinstellingen aankunnen. Beide vragen een leesactie op productie.

---

## 6. Naschrift: de routes nagelopen

Toegevoegd op 5 november 2026, na het doorvoeren van punt 1 tot en met 3.

Elke interne `href`, `redirect()`, `router.push()` en `action` in beide repo's is tegen de echte
routeboom gelegd. Intake heeft 46 routes, screening 19.

**Twee doden gevonden, beide in screening, beide een erfenis van de kopieerslag.**

`components/coach/CoachLogin.tsx` is byte-identiek in beide repo's en wees naar `/start`. Dat is
de voordeur van de atleet, en die bestaat alleen in de intake. Op het inlogscherm van screening
stond dus een zichtbare link naar een 404, onder een comment dat uitlegt dat hij er juist staat
zodat niemand de URL hoeft te raden.

Opgelost zonder de twee bestanden uit elkaar te laten lopen: de href komt uit
`NEXT_PUBLIC_INTAKE_URL`, die in screening gezet is en in de intake niet, met `/start` als
terugval. Hetzelfde bestand, correct in beide apps.

De tweede, `/coach/screening` vanuit `ScreeningEntry.tsx`, was vals alarm: dat is
`` `/coach/screening/${sessionId}` `` en die route bestaat.

**Intake heeft geen enkele error-, loading- of not-found-grens.**

| | intake | screening |
|---|---|---|
| `error.tsx` | geen | `app/coach/(app)/` |
| `loading.tsx` | geen | `app/coach/(app)/` |
| `not-found.tsx` | geen | `app/coach/(app)/` |
| `global-error.tsx` | geen | geen |

46 routes, allemaal `force-dynamic`, en nul grenzen. Elke onverwachte fout in een server component
valt door naar het standaardscherm van Next: ongestileerd, Engels, "Application error: a
server-side exception has occurred". Hetzelfde voor `notFound()`, dat de intake op minstens vier
plekken aanroept, bijvoorbeeld in `app/coach/athletes/[athleteId]/page.tsx:87` bij een id dat geen
intake-id is. Een behandelaar die een verkeerde link opent, ziet de standaard-404 van Next.

Screening kreeg deze drie bestanden in fase 1. De intake is nooit bijgetrokken. Dit is het
grootste zichtbare gat aan de voorkant en het is drie kleine bestanden werk.

**Vertalingen die nergens meer aangeroepen worden.**

| Repo | Dood | Totaal | Waar |
|---|---|---|---|
| athlete-intake | 42 | 544 | `library` 23, `enums` 11, `intake` 6 |
| unbound-screening | 325 | 662 | `review` 54, `coach` 48, `api` 38, `report` 33, `chat` 27 |

De 23 `library`-sleutels in de intake zijn de bibliotheek die bij de splitsing vertrok. De 325 in
screening zijn de intakecatalogus die meekwam: de helft van dat bestand wordt daar nooit gelezen.
De elf `enums`-treffers in de intake zijn vermoedelijk vals alarm, die worden dynamisch opgebouwd.

**Wat wel in orde is.** Alle 46 intake-routes zijn bereikbaar vanaf een link of een redirect. De
`?next=`-afhandeling op beide inlogschermen controleert `next.startsWith("/")`, dus een open
redirect zit er niet in. De atleet-ids in de URL's van beide apps komen uit dezelfde tabel en de
vormen sluiten op elkaar aan, wat de diepe links van punt 1 mogelijk maakte zonder enige
vertaalslag.

**Nog een vondst, buiten de routes.** `proxy.ts` in screening bewaakte `/api/coach` niet. Die
routes verlengen de sessie dus niet, en een coach wiens token tijdens het invullen van een meting
verloopt kreeg een 401 op het bewaren in plaats van een vernieuwde sessie. Meegenomen in punt 3.
