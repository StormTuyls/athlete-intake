-- Intakeprotocol v2: de klacht uitgevraagd, sport in twee lagen, training
-- gesplitst.
--
-- Het eerste change request op de taxonomie die na M1 bevroren is. Aanleiding is
-- de eerste echte test door de praktijk: een intake over lage rugpijn vroeg niet
-- naar de exacte locatie, niet naar wat de klacht uitlokt of vermindert, niet
-- naar het etmaalpatroon en niet naar nachtpijn. Dat is geen fout in de code
-- maar een gat in de vragenlijst.
--
-- ---------------------------------------------------------------------------
-- Waarom dit nu pas kan, en waarom het weinig code kost
-- ---------------------------------------------------------------------------
--
-- 20260915090000_field_scope.sql heeft `tier` en `ask_when` toegevoegd en zegt
-- in zijn eigen kop waarvoor: "een vraagbank van 85", met "de acht vragen over
-- het beloop van een klacht" als voorbeeld. Die machinerie staat er sindsdien
-- ongebruikt: elk veld in de seed heeft ask_when op null. Dit is de eerste
-- migratie die hem gebruikt. Er komt dus geen nieuw mechanisme bij, alleen
-- inhoud.
--
-- ---------------------------------------------------------------------------
-- Deze migratie staat twee keer
-- ---------------------------------------------------------------------------
--
-- Alles hieronder staat ook in supabase/seed.sql, en dat is geen slordigheid.
-- `supabase db reset` draait eerst de migraties en daarna de seed. Op een VERSE
-- databank bestaan de 41 bestaande velden hier nog niet, dus elke `update`
-- hieronder raakt nul rijen; de seed is dan de bron. Op een BESTAANDE databank
-- draait de seed niet en doet deze migratie het werk. Allebei nodig, en de seed
-- legt diezelfde val al twee keer uit bij carry_forward en from_profile.

-- ── 1. Sport in twee lagen ────────────────────────────────────────────────────
--
-- De oude lijst was zeven waarden lang en mengde twee niveaus: sprint en hurdles
-- zijn disciplines BINNEN de atletiek, geen sporten, en zolang ze als sport in
-- het dossier staan is er geen veld meer over voor de discipline.
--
-- De labels en de disciplines staan in lib/intake/sports.ts, niet hier. Hier
-- staat alleen de sleutelverzameling, want dat is wat bevroren hoort te zijn.
-- evals/unit/sports.test.ts legt deze lijst naast die van het TS-bestand.
--
-- sprint en hurdles blijven erin staan. Ze worden niet meer aangeboden (de
-- datalijst markeert ze als deprecated), maar een sleutel weghalen waar dossiers
-- naar verwijzen laat lib/dossier/merge.ts stil terugvallen op de ruwe waarde
-- met typeValid op false, en dan zakt de betrouwbaarheid van high naar medium
-- zonder dat er iets veranderd is aan wat de atleet gezegd heeft.
update public.field_definitions
   set enum_options = array[
      'athletics', 'road_running', 'trail_running', 'triathlon',
      'cycling_road', 'cycling_track', 'mountain_biking', 'cyclocross',
      'bmx', 'swimming', 'water_polo', 'diving',
      'rowing', 'kayak_canoe', 'sailing', 'speed_skating',
      'short_track', 'inline_skating', 'ice_hockey', 'figure_skating',
      'alpine_skiing', 'cross_country_skiing', 'snowboarding', 'football',
      'field_hockey', 'handball', 'basketball', 'volleyball',
      'beach_volleyball', 'korfball', 'rugby', 'american_football',
      'baseball_softball', 'tennis', 'padel', 'badminton',
      'squash', 'table_tennis', 'golf', 'judo',
      'wrestling', 'taekwondo', 'karate', 'boxing',
      'kickboxing', 'mma', 'fencing', 'gymnastics_artistic',
      'gymnastics_rhythmic', 'trampoline', 'acrobatics', 'dance',
      'climbing', 'weightlifting', 'powerlifting', 'crossfit',
      'equestrian', 'archery', 'shooting', 'orienteering',
      'obstacle_racing', 'motorsport', 'esports', 'sprint',
      'hurdles', 'other'
   ]
 where key = 'identity.sport';

-- De disciplinevraag wordt concreter nu er per sport een lijst bestaat om naar
-- te verwijzen. De chatprompt krijgt die lijst als hint mee.
update public.field_definitions
   set question_nl = 'Welke discipline, afstand of positie precies?',
       question_en = 'Which discipline, distance or position exactly?'
 where key = 'identity.discipline';

