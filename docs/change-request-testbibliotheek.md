# Change request: twee batterijen in één testbibliotheek

De taxonomie in de bibliotheek is bevroren. Dit is het voorstel om er een tweede testbatterij naast
te zetten: acht nieuwe tests, negentien metrieken en zes referentieregels, plus één bestaande test
die herzien moet worden en drie dingen die de rekenmotor eerst moet leren.

Aanleiding: de performancerapporten die de praktijk vandaag met de hand maakt, meten iets anders dan
de geseede bibliotheek. Van de 26 geseede tests komt er precies één voor in die rapporten, de ASLR.
Omgekeerd staat geen enkele kernmaat uit die rapporten in de bibliotheek. Geteld over drie
rapporten: RSI 129 vermeldingen, CMJ 73, drop jump 63, contacttijd 52, Nordic 45, ISO60 39, Razor 22,
iso-push 20. In de code: nul.

Maar het is geen vervanging. De rapporten gebruiken beide batterijen: de sprong- en krachtdiagnostiek
vormt de romp, en de klinische screening levert de prioriteiten en het hertestwerk. In het rapport
van één atleet is de ASLR prioriteit 1 terwijl alle kerncijfers krachtmaten zijn. Dit document gaat
daarom over de bibliotheek als geheel.

Laatst bijgewerkt: 30 oktober 2026.

---

## 1. Wat er al staat en wat erbij komt

| | Klinische screening | Performancebatterij |
|---|---|---|
| Tests | 26, geseed | 8 nieuw, 1 te herzien |
| Regels | 21 | 6 |
| Classificatie uit | 9 | 1 |
| Afgenomen | met de hand | uit de toestelexport |
| Herkomst van de banden | één bronbestand | gepubliceerde studies, met citatie |
| Vergelijking | tegen de band | tegen de eigen baseline, soms tegen een norm |

De klinische kant bestaat en werkt. Dit voorstel raakt hem op twee punten: er komt een manier bij om
de twee batterijen uit elkaar te houden, en de drie motorgaten uit §5 raken ook klinische metrieken
zodra iemand er asymmetrie op wil kleuren.

## 2. De twee batterijen naast elkaar

Ze delen de atleet, de sessie, de bandenconventie en de rekenmotor. Ze verschillen in hoe ze binnen
komen en waar hun gezag vandaan komt. Drie dingen volgen daaruit.

### 2a. Een kolom die zegt welke batterij het is

`test_definitions.block` onderscheidt vandaag `anthropometry`, `mobility_ll`, `mobility_ul`, `core`,
`movement_ll`, `forcedecks` en `strength_ul`. Dat zijn onderwerpen, geen batterijen: `forcedecks`
hoort bij de toestellen en `core` bij de hand, maar dat staat nergens.

De schermen hebben dat onderscheid wel nodig. Het invoerscherm groepeert de blokken in "uit de
export" en "met de hand", want bij de eerste groep hoort een importknop en bij de tweede niet. De
bibliotheek filtert erop.

**Voorstel:** een kolom `domain` op `test_definitions`, als enum met `clinical` en `performance`.
Een enum en geen tekst, om dezelfde reden als `metric_unit`: twee schrijfwijzen van hetzelfde zijn
erger dan geen kolom. Eén migratie, en de bestaande 26 rijen krijgen `clinical`.

### 2b. Twee soorten gezag in één tabel

`reference_rules.evidence` kent al `source_sheet`, `published` en `internal`. De klinische banden
komen uit één bronbestand en staan op `source_sheet`; de performancenormen komen uit studies en
staan op `published`, waar de databank een citatie afdwingt. Dat hoeft niet aangepast te worden, maar
het hoort opgeschreven: in het rapport staan daardoor twee soorten verantwoording naast elkaar, en
dat is geen inconsistentie maar het verschil tussen een praktijkafspraak en een publicatie.

### 2c. Eén sessie, beide batterijen

`medical.screening_sessions` draagt beide. Dat is nu al zo en het moet zo blijven: `body_mass_kg`
staat op de sessie en wordt door de performancekant gebruikt voor N/kg en ×BW, terwijl de klinische
kant er niets mee doet. Een sessie opsplitsen per batterij zou de blessuretijdlijn en de
vergelijking over de tijd doormidden knippen.

---

