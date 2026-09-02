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
    array['sprint', 'hurdles', 'rowing', 'speed_skating', 'inline_skating', 'football', 'other'],
    'In welke sport ben je actief?', 'Which sport do you compete in?'),
  ('identity.discipline', 'identity', 6, 'Discipline of positie', 'Discipline or position', 'text', false, false, null, 'Welke discipline of positie precies?', 'Which discipline or position exactly?'),
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
  ('training.weekly_volume_hours', 'training', 2, 'Trainingsvolume per week (uren)', 'Weekly training volume (hours)', 'number', true, false, null, 'Hoeveel uur train je gemiddeld per week?', 'How many hours do you train in an average week?'),
  ('training.season_phase', 'training', 3, 'Seizoensfase', 'Season phase', 'enum', true, false,
    array['off_season', 'general_prep', 'specific_prep', 'competition', 'transition'],
    'In welke seizoensfase zit je nu?', 'Which phase of the season are you in?'),
  ('training.strength_training_years', 'training', 4, 'Jaren krachttraining', 'Years of strength training', 'number', false, false, null, 'Hoe lang doe je al gestructureerd krachttraining?', 'How long have you been doing structured strength training?'),
  ('training.personal_records', 'training', 5, 'Persoonlijke records', 'Personal records', 'long_text', false, false, null, 'Wat zijn je belangrijkste persoonlijke records, met datum?', 'What are your key personal records, with dates?'),
  ('training.current_programme', 'training', 6, 'Huidig trainingsschema', 'Current training programme', 'long_text', false, false, null, 'Hoe ziet je huidige trainingsweek eruit?', 'What does your current training week look like?'),

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