-- ── 2. Trainingsuren uitgesplitst ─────────────────────────────────────────────
--
-- "Hoeveel uur train je per week" levert één getal op waar de praktijk er drie
-- nodig heeft: het totaal, het sportspecifieke deel, en kracht/core/stabiliteit.
-- Zonder die splitsing is een atleet die twaalf uur traint niet te onderscheiden
-- van een atleet die twaalf uur traint zonder ooit kracht te doen.
--
-- Eerst de bestaande volgorde uit de weg, want op (section, sort_order) ligt een
-- unieke index (field_definitions_order_key) en die wordt per rij gecontroleerd,
-- niet aan het einde van het statement. Een directe hernummering botst dus met
-- zichzelf.
update public.field_definitions
   set sort_order = sort_order + 100
 where section = 'training';

update public.field_definitions set sort_order = 1 where key = 'training.seasons_experience';
update public.field_definitions set sort_order = 2 where key = 'training.weekly_volume_hours';
update public.field_definitions set sort_order = 5 where key = 'training.season_phase';
update public.field_definitions set sort_order = 6 where key = 'training.strength_training_years';
update public.field_definitions set sort_order = 7 where key = 'training.personal_records';
update public.field_definitions set sort_order = 8 where key = 'training.current_programme';

-- Expliciet "in totaal", anders telt een atleet die net gesplitst heeft dubbel.
update public.field_definitions
   set question_nl = 'Hoeveel uur train je gemiddeld per week, alles bij elkaar?',
       question_en = 'How many hours do you train in an average week, everything together?'
 where key = 'training.weekly_volume_hours';

insert into public.field_definitions
  (key, section, sort_order, label_nl, label_en, data_type, required, is_medical,
   enum_options, question_nl, question_en)
values
  ('training.sport_specific_hours', 'training', 3,
   'Sportspecifieke uren per week', 'Sport-specific hours per week',
   'number', true, false, null,
   'Hoeveel van die uren is sportspecifieke training, dus op de baan, het veld, in het water of op de fiets?',
   'How many of those hours are sport-specific training, so on the track, the pitch, in the water or on the bike?'),

  ('training.strength_core_hours', 'training', 4,
   'Uren kracht, core en stabiliteit per week', 'Hours of strength, core and stability per week',
   'number', true, false, null,
   'En hoeveel uur per week besteed je aan kracht, core en stabiliteit?',
   'And how many hours a week do you spend on strength, core and stability?')
on conflict (key) do nothing;

-- ── 3. De klachtmodule ────────────────────────────────────────────────────────
--
-- Veertien velden in een eigen sectie, allemaal voorwaardelijk op
-- status.pain_now. Wie geen klacht heeft krijgt er geen enkele van te zien; dat
-- is precies het geval waarvoor ask_when gebouwd is.
--
-- De indeling volgt het ICF-model, met de klassieke subjectieve anamnese erin:
--
--   functie        waar zit het, hoe erg, wat lokt het uit, wat vermindert het,
--                  hoe loopt het over een etmaal, is er nachtpijn
--   activiteit     wat lukt niet meer in het dagelijks leven
--   participatie   wat is weggevallen in sport, werk of studie
--   persoonlijk    wat denkt de atleet er zelf van
--
-- Waarom een eigen sectie en niet bij current_status: dat zijn negentien velden
-- onder één kop in het rapport, waarvan er veertien over één klacht gaan en vijf
-- over doelen. Een kinesist die het rapport leest wil het klachtbeeld bij elkaar
-- zien staan.
--
-- status.pain_now wordt `core`. Dat betekent: de bot vraagt het altijd, ook
-- voordat de voorwaarden erop kloppen. Zonder dat zou de hele sectie nooit
-- opengaan, want zijn eigen opening hangt ervan af.
update public.field_definitions
   set tier = 'core'
 where key = 'status.pain_now';

-- status.pain_location gaat niet weg maar wordt stil. complaint.location dekt
-- hem volledig en vraagt scherper uit. Verwijderen kan niet: dossier_fields en
-- field_proposals verwijzen ernaar met on delete restrict, en bestaande dossiers
-- hebben er waarden in staan die zichtbaar horen te blijven.
update public.field_definitions
   set tier = 'deep',
       ask_when = null
 where key = 'status.pain_location';

insert into public.field_definitions
  (key, section, sort_order, label_nl, label_en, data_type, required, is_medical,
   enum_options, question_nl, question_en, tier, ask_when)
