-- De intake-taxonomie.
--
-- Dit is het hart van de scope. Zeven informatieblokken uit het voorstel. Aan
-- het einde van M1 is deze lijst bevroren: een nieuw veld erbij is een change
-- request, geen commit, want elk veld raakt de extractieprompt, de chat, het
-- reviewscherm, het rapport en de evalset.
--
-- `question_nl` en `question_en` zijn wat de assistent vraagt als het veld
-- ontbreekt. Zonder die kolom valt de chat terug op het label, en dan klinkt hij
-- als een formulier dat voorleest.

insert into public.field_definitions
  (key, section, sort_order, label_nl, label_en, data_type, required, is_medical, enum_options, question_nl, question_en)
values
  -- 1. Toestemming, privacy en GDPR. De juridische registratie zelf staat in
  -- public.consents; deze velden maken het zichtbaar in dossier en rapport.
  ('consent.medical_processing', 'consent', 1, 'Toestemming verwerking medische gegevens', 'Consent to process medical data', 'boolean', true, false, null, null, null),
  ('consent.share_with_practitioners', 'consent', 2, 'Toestemming delen met behandelaars', 'Consent to share with practitioners', 'boolean', false, false, null, null, null),
  ('consent.retention_acknowledged', 'consent', 3, 'Bewaartermijn gelezen', 'Retention period acknowledged', 'boolean', true, false, null, null, null),

  -- 2. Identiteit en administratie.
  ('identity.full_name', 'identity', 1, 'Volledige naam', 'Full name', 'text', true, false, null, 'Wat is je volledige naam?', 'What is your full name?'),
  ('identity.date_of_birth', 'identity', 2, 'Geboortedatum', 'Date of birth', 'date', true, false, null, 'Wat is je geboortedatum?', 'What is your date of birth?'),
  ('identity.email', 'identity', 3, 'E-mailadres', 'Email address', 'text', true, false, null, 'Op welk e-mailadres mogen we je bereiken?', 'What email address can we reach you at?'),
  ('identity.phone', 'identity', 4, 'Telefoonnummer', 'Phone number', 'text', false, false, null, 'Wat is je telefoonnummer?', 'What is your phone number?'),
  ('identity.sport', 'identity', 5, 'Sport', 'Sport', 'enum', true, false,
    array[
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
    ],
    'In welke sport ben je actief?', 'Which sport do you compete in?'),
  ('identity.discipline', 'identity', 6, 'Discipline of positie', 'Discipline or position', 'text', false, false, null, 'Welke discipline, afstand of positie precies?', 'Which discipline, distance or position exactly?'),
  ('identity.club', 'identity', 7, 'Club', 'Club', 'text', false, false, null, 'Bij welke club train je?', 'Which club do you train with?'),
  ('identity.federation', 'identity', 8, 'Federatie', 'Federation', 'text', false, false, null, 'Onder welke federatie val je?', 'Which federation are you registered with?'),
  ('identity.coach_name', 'identity', 9, 'Huidige coach', 'Current coach', 'text', false, false, null, 'Wie is je huidige coach?', 'Who is your current coach?'),
  ('identity.medical_network', 'identity', 10, 'Medisch netwerk', 'Medical network', 'long_text', false, true, null, 'Met welke arts, kinesist of osteopaat werk je samen?', 'Which doctor, physiotherapist or osteopath do you work with?'),

  -- 3. Biometrie en basisgegevens.
  ('biometrics.height_cm', 'biometrics', 1, 'Lengte (cm)', 'Height (cm)', 'number', true, true, null, 'Hoe groot ben je, in centimeter?', 'How tall are you, in centimetres?'),
  ('biometrics.body_mass_kg', 'biometrics', 2, 'Lichaamsgewicht (kg)', 'Body mass (kg)', 'number', true, true, null, 'Wat is je huidige lichaamsgewicht in kilogram?', 'What is your current body mass in kilograms?'),
  ('biometrics.dominant_side', 'biometrics', 3, 'Dominante zijde', 'Dominant side', 'enum', false, true,
    array['left', 'right', 'ambidextrous'],
    'Welke zijde is dominant?', 'Which side is dominant?'),
  ('biometrics.resting_heart_rate', 'biometrics', 4, 'Rusthartslag', 'Resting heart rate', 'number', false, true, null, 'Ken je je rusthartslag?', 'Do you know your resting heart rate?'),
  ('biometrics.blood_pressure', 'biometrics', 5, 'Bloeddruk', 'Blood pressure', 'text', false, true, null, 'Is je bloeddruk recent gemeten? Zo ja, welke waarden?', 'Has your blood pressure been measured recently? If so, what were the values?'),

  -- 4. Trainings- en wedstrijdhistoriek.
  ('training.seasons_experience', 'training', 1, 'Aantal seizoenen ervaring', 'Seasons of experience', 'number', false, false, null, 'Hoeveel seizoenen doe je deze sport op dit niveau?', 'How many seasons have you competed at this level?'),
  ('training.weekly_volume_hours', 'training', 2, 'Trainingsvolume per week (uren)', 'Weekly training volume (hours)', 'number', true, false, null, 'Hoeveel uur train je gemiddeld per week, alles bij elkaar?', 'How many hours do you train in an average week, everything together?'),
  ('training.sport_specific_hours', 'training', 3, 'Sportspecifieke uren per week', 'Sport-specific hours per week', 'number', true, false, null, 'Hoeveel van die uren is sportspecifieke training, dus op de baan, het veld, in het water of op de fiets?', 'How many of those hours are sport-specific training, so on the track, the pitch, in the water or on the bike?'),
  ('training.strength_core_hours', 'training', 4, 'Uren kracht, core en stabiliteit per week', 'Hours of strength, core and stability per week', 'number', true, false, null, 'En hoeveel uur per week besteed je aan kracht, core en stabiliteit?', 'And how many hours a week do you spend on strength, core and stability?'),
  ('training.season_phase', 'training', 5, 'Seizoensfase', 'Season phase', 'enum', true, false,
    array['off_season', 'general_prep', 'specific_prep', 'competition', 'transition'],
    'In welke seizoensfase zit je nu?', 'Which phase of the season are you in?'),
  ('training.strength_training_years', 'training', 6, 'Jaren krachttraining', 'Years of strength training', 'number', false, false, null, 'Hoe lang doe je al gestructureerd krachttraining?', 'How long have you been doing structured strength training?'),
  ('training.personal_records', 'training', 7, 'Persoonlijke records', 'Personal records', 'long_text', false, false, null, 'Wat zijn je belangrijkste persoonlijke records, met datum?', 'What are your key personal records, with dates?'),
  ('training.current_programme', 'training', 8, 'Huidig trainingsschema', 'Current training programme', 'long_text', false, false, null, 'Hoe ziet je huidige trainingsweek eruit?', 'What does your current training week look like?'),

  -- 5. Medische historiek. Het zwaartepunt van de intake, en de reden dat dit
  -- systeem uberhaupt bestaat: dit staat nu verspreid over scans en berichten.
  ('medical.injury_history', 'medical_history', 1, 'Blessurehistoriek', 'Injury history', 'long_text', true, true, null, 'Welke blessures heb je gehad? Graag met lichaamsdeel, zijde en ongeveer wanneer.', 'Which injuries have you had? Please include body part, side and roughly when.'),
  ('medical.surgeries', 'medical_history', 2, 'Operaties', 'Surgeries', 'long_text', false, true, null, 'Ben je ooit geopereerd? Zo ja, waaraan en wanneer?', 'Have you ever had surgery? If so, what and when?'),
  ('medical.recurring_complaints', 'medical_history', 3, 'Terugkerende klachten', 'Recurring complaints', 'long_text', false, true, null, 'Zijn er klachten die blijven terugkomen?', 'Are there complaints that keep coming back?'),
  ('medical.current_complaints', 'medical_history', 4, 'Huidige klachten', 'Current complaints', 'long_text', true, true, null, 'Heb je op dit moment klachten? Zo ja, waar en sinds wanneer?', 'Do you have any complaints right now? If so, where and since when?'),
  ('medical.medication', 'medical_history', 5, 'Medicatie', 'Medication', 'long_text', false, true, null, 'Gebruik je medicatie of supplementen?', 'Are you taking any medication or supplements?'),
  ('medical.allergies', 'medical_history', 6, 'Allergieen', 'Allergies', 'text', false, true, null, 'Heb je allergieen waar we rekening mee moeten houden?', 'Do you have any allergies we should know about?'),
  ('medical.imaging_available', 'medical_history', 7, 'Beeldvorming beschikbaar', 'Imaging available', 'boolean', false, true, null, 'Heb je verslagen of beelden van scans (MRI, echo, RX)?', 'Do you have reports or images from scans (MRI, ultrasound, X-ray)?'),

  -- 6. Huidige status, doelstellingen en motivatie.
  ('status.pain_now', 'current_status', 1, 'Pijn op dit moment', 'Pain right now', 'boolean', true, true, null, 'Heb je op dit moment pijn?', 'Are you in pain right now?'),
  ('status.pain_location', 'current_status', 2, 'Locatie van de pijn', 'Pain location', 'text', false, true, null, 'Waar zit die pijn precies?', 'Where exactly is that pain?'),
  ('status.training_availability', 'current_status', 3, 'Trainbaarheid', 'Training availability', 'enum', true, true,
    array['full', 'modified', 'none'],
    'Kun je momenteel volledig trainen, aangepast, of niet?', 'Can you currently train fully, in modified form, or not at all?'),
  ('status.goals', 'current_status', 4, 'Doelstellingen', 'Goals', 'long_text', true, false, null, 'Wat wil je met deze begeleiding bereiken?', 'What do you want to achieve with this programme?'),
  ('status.target_event', 'current_status', 5, 'Doelwedstrijd', 'Target event', 'text', false, false, null, 'Is er een wedstrijd of datum waar je naartoe werkt?', 'Is there a competition or date you are working towards?'),
  ('status.motivation', 'current_status', 6, 'Motivatie en context', 'Motivation and context', 'long_text', false, false, null, 'Wat is er veranderd waardoor je nu begeleiding zoekt?', 'What changed that made you look for support now?'),

  -- 7. Uploads. Vinkjes die het reviewscherm laten zien wat er aangeleverd is,
  -- los van wat er uit die bestanden gehaald is.
  ('uploads.medical_documents_provided', 'uploads', 1, 'Medische documenten aangeleverd', 'Medical documents provided', 'boolean', false, false, null, 'Heb je medische verslagen of scans die je kunt uploaden?', 'Do you have medical reports or scans you can upload?'),
  ('uploads.test_data_provided', 'uploads', 2, 'Test- of VALD-data aangeleverd', 'Test or VALD data provided', 'boolean', false, false, null, 'Heb je eerdere krachttesten of VALD-rapporten?', 'Do you have previous strength tests or VALD reports?'),
  ('uploads.programme_provided', 'uploads', 3, 'Trainingsschema aangeleverd', 'Training programme provided', 'boolean', false, false, null, 'Kun je je huidige schema uploaden?', 'Can you upload your current programme?'),
  ('uploads.video_provided', 'uploads', 4, 'Videomateriaal aangeleverd', 'Video material provided', 'boolean', false, false, null, 'Heb je video van je techniek of van een wedstrijd?', 'Do you have video of your technique or a competition?')
