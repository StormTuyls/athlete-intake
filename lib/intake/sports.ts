import type { Locale } from "@/lib/i18n/locale";

/**
 * De sportenlijst, met disciplines per sport.
 *
 * De eerste lijst had zeven waarden: sprint, hurdles, rowing, speed_skating,
 * inline_skating, football, other. Dat waren de sporten van de eerste atleten,
 * geen taxonomie. Vijf ervan zijn ook nog eens een mengsel van twee niveaus:
 * sprint en hurdles zijn disciplines BINNEN de atletiek, en als die als sport in
 * het dossier staan is er geen veld meer over voor de discipline.
 *
 * Hier staat het in twee lagen zoals het hoort: sport, en daaronder discipline
 * of positie.
 *
 * ---------------------------------------------------------------------------
 * Waarom hier en niet in de databank
 * ---------------------------------------------------------------------------
 *
 * De sportSLEUTELS staan wel in de databank, want `identity.sport` is een
 * enum-veld en `field_definitions.enum_options` is waar de taxonomie bevroren
 * is. Wat hier staat is de rest: de labels en de disciplines. Dat is presentatie
 * en invoerhulp, geen data waar een query op draait. Zelfde redenering als
 * lib/dossier/enumLabels.ts.
 *
 * De disciplines zijn met opzet GEEN tweede enum. `identity.discipline` blijft
 * een tekstveld. Een afhankelijke enum zou betekenen dat enum_options per rij
 * afhangt van de waarde van een ander veld, en dat is een mechanisme erbij voor
 * precies een veld. De lijst hieronder is een suggestie: ze gaat als hint mee in
 * de chatprompt zodat het model "100 meter horden" op `hurdles` afbeeldt in
 * plaats van op vier verschillende schrijfwijzen, en ze vult de datalist op het
 * profielscherm. Zegt een atleet iets dat er niet in staat, dan komt dat er
 * gewoon in te staan.
 *
 * ---------------------------------------------------------------------------
 * deprecated
 * ---------------------------------------------------------------------------
 *
 * `sprint` en `hurdles` waren sporten en zijn nu disciplines van `athletics`.
 * Ze blijven in enum_options staan en hier als deprecated gemarkeerd, want er
 * liggen dossiers met die waarde erin. Verwijderen zou betekenen dat een
 * bestaand dossier een waarde heeft die niet meer in de taxonomie zit, en dan
 * zakt lib/dossier/validate.ts stil van high naar medium zonder dat er iets
 * veranderd is aan wat de atleet gezegd heeft. Ze worden niet meer aangeboden:
 * selectableSports() laat ze weg, de chatprompt ziet ze niet.
 */

export interface DisciplineDef {
  key: string;
  labelNl: string;
  labelEn: string;
}

export interface SportDef {
  key: string;
  labelNl: string;
  labelEn: string;
  /** Lege lijst: de discipline of positie is vrije tekst zonder suggesties. */
  disciplines: DisciplineDef[];
  /** Niet meer aanbieden, wel blijven herkennen. */
  deprecated?: true;
}

const d = (key: string, labelNl: string, labelEn: string): DisciplineDef => ({
  key,
  labelNl,
  labelEn,
});

/** Posities die in meerdere balsporten hetzelfde heten. */
const GOAL_SPORT = [
  d("goalkeeper", "Doelman", "Goalkeeper"),
  d("defender", "Verdediger", "Defender"),
  d("midfielder", "Middenvelder", "Midfielder"),
  d("forward", "Aanvaller", "Forward"),
];