## 3. Tests

### 3a. Acht nieuwe

| Sleutel | Blok | Lateraliteit | Toestel | Protocol bevestigd |
|---|---|---|---|---|
| `jump.drop_jump_bilateral` | `jump` | bilateral | ForceDecks | ja |
| `jump.drop_jump_unilateral` | `jump` | per_side | ForceDecks | **nee** |
| `jump.cmj` | `jump` | bilateral | ForceDecks | ja |
| `hamstring.nordic` | `hamstring` | per_side | NordBord | ja |
| `hamstring.iso60` | `hamstring` | per_side | NordBord | ja |
| `hamstring.razor` | `hamstring` | per_side | NordBord | ja |
| `hip.adduction_45` | `hip` | per_side | ForceFrame | ja |
| `hip.abduction_45` | `hip` | per_side | ForceFrame | ja |

De eenbenige drop jump staat op onbevestigd omdat het hertestprotocol een gelijke effectieve
valhoogte links en rechts als voorwaarde noemt, niet als vaststelling.

### 3b. Eén bestaande test die herzien moet worden

`forcedecks.ankle_iso_push` bestaat al. Drie dingen kloppen er niet meer:

1. **De metriek staat in ×BW.** `forcedecks.ankle_iso_push.value` heeft eenheid `xbw`. De rapporten
   tonen de piek in newton én in ×BW. Zolang de ruwe newton nergens staat, kan de ×BW-waarde niet
   gecontroleerd of herberekend worden, en `units.ts` zegt het expliciet: de enige weg naar `xbw`
   loopt over de ruwe newton. De ruwe meting hoort de metriek te zijn, de ×BW het afgeleide.
2. **De banden botsen.** Het bronbestand geeft 3,1 tot 3,3 als streefbereik met hoog boven 4, met een
   gat tussen 3,3 en 4. De rapporten gebruiken Natera: normaal vanaf 2,85, uitstekend vanaf 3,3. Dat
   zijn twee verschillende drempels voor dezelfde test. Eén ervan moet winnen, of ze krijgen allebei
   een versie met een populatiefilter eromheen.
3. **Er horen twee metrieken bij.** De rapporten lezen uit dezelfde poging ook de kracht op 100 ms en
   de RFD over 0 tot 100 ms. Dat zijn metrieken van deze test, geen aparte tests.

De heup- en knie-iso-push laten we staan zoals ze zijn; de rapporten gebruiken ze niet.

### 3c. Een naamval om op te letten

`mobility_ll.hip_abduction` heet "Lange-adductorlengte (heupabductie)" en meet **graden**. De nieuwe
`hip.abduction_45` meet **newton** op de ForceFrame. Zelfde woord, andere grootheid, ander blok. Wie
die twee samenvoegt omdat de naam gelijk lijkt, zet een hoek en een kracht in dezelfde reeks.

## 4. Metrieken

Negentien: vijftien ruw en vier afgeleid. Alle eenheden bestaan al in `public.metric_unit`.

### Ruw

| Test | Metrieken | Eenheid |
|---|---|---|
| drop jump tweebenig | `rsi`, `contact_time`, `height` | `ratio`, `ms`, `cm` |
| drop jump eenbenig | `rsi`, `contact_time` | `ratio`, `ms` |
| CMJ | `height`, `mrsi` | `cm`, `m_per_s` |
| nordic, iso60, razor | `peak_force` | `n` |
| hip adductie, abductie 45° | `peak_force` | `n` |
| ankle iso-push | `peak_force`, `force_at_100ms`, `rfd_0_100` | `n`, `n`, `n_per_s` |

### Afgeleid

| Sleutel | `derived_key` | Eenheid |
|---|---|---|
| `hamstring.nordic.per_kg` | `per_body_mass` | `n_per_kg` |
| `forcedecks.ankle_iso_push.per_bw` | `per_body_weight` | `xbw` |
| `hip.add_abd` | `ratio` | `ratio` |
| `jump.transfer_rsi` | `ratio` | `ratio` |

### De val die hieronder zit

RSI bestaat in twee schalen die niet onderling vergelijkbaar zijn. De rapporten rekenen vliegtijd
gedeeld door contacttijd, zonder eenheid. Het toestel toont hoogte gedeeld door contacttijd, in m/s.
Dezelfde sprong levert 4,16 in de ene schaal en 3,19 in de andere.