values
  -- Lichaamsfunctie en -structuur.
  ('complaint.location', 'complaint', 1,
   'Locatie van de klacht', 'Location of the complaint',
   'text', true, true, null,
   'Waar zit de klacht precies? Noem het lichaamsdeel en de zijde, en zeg erbij of het uitstraalt naar ergens anders.',
   'Where exactly is the complaint? Name the body part and the side, and say whether it radiates anywhere else.',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.onset', 'complaint', 2,
   'Ontstaan en beloop', 'Onset and course',
   'text', true, true, null,
   'Sinds wanneer heb je er last van, en hoe is het begonnen? Plots bij iets specifieks, of geleidelijk?',
   'Since when have you had it, and how did it start? Suddenly during something specific, or gradually?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.severity_nprs', 'complaint', 3,
   'Pijnintensiteit (0-10)', 'Pain intensity (0-10)',
   'number', true, true, null,
   'Hoe erg was de pijn op het ergste moment van de afgelopen week, op een schaal van 0 tot 10?',
   'How bad was the pain at its worst in the past week, on a scale from 0 to 10?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.nature', 'complaint', 4,
   'Aard van de pijn', 'Nature of the pain',
   'text', false, true, null,
   'Hoe voelt het? Scherp, zeurend, brandend, stijf, tintelend?',
   'What does it feel like? Sharp, dull, burning, stiff, tingling?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.provocation', 'complaint', 5,
   'Wat de klacht uitlokt', 'What provokes the complaint',
   'long_text', true, true, null,
   'Wat maakt het erger? Welke bewegingen, houdingen of belastingen, en hoe snel komt het dan op?',
   'What makes it worse? Which movements, positions or loads, and how quickly does it come on?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.reduction', 'complaint', 6,
   'Wat de klacht vermindert', 'What eases the complaint',
   'long_text', true, true, null,
   'En wat maakt het beter? Rust, juist bewegen, warmte, een bepaalde houding, medicatie?',
   'And what makes it better? Rest, movement, heat, a particular position, medication?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.pattern_24h', 'complaint', 7,
   '24-uurspatroon', '24-hour pattern',
   'long_text', true, true, null,
   'Hoe verloopt het over een dag? Hoe is het bij het opstaan, overdag en ''s avonds?',
   'How does it go over a day? What is it like when you get up, during the day and in the evening?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.night_pain', 'complaint', 8,
   'Nachtpijn', 'Night pain',
   'boolean', true, true, null,
   'Word je er ''s nachts wakker van?',
   'Does it wake you up at night?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  -- Hangt aan nachtpijn en niet aan de klacht: deze vraag is zinloos bij een nee,
  -- en hij is het enige veld in deze sectie met een voorwaarde op twee niveaus.
  ('complaint.night_detail', 'complaint', 9,
   'Nachtpijn, toelichting', 'Night pain, detail',
   'text', false, true, null,
   'Hoe vaak word je wakker, en wat helpt om weer te kunnen slapen?',
   'How often do you wake up, and what helps you get back to sleep?',
   'standard', '{"all": [{"field": "status.pain_now", "equals": true}, {"field": "complaint.night_pain", "equals": true}]}'),

  ('complaint.irritability', 'complaint', 10,
   'Prikkelbaarheid', 'Irritability',
   'long_text', false, true, null,
   'Hoe snel komt de klacht op als je hem uitlokt, en hoe lang blijft hij daarna hangen?',
   'How quickly does the complaint come on when you provoke it, and how long does it stay afterwards?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  -- Activiteiten.
  ('complaint.activity_limitations', 'complaint', 11,
   'Beperkingen in activiteiten', 'Activity limitations',
   'long_text', true, true, null,
   'Wat lukt er in het dagelijks leven niet meer of moeilijker? Denk aan zitten, bukken, traplopen, tillen, slapen, autorijden.',
   'What has become impossible or harder in daily life? Think of sitting, bending, stairs, lifting, sleeping, driving.',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  -- Participatie.
  ('complaint.participation_limitations', 'complaint', 12,
   'Beperkingen in sport, werk en studie', 'Participation limitations',
   'long_text', true, true, null,
   'Wat heb je moeten aanpassen of laten vallen in je sport, je werk of je studie?',
   'What have you had to adjust or drop in your sport, your work or your studies?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  -- Persoonlijke factoren. Niet vrijblijvend: wat iemand zelf denkt en vreest
  -- stuurt zijn herstel, en het is iets wat een behandelaar wil weten voor hij
  -- iets uitlegt.
  ('complaint.beliefs', 'complaint', 13,
   'Eigen verklaring en zorgen', 'Own explanation and concerns',
   'long_text', false, true, null,
   'Wat denk je zelf dat er aan de hand is, en waar maak je je zorgen over?',
   'What do you think is going on yourself, and what are you worried about?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.prior_treatment', 'complaint', 14,
   'Eerdere behandeling van deze klacht', 'Prior treatment of this complaint',
   'long_text', false, true, null,
   'Wat heb je er al aan laten doen, en wat leverde dat op?',
   'What has already been done about it, and what did that achieve?',
   'standard', '{"field": "status.pain_now", "equals": true}')
on conflict (key) do nothing;