export const SPORTS: SportDef[] = [
  {
    key: "athletics",
    labelNl: "Atletiek",
    labelEn: "Athletics",
    disciplines: [
      d("sprint", "Sprint (100-200 m)", "Sprint (100-200 m)"),
      d("sprint_400", "400 m", "400 m"),
      d("hurdles", "Horden (100-110 m)", "Hurdles (100-110 m)"),
      d("hurdles_400", "400 m horden", "400 m hurdles"),
      d("steeplechase", "Steeplechase", "Steeplechase"),
      d("middle_distance", "Middellange afstand (800-1500 m)", "Middle distance (800-1500 m)"),
      d("long_distance", "Lange afstand (3000 m en verder)", "Long distance (3000 m and up)"),
      d("marathon", "Marathon", "Marathon"),
      d("race_walking", "Snelwandelen", "Race walking"),
      d("high_jump", "Hoogspringen", "High jump"),
      d("long_jump", "Verspringen", "Long jump"),
      d("triple_jump", "Hink-stap-springen", "Triple jump"),
      d("pole_vault", "Polsstokhoogspringen", "Pole vault"),
      d("shot_put", "Kogelstoten", "Shot put"),
      d("discus", "Discuswerpen", "Discus"),
      d("javelin", "Speerwerpen", "Javelin"),
      d("hammer", "Kogelslingeren", "Hammer"),
      d("combined_events", "Meerkamp", "Combined events"),
    ],
  },
  {
    key: "road_running",
    labelNl: "Wegloop",
    labelEn: "Road running",
    disciplines: [
      d("5k", "5 km", "5 km"),
      d("10k", "10 km", "10 km"),
      d("half_marathon", "Halve marathon", "Half marathon"),
      d("marathon", "Marathon", "Marathon"),
      d("ultra", "Ultraloop", "Ultra"),
    ],
  },
  {
    key: "trail_running",
    labelNl: "Trailrunning",
    labelEn: "Trail running",
    disciplines: [
      d("short_trail", "Korte trail (tot 42 km)", "Short trail (up to 42 km)"),
      d("ultra_trail", "Ultratrail", "Ultra trail"),
      d("skyrunning", "Skyrunning", "Skyrunning"),
    ],
  },
  {
    key: "triathlon",
    labelNl: "Triatlon",
    labelEn: "Triathlon",
    disciplines: [
      d("sprint_distance", "Sprintafstand", "Sprint distance"),
      d("olympic_distance", "Olympische afstand", "Olympic distance"),
      d("middle_distance", "Halve afstand (70.3)", "Middle distance (70.3)"),
      d("long_distance", "Volledige afstand", "Full distance"),
      d("duathlon", "Duatlon", "Duathlon"),
      d("aquathlon", "Aquatlon", "Aquathlon"),
    ],
  },
  {
    key: "cycling_road",
    labelNl: "Wielrennen (weg)",
    labelEn: "Road cycling",
    disciplines: [
      d("sprinter", "Sprinter", "Sprinter"),
      d("climber", "Klimmer", "Climber"),
      d("classics", "Klassiekerrenner", "Classics rider"),
      d("time_trial", "Tijdrijder", "Time trialist"),
      d("all_rounder", "Allrounder", "All-rounder"),
    ],
  },
  {
    key: "cycling_track",
    labelNl: "Baanwielrennen",
    labelEn: "Track cycling",
    disciplines: [
      d("sprint", "Sprint", "Sprint"),
      d("keirin", "Keirin", "Keirin"),
      d("team_sprint", "Teamsprint", "Team sprint"),
      d("pursuit", "Achtervolging", "Pursuit"),
      d("madison", "Koppelkoers", "Madison"),
      d("omnium", "Omnium", "Omnium"),
    ],
  },
  {
    key: "mountain_biking",
    labelNl: "Mountainbike",
    labelEn: "Mountain biking",
    disciplines: [
      d("cross_country", "Cross-country", "Cross-country"),
      d("marathon", "Marathon", "Marathon"),
      d("downhill", "Downhill", "Downhill"),
      d("enduro", "Enduro", "Enduro"),
    ],
  },
  { key: "cyclocross", labelNl: "Veldrijden", labelEn: "Cyclocross", disciplines: [] },
  {
    key: "bmx",
    labelNl: "BMX",
    labelEn: "BMX",
    disciplines: [d("racing", "Racing", "Racing"), d("freestyle", "Freestyle", "Freestyle")],
  },
  {
    key: "swimming",
    labelNl: "Zwemmen",
    labelEn: "Swimming",
    disciplines: [
      d("freestyle", "Vrije slag", "Freestyle"),
      d("backstroke", "Rugslag", "Backstroke"),
      d("breaststroke", "Schoolslag", "Breaststroke"),
      d("butterfly", "Vlinderslag", "Butterfly"),
      d("medley", "Wisselslag", "Medley"),
      d("open_water", "Open water", "Open water"),
    ],
  },
  { key: "water_polo", labelNl: "Waterpolo", labelEn: "Water polo", disciplines: [] },
  { key: "diving", labelNl: "Schoonspringen", labelEn: "Diving", disciplines: [] },
  {
    key: "rowing",
    labelNl: "Roeien",
    labelEn: "Rowing",
    disciplines: [
      d("single_sculls", "Skiff", "Single sculls"),
      d("double_sculls", "Dubbel twee", "Double sculls"),
      d("quadruple_sculls", "Dubbel vier", "Quadruple sculls"),
      d("coxless_pair", "Twee zonder", "Coxless pair"),
      d("coxless_four", "Vier zonder", "Coxless four"),
      d("eight", "Acht", "Eight"),
      d("coxswain", "Stuurman", "Coxswain"),
      d("lightweight", "Lichtgewicht", "Lightweight"),
    ],
  },
  {
    key: "kayak_canoe",
    labelNl: "Kajak en kano",
    labelEn: "Kayak and canoe",
    disciplines: [
      d("sprint", "Vlakwater", "Sprint"),
      d("slalom", "Slalom", "Slalom"),
      d("marathon", "Marathon", "Marathon"),
    ],
  },
  { key: "sailing", labelNl: "Zeilen", labelEn: "Sailing", disciplines: [] },
  {
    key: "speed_skating",
    labelNl: "Schaatsen (langebaan)",
    labelEn: "Speed skating (long track)",
    disciplines: [
      d("sprint", "Sprint (500-1000 m)", "Sprint (500-1000 m)"),
      d("allround", "Allround", "Allround"),
      d("long_distance", "Lange afstand (5000-10000 m)", "Long distance (5000-10000 m)"),
      d("mass_start", "Massastart", "Mass start"),
      d("team_pursuit", "Ploegenachtervolging", "Team pursuit"),
    ],
  },
  { key: "short_track", labelNl: "Shorttrack", labelEn: "Short track", disciplines: [] },
  { key: "inline_skating", labelNl: "Inline skaten", labelEn: "Inline skating", disciplines: [] },
  { key: "ice_hockey", labelNl: "IJshockey", labelEn: "Ice hockey", disciplines: [] },
  { key: "figure_skating", labelNl: "Kunstschaatsen", labelEn: "Figure skating", disciplines: [] },
  {
    key: "alpine_skiing",
    labelNl: "Alpineskiën",
    labelEn: "Alpine skiing",
    disciplines: [
      d("slalom", "Slalom", "Slalom"),
      d("giant_slalom", "Reuzenslalom", "Giant slalom"),
      d("super_g", "Super-G", "Super-G"),
      d("downhill", "Afdaling", "Downhill"),
      d("combined", "Combinatie", "Combined"),
    ],
  },
  {
    key: "cross_country_skiing",
    labelNl: "Langlaufen",
    labelEn: "Cross-country skiing",
    disciplines: [
      d("sprint", "Sprint", "Sprint"),
      d("distance", "Afstand", "Distance"),
      d("biathlon", "Biatlon", "Biathlon"),
    ],
  },
  {
    key: "snowboarding",
    labelNl: "Snowboarden",
    labelEn: "Snowboarding",
    disciplines: [
      d("snowboard_cross", "Snowboardcross", "Snowboard cross"),
      d("slopestyle", "Slopestyle", "Slopestyle"),
      d("halfpipe", "Halfpipe", "Halfpipe"),
      d("alpine", "Alpine", "Alpine"),
    ],
  },
  { key: "football", labelNl: "Voetbal", labelEn: "Football", disciplines: GOAL_SPORT },
  { key: "field_hockey", labelNl: "Hockey", labelEn: "Field hockey", disciplines: GOAL_SPORT },
  {
    key: "handball",
    labelNl: "Handbal",
    labelEn: "Handball",
    disciplines: [
      d("goalkeeper", "Doelman", "Goalkeeper"),
      d("wing", "Hoekspeler", "Wing"),
      d("back", "Opbouwer", "Back"),
      d("pivot", "Cirkelloper", "Pivot"),
    ],
  },
  {
    key: "basketball",
    labelNl: "Basketbal",
    labelEn: "Basketball",
    disciplines: [
      d("point_guard", "Point guard", "Point guard"),
      d("shooting_guard", "Shooting guard", "Shooting guard"),
      d("small_forward", "Small forward", "Small forward"),
      d("power_forward", "Power forward", "Power forward"),
      d("center", "Center", "Center"),
    ],
  },
  {
    key: "volleyball",
    labelNl: "Volleybal",
    labelEn: "Volleyball",
    disciplines: [
      d("setter", "Spelverdeler", "Setter"),
      d("outside_hitter", "Passer-loper", "Outside hitter"),
      d("middle_blocker", "Middenaanvaller", "Middle blocker"),
      d("opposite", "Diagonaal", "Opposite"),
      d("libero", "Libero", "Libero"),
    ],
  },
  { key: "beach_volleyball", labelNl: "Beachvolleybal", labelEn: "Beach volleyball", disciplines: [] },
  { key: "korfball", labelNl: "Korfbal", labelEn: "Korfball", disciplines: [] },
  {
    key: "rugby",
    labelNl: "Rugby",
    labelEn: "Rugby",
    disciplines: [
      d("forward", "Voorwaarts", "Forward"),
      d("back", "Achterwaarts", "Back"),
      d("sevens", "Sevens", "Sevens"),
    ],
  },
  { key: "american_football", labelNl: "American football", labelEn: "American football", disciplines: [] },
  { key: "baseball_softball", labelNl: "Honkbal en softbal", labelEn: "Baseball and softball", disciplines: [] },
  {
    key: "tennis",
    labelNl: "Tennis",
    labelEn: "Tennis",
    disciplines: [d("singles", "Enkel", "Singles"), d("doubles", "Dubbel", "Doubles")],
  },
  { key: "padel", labelNl: "Padel", labelEn: "Padel", disciplines: [] },
  { key: "badminton", labelNl: "Badminton", labelEn: "Badminton", disciplines: [] },
  { key: "squash", labelNl: "Squash", labelEn: "Squash", disciplines: [] },
  { key: "table_tennis", labelNl: "Tafeltennis", labelEn: "Table tennis", disciplines: [] },
  { key: "golf", labelNl: "Golf", labelEn: "Golf", disciplines: [] },
  { key: "judo", labelNl: "Judo", labelEn: "Judo", disciplines: [] },
  { key: "wrestling", labelNl: "Worstelen", labelEn: "Wrestling", disciplines: [] },
  { key: "taekwondo", labelNl: "Taekwondo", labelEn: "Taekwondo", disciplines: [] },
  { key: "karate", labelNl: "Karate", labelEn: "Karate", disciplines: [] },
  { key: "boxing", labelNl: "Boksen", labelEn: "Boxing", disciplines: [] },
  { key: "kickboxing", labelNl: "Kickboksen en muay thai", labelEn: "Kickboxing and muay thai", disciplines: [] },
  { key: "mma", labelNl: "MMA", labelEn: "MMA", disciplines: [] },
  { key: "fencing", labelNl: "Schermen", labelEn: "Fencing", disciplines: [] },
  {
    key: "gymnastics_artistic",
    labelNl: "Turnen",
    labelEn: "Artistic gymnastics",
    disciplines: [
      d("all_around", "Meerkamp", "All-around"),
      d("floor", "Vloer", "Floor"),
      d("vault", "Sprong", "Vault"),
      d("bars", "Brug", "Bars"),
      d("beam", "Balk", "Beam"),
      d("rings", "Ringen", "Rings"),
      d("pommel_horse", "Voltige", "Pommel horse"),
      d("high_bar", "Rekstok", "High bar"),
    ],
  },
  { key: "gymnastics_rhythmic", labelNl: "Ritmische gymnastiek", labelEn: "Rhythmic gymnastics", disciplines: [] },
  { key: "trampoline", labelNl: "Trampoline", labelEn: "Trampoline", disciplines: [] },
  { key: "acrobatics", labelNl: "Acrogym en tumbling", labelEn: "Acrobatics and tumbling", disciplines: [] },
  { key: "dance", labelNl: "Dans en ballet", labelEn: "Dance and ballet", disciplines: [] },
  {
    key: "climbing",
    labelNl: "Klimmen",
    labelEn: "Climbing",
    disciplines: [
      d("lead", "Lead", "Lead"),
      d("bouldering", "Boulderen", "Bouldering"),
      d("speed", "Speed", "Speed"),
    ],
  },
  { key: "weightlifting", labelNl: "Gewichtheffen", labelEn: "Weightlifting", disciplines: [] },
  { key: "powerlifting", labelNl: "Powerlifting", labelEn: "Powerlifting", disciplines: [] },
  { key: "crossfit", labelNl: "CrossFit en functional fitness", labelEn: "CrossFit and functional fitness", disciplines: [] },
  {
    key: "equestrian",
    labelNl: "Paardensport",
    labelEn: "Equestrian",
    disciplines: [
      d("dressage", "Dressuur", "Dressage"),
      d("jumping", "Springen", "Jumping"),
      d("eventing", "Eventing", "Eventing"),
      d("endurance", "Endurance", "Endurance"),
    ],
  },
  { key: "archery", labelNl: "Boogschieten", labelEn: "Archery", disciplines: [] },
  { key: "shooting", labelNl: "Schietsport", labelEn: "Shooting", disciplines: [] },
  { key: "orienteering", labelNl: "Oriëntatieloop", labelEn: "Orienteering", disciplines: [] },
  { key: "obstacle_racing", labelNl: "Obstacle racing", labelEn: "Obstacle racing", disciplines: [] },
  { key: "motorsport", labelNl: "Motorsport en karting", labelEn: "Motorsport and karting", disciplines: [] },
  { key: "esports", labelNl: "Esports", labelEn: "Esports", disciplines: [] },

  // Waren sport, zijn nu discipline van athletics. Zie de kop van dit bestand.
  { key: "sprint", labelNl: "Sprint", labelEn: "Sprint", disciplines: [], deprecated: true },
  { key: "hurdles", labelNl: "Horden", labelEn: "Hurdles", disciplines: [], deprecated: true },

  { key: "other", labelNl: "Andere", labelEn: "Other", disciplines: [] },
];