Dat zijn **twee metrieken en niet twee namen voor dezelfde**. `units.ts` dwingt dat al af voor
`n_per_kg` en `xbw`, met dezelfde redenering. Wie hier één metriek van maakt, bouwt precies de fout
na waar dat bestand tegen beschermt.

## 5. Referentieregels

Zes. Vier gepubliceerd, één intern doel, één die de motor nog niet kan uitvoeren.

| Metriek | Laag | Banden | Classificeert | Citatie |
|---|---|---|---|---|
| `jump.cmj.height` | published | &lt; 44 / 44 tot 54 / ≥ 54 cm | ja | Beattie 2020 |
| `jump.cmj.mrsi` | published | &lt; 0,72 / 0,72 tot 0,83 / ≥ 0,83 m/s | ja | Beattie 2020 |
| `hamstring.nordic.per_kg` | published | &lt; 5,2 / ≥ 5,2 N/kg | ja | Giakoumis 2020 |
| `forcedecks.ankle_iso_push.per_bw` | published | &lt; 2,85 / 2,85 tot 3,3 / ≥ 3,3 ×BW | ja | Natera |
| `hip.add_abd` | published | &lt; 0,80 / ≥ 0,80 | **nee** | Tyler 2001 |
| asymmetrie | internal_target | &lt; 5 / 5 tot 10 / ≥ 10 % | **kan niet** | interne afspraak |

De ankle-regel is een **versie 2** op een bestaande metriek, geen nieuwe regel. Zie §3b.

Grenzen zijn halfopen, zoals overal in deze bibliotheek. Exact 10,0 % asymmetrie is dus rood en niet
amber, en exact 2,85 ×BW is normaal en niet onder de norm.

Drie dingen die niet uit de tabel blijken:

**De bronnen geven gemiddelden, geen banden.** Beattie rapporteert wereldklasse 57 ± 3 cm en
nationaal 44 ± 1 cm: twee populatiegemiddelden met spreiding. Daar drie banden van maken is een
beslissing van de praktijk, niet van de bron. `source_note` moet dat zeggen.

**Add : Abd classificeert niet.** De drempel komt uit onderzoek met een handdynamometer bij
profijshockeyers; wij meten met de ForceFrame in 45°. Dezelfde ratio, een ander getal. De regel mag
bestaan en zichtbaar zijn; indelen mag pas met een eigen drempel op het eigen toestel.

**Drop jump RSI krijgt geen regel.** De leeswijzer van de rapporten zegt het zelf: DJ-RSI
onderscheidt sprintniveau nauwelijks. Een regel die niets onderscheidt geeft een kleur aan een
verschil dat er niet is.

### Wat er niet bij komt

De `self`-laag blijft buiten `reference_rules`; de constraint `reference_rules_no_self_layer` bewaakt
dat al. Een baseline is een berekening over eerdere sessies, geen afkapwaarde die iemand vaststelde.

De cohortlaag blijft weg. Spec §10 noemt percentielen over een klein cohort actief schadelijk, en
elf van de tests hebben alleen een eigen baseline: dan is de verleiding om alsnog te percentileren
het grootst en de onderbouwing het zwakst.

---

## 6. Wat de motor nog niet kan

Drie gaten. Geen van de drie is een ontbrekende formule: `lib/screening/derive.ts` heeft ze alle drie
al, met tests. Het ontbreekt aan de aansluiting in `lib/screening/evaluate.ts`.

### 6.1 Een afgeleide uitkomst kan geen band dragen

`evaluate.ts` zet bij elke asymmetrierij `referenceRuleId: null` en `bandStatus: null`, hardgecodeerd,
en zoekt er nooit een regel bij op. De databank sluit de deur daarna nog eens met
`derived_band_needs_rule`.

Dat was een juiste keuze toen hij gemaakt werd: een eerdere versie zette de *richting* van de
asymmetrie in `band_status`, en die constraint ving dat terecht af.

Maar de praktijk kleurt asymmetrie al jaren wel: groen onder 5 %, amber tot 10 %, rood daarboven, en
9 % geldt bij de Nordic als actiesignaal. Dat is een interne regel die bestaat, gebruikt wordt, en
niet uitgevoerd kan worden. Het raakt beide batterijen: zodra iemand asymmetrie op een klinische
hoek wil kleuren, loopt hij tegen hetzelfde slot.