on conflict (key) do nothing;

-- 8. Het klachtbeeld, volgens het ICF-model.
--
-- Eigen insert omdat deze velden als enige `tier` en `ask_when` zetten. Alle
-- veertien hangen aan status.pain_now: wie geen klacht heeft krijgt er geen
-- enkele van te zien. Dit is het eerste gebruik van het mechanisme dat
-- 20260915090000_field_scope.sql ervoor neerzette.
--
-- De indeling is functie, activiteit, participatie, persoonlijke factoren. Zie
-- supabase/migrations/20261015090000_intake_protocol_v2.sql voor de toelichting;
-- dit is dezelfde lijst, en die migratie legt uit waarom hij twee keer staat.

insert into public.field_definitions
  (key, section, sort_order, label_nl, label_en, data_type, required, is_medical,
   enum_options, question_nl, question_en, tier, ask_when)
values
  ('complaint.location', 'complaint', 1, 'Locatie van de klacht', 'Location of the complaint', 'text', true, true, null,
   'Waar zit de klacht precies? Noem het lichaamsdeel en de zijde, en zeg erbij of het uitstraalt naar ergens anders.',
   'Where exactly is the complaint? Name the body part and the side, and say whether it radiates anywhere else.',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.onset', 'complaint', 2, 'Ontstaan en beloop', 'Onset and course', 'text', true, true, null,
   'Sinds wanneer heb je er last van, en hoe is het begonnen? Plots bij iets specifieks, of geleidelijk?',
   'Since when have you had it, and how did it start? Suddenly during something specific, or gradually?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.severity_nprs', 'complaint', 3, 'Pijnintensiteit (0-10)', 'Pain intensity (0-10)', 'number', true, true, null,
   'Hoe erg was de pijn op het ergste moment van de afgelopen week, op een schaal van 0 tot 10?',
   'How bad was the pain at its worst in the past week, on a scale from 0 to 10?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.nature', 'complaint', 4, 'Aard van de pijn', 'Nature of the pain', 'text', false, true, null,
   'Hoe voelt het? Scherp, zeurend, brandend, stijf, tintelend?',
   'What does it feel like? Sharp, dull, burning, stiff, tingling?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.provocation', 'complaint', 5, 'Wat de klacht uitlokt', 'What provokes the complaint', 'long_text', true, true, null,
   'Wat maakt het erger? Welke bewegingen, houdingen of belastingen, en hoe snel komt het dan op?',
   'What makes it worse? Which movements, positions or loads, and how quickly does it come on?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.reduction', 'complaint', 6, 'Wat de klacht vermindert', 'What eases the complaint', 'long_text', true, true, null,
   'En wat maakt het beter? Rust, juist bewegen, warmte, een bepaalde houding, medicatie?',
   'And what makes it better? Rest, movement, heat, a particular position, medication?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.pattern_24h', 'complaint', 7, '24-uurspatroon', '24-hour pattern', 'long_text', true, true, null,
   'Hoe verloopt het over een dag? Hoe is het bij het opstaan, overdag en ''s avonds?',
   'How does it go over a day? What is it like when you get up, during the day and in the evening?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.night_pain', 'complaint', 8, 'Nachtpijn', 'Night pain', 'boolean', true, true, null,
   'Word je er ''s nachts wakker van?',
   'Does it wake you up at night?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  -- Het enige veld hier met een voorwaarde op twee niveaus: zinloos bij een nee.
  ('complaint.night_detail', 'complaint', 9, 'Nachtpijn, toelichting', 'Night pain, detail', 'text', false, true, null,
   'Hoe vaak word je wakker, en wat helpt om weer te kunnen slapen?',
   'How often do you wake up, and what helps you get back to sleep?',
   'standard', '{"all": [{"field": "status.pain_now", "equals": true}, {"field": "complaint.night_pain", "equals": true}]}'),

  ('complaint.irritability', 'complaint', 10, 'Prikkelbaarheid', 'Irritability', 'long_text', false, true, null,
   'Hoe snel komt de klacht op als je hem uitlokt, en hoe lang blijft hij daarna hangen?',
   'How quickly does the complaint come on when you provoke it, and how long does it stay afterwards?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.activity_limitations', 'complaint', 11, 'Beperkingen in activiteiten', 'Activity limitations', 'long_text', true, true, null,
   'Wat lukt er in het dagelijks leven niet meer of moeilijker? Denk aan zitten, bukken, traplopen, tillen, slapen, autorijden.',
   'What has become impossible or harder in daily life? Think of sitting, bending, stairs, lifting, sleeping, driving.',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.participation_limitations', 'complaint', 12, 'Beperkingen in sport, werk en studie', 'Participation limitations', 'long_text', true, true, null,
   'Wat heb je moeten aanpassen of laten vallen in je sport, je werk of je studie?',
   'What have you had to adjust or drop in your sport, your work or your studies?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.beliefs', 'complaint', 13, 'Eigen verklaring en zorgen', 'Own explanation and concerns', 'long_text', false, true, null,
   'Wat denk je zelf dat er aan de hand is, en waar maak je je zorgen over?',
   'What do you think is going on yourself, and what are you worried about?',
   'standard', '{"field": "status.pain_now", "equals": true}'),

  ('complaint.prior_treatment', 'complaint', 14, 'Eerdere behandeling van deze klacht', 'Prior treatment of this complaint', 'long_text', false, true, null,
   'Wat heb je er al aan laten doen, en wat leverde dat op?',
   'What has already been done about it, and what did that achieve?',
   'standard', '{"field": "status.pain_now", "equals": true}')
on conflict (key) do nothing;

-- status.pain_now opent de hele klachtsectie, dus de bot moet er altijd naar
-- vragen. `core` betekent precies dat: vragen ook zonder dat ask_when klopt.
update public.field_definitions
   set tier = 'core'
 where key = 'status.pain_now';

-- status.pain_location is vervangen door complaint.location, dat scherper
-- uitvraagt. Het veld blijft bestaan voor de dossiers die er een waarde in
-- hebben (de foreign keys zijn on delete restrict), maar de bot vraagt er niet
-- meer naar.
update public.field_definitions
   set tier = 'deep',
       ask_when = null
 where key = 'status.pain_location';

-- Welke velden een terugkerende atleet niet opnieuw hoeft te vertellen, alleen
-- ter bevestiging. Dezelfde lijst als in
-- supabase/migrations/20260908140000_carry_forward.sql, want een `db reset`
-- voert eerst de migraties uit en daarna deze seed: zonder deze regels staat de
-- vlag na een reset overal weer op false. Ze horen gelijk te blijven.
update public.field_definitions
   set carry_forward = true
 where key in (
   'identity.full_name',
   'identity.date_of_birth',
   'identity.email',
   'identity.phone',
   'identity.sport',
   'identity.discipline',
   'identity.club',
   'identity.federation',
   'identity.coach_name',
   'biometrics.height_cm',
   'biometrics.dominant_side'
 );

-- Welke velden uit het atleetprofiel komen in plaats van uit het gesprek.
-- Dezelfde lijst als in
-- supabase/migrations/20260915100000_identity_from_profile.sql, en om dezelfde
-- reden hier herhaald: de migraties draaien voor deze seed, dus de update daar
-- raakt bij een verse databank nul rijen. Zonder deze regels vraagt het gesprek
-- na een reset weer de hele identiteitssectie uit, en dat is stil: er is geen
-- foutmelding, er komen alleen negen beurten bij.
--
-- identity.medical_network staat er met opzet niet bij; zie de migratie.
update public.field_definitions
   set from_profile = true
 where key in (
   'identity.full_name',
   'identity.date_of_birth',
   'identity.email',
   'identity.phone',
   'identity.sport',
   'identity.discipline',
   'identity.club',
   'identity.federation',
   'identity.coach_name'
 );

-- En carry-forward weer uit voor precies die velden: ze komen uit het profiel,
-- dus er valt niets ter bevestiging voor te leggen. Deze regel staat NA het
-- blok hierboven, want dat zet hem voor dezelfde sleutels juist aan.
update public.field_definitions
   set carry_forward = false
 where from_profile;