const BY_KEY = new Map(SPORTS.map((sport) => [sport.key, sport]));

/** Wat een atleet of de chat te kiezen krijgt: alles behalve de afgedankte sleutels. */
export function selectableSports(): SportDef[] {
  return SPORTS.filter((sport) => !sport.deprecated);
}

/** Elke sleutel die geldig blijft, afgedankte inbegrepen. Dit is wat in enum_options hoort. */
export function sportKeys(): string[] {
  return SPORTS.map((sport) => sport.key);
}

export function sportLabel(key: string, locale: Locale): string | null {
  const sport = BY_KEY.get(key);
  if (!sport) return null;
  return locale === "nl" ? sport.labelNl : sport.labelEn;
}

/**
 * De disciplines van een sport, als suggestie.
 *
 * Een onbekende sport levert een lege lijst en geen fout: `identity.sport` kan
 * leeg zijn op het moment dat er naar de discipline gevraagd wordt, en dan is er
 * simpelweg niets te suggereren.
 */
export function disciplinesOf(sportKey: unknown, locale: Locale): string[] {
  if (typeof sportKey !== "string") return [];
  const sport = BY_KEY.get(sportKey);
  if (!sport) return [];
  return sport.disciplines.map((item) => (locale === "nl" ? item.labelNl : item.labelEn));
}

/** Of een sleutel nog aangeboden mag worden. Zie de kop van dit bestand. */
export function isDeprecatedSport(key: string): boolean {
  return BY_KEY.get(key)?.deprecated === true;
}