**Wat het vraagt:** `MetricSpec` krijgt een regel per *soort uitkomst* in plaats van per metriek, en
`evaluate.ts` zoekt die op voor een afgeleide rij zoals hij dat nu voor een absolute rij doet. De
constraint blijft zoals hij is: er komt een regel-id bij de band.

### 6.2 Normaliseren naar lichaamsmassa gebeurt niet

`evaluate()` heeft geen sessiecontext in zijn signatuur:

```
evaluate(measurements, specs, history, occurredAt, recordedAt)
```

`perBodyMass()` en `perBodyWeight()` vragen een `SessionContext` met `bodyMassKg`. Die massa staat er
al: `medical.screening_sessions.body_mass_kg`, bewust gekopieerd en niet gejoind, omdat spec §8 de
massa van die dag wil. De waarde is er, de functie is er, de aanroep niet.

Dit raakt twee van de vier gepubliceerde regels rechtstreeks, en het verklaart waarom de bestaande
ankle iso-push vandaag op `classification_enabled = false` staat.

**Wat het vraagt:** `evaluate()` krijgt de sessiecontext mee, en metrieken met `derived_key`
`per_body_mass` of `per_body_weight` leveren een eigen rij op. Let op de waarschuwing in `units.ts`:
`n_per_kg` en `xbw` converteren niet naar elkaar.

### 6.3 Ratio's worden niet berekend

Hetzelfde patroon. `ratio()` bestaat en is getest, `evaluate.ts` roept hem niet aan. Het commentaar
zegt waarom: de geseede set had er geen afnemer voor. Met dit voorstel krijgt hij er twee, Add : Abd
en de transfer-RSI.

**Wat het vraagt:** een rijsoort naast `absolute`, `asymmetry` en `delta` die twee metrieken als
invoer neemt. Spec §11 eist dat teller en noemer naast de ratio getoond worden, en
`derived_results.inputs` is daar al voor gemaakt.

---

## 7. Volgorde

1. **De `domain`-kolom.** Eén migratie, en beide schermen kunnen de twee batterijen uit elkaar
   houden. Alles daarna leunt erop.
2. **6.2, normalisatie.** Het kleinste van de drie gaten: een parameter erbij en twee aanroepen.
   Zonder deze stap zijn twee van de vier gepubliceerde regels dood gewicht.
3. **De ankle iso-push herzien.** Ruwe newton als metriek, ×BW als afgeleide, en een beslissing over
   welke banden gelden. Dit raakt een bestaande rij, dus het hoort vóór de nieuwe tests.
4. **De acht nieuwe tests seeden**, met `validateLibrary()` als vangnet. Die draait in CI zonder
   databank.
5. **De vier gepubliceerde regels**, elk met citatie, anders weigert
   `reference_rules_published_has_citation` ze alsnog.
6. **6.3, ratio's**, want Add : Abd heeft de heupmetrieken uit stap 4 nodig.
7. **6.1, asymmetrie**, het grootste gat en het enige dat raakt aan hoe de motor over regels denkt.
8. **VALD-import als laatste.** Vandaag worden deze waarden met de hand uit de export overgetypt. Dat
   is fase 2 uit spec §16 en staat los van dit voorstel.

## 8. Wat dit niet beslist

- **Welke banden gelden voor de ankle iso-push.** Het bronbestand en Natera geven verschillende
  drempels. Dat is een klinische keuze, geen technische.
- **Of de risicodrempels van de Nordic in dezelfde schaal mogen als het prestatiegemiddelde.** 256
  tot 377 N komt uit blessureonderzoek, 418 N is een prestatiegemiddelde. De rapporten lezen ze
  samen. Of de bibliotheek dat ook mag, is een inhoudelijke vraag.
- **Wie de onbevestigde protocollen vastlegt.** Klinisch werk, geen technisch werk. Het gaat om de
  eenbenige drop jump hier, en om vijftien protocollen aan de klinische kant.
- **Of de twee batterijen ooit uit elkaar moeten.** Met de `domain`-kolom passen ze in één
  bibliotheek. Zou de screening een eigen app worden, dan is die kolom ook de scheidslijn.
