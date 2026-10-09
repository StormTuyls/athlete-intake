import { type Band, validateBands } from "./bands";
import type { Direction } from "./direction";
import type { TrialSelection } from "./selection";
import type { Unit } from "./units";

/**
 * De screeningsbibliotheek, als getypeerde data.
 *
 * Dit is de inhoud van spec §6: de bronafkapwaarden uit de Screening
 * 2025-bestanden. Spec §6 zegt er zelf bij hoe ze hier horen te landen: "They
 * should be imported as versioned reference rules, not hard-coded permanently
 * into the UI."
 *
 * Wat hier NIET staat: de volledige testbibliotheek uit spec §7. Die is drie
 * keer zo groot en bestaat voor een groot deel uit tests die §7 zelf als
 * "protocol required" markeert. Een test zonder protocol levert getallen op die
 * niemand kan duiden, en vroeg seeden garandeert een protocolherziening later.
 * Ze komen erbij zodra de praktijk het protocol vastlegt.
 *
 * classificationEnabled staat op false waar spec §10 en §18 zeggen dat het niet
 * veilig is. Dat zijn geen meningen maar de noten in de brontabel zelf:
 * "VERIFY PROTOCOL" bij 90-90 en Thomas, "GAPS exist between categories" bij
 * ASH, en "VERIFY system weight" bij de Iso Push-testen. Die tests worden wel
 * gemeten en getrend, alleen niet ingedeeld.
 */

export interface TestDef {
  key: string;
  block: string;
  sortOrder: number;
  labelNl: string;
  labelEn: string;
  laterality: "bilateral" | "per_side" | "either";
  bodyRegion?: string;
  sourceNote?: string;
}

export interface ProtocolDef {
  testKey: string;
  version: number;
  labelNl: string;
  labelEn: string;
  device?: string;
  bodyPosition?: string;
  trialCount?: number;
  trialSelection: TrialSelection;
  /** False zolang positie, hoek of hefboom niet vastligt. Spec §10, §18. */
  protocolConfirmed: boolean;
  protocolSource?: string;
}

export interface MetricDef {
  key: string;
  testKey: string;
  labelNl: string;
  labelEn: string;
  unit: Unit;
  direction: Direction;
  isCore: boolean;
  decimals: number;
}

export interface RuleDef {
  ruleKey: string;
  version: number;
  metricKey: string;
  layer: "published" | "internal_target";
  bands: Band[];
  coverage: "total" | "gapped";
  classificationEnabled: boolean;
  evidence: "source_sheet" | "published" | "internal";
  sourceCitation?: string;
  sourceNote?: string;
}

export interface Library {
  tests: TestDef[];
  protocols: ProtocolDef[];
  metrics: MetricDef[];
  rules: RuleDef[];
}

const SOURCE = "Screening 2025 (XLSX/PDF), via UNBOUND-specificatie §6";

// Verkorte opbouw: de meeste tests zijn een enkele meting met een enkele regel.
// Zonder deze helper is dit bestand vier losse arrays waarin dezelfde sleutel
// vier keer met de hand overgetypt wordt.
function simple(input: {
  key: string;
  block: string;
  sortOrder: number;
  nl: string;
  en: string;
  laterality: TestDef["laterality"];
  unit: Unit;
  direction: Direction;
  decimals?: number;
  device?: string;
  bodyPosition?: string;
  protocolConfirmed: boolean;
  bands?: Band[];
  coverage?: "total" | "gapped";
  classificationEnabled?: boolean;
  note?: string;
}): Library {
  const metricKey = `${input.key}.value`;
  return {
    tests: [
      {
        key: input.key,
        block: input.block,
        sortOrder: input.sortOrder,
        labelNl: input.nl,
        labelEn: input.en,
        laterality: input.laterality,
      },
    ],
    protocols: [
      {
        testKey: input.key,
        version: 1,
        labelNl: `${input.nl} v1`,
        labelEn: `${input.en} v1`,
        device: input.device,
        bodyPosition: input.bodyPosition,
        trialCount: 1,
        trialSelection: "single",
        protocolConfirmed: input.protocolConfirmed,
        protocolSource: SOURCE,
      },
    ],
    metrics: [
      {
        key: metricKey,
        testKey: input.key,
        labelNl: input.nl,
        labelEn: input.en,
        unit: input.unit,
        direction: input.direction,
        isCore: true,
        decimals: input.decimals ?? (input.unit === "score" ? 0 : 1),
      },
    ],
    rules: input.bands
      ? [
          {
            ruleKey: `screening2025.${input.key}`,
            version: 1,
            metricKey,
            layer: "published",
            bands: input.bands,
            coverage: input.coverage ?? "total",
            classificationEnabled: input.classificationEnabled ?? true,
            evidence: "source_sheet",
            sourceCitation: SOURCE,
            sourceNote: input.note,
          },
        ]
      : [],
  };
}

const BOUNDARY =
  "Grenzen zijn halfopen [ondergrens, bovengrens). Spec §6 laat de randwaarde " +
  "open; deze conventie beantwoordt dat voor alle regels tegelijk.";

const PARTS: Library[] = [
  // ── Antropometrie ──────────────────────────────────────────────────────────
  simple({
    key: "anthropometry.navicular_drop",
    block: "anthropometry", sortOrder: 1,
    nl: "Navicular drop", en: "Navicular drop",
    laterality: "per_side", unit: "cm", direction: "lower_better",
    protocolConfirmed: true,
    bands: [
      { status: "normal", score: 1, lt: 1 },
      { status: "attention", score: 0, gte: 1 },
    ],
    note: `Bron: 0 bij >1 cm, 1 bij <1 cm. ${BOUNDARY} Exact 1,0 cm telt als 0.`,
  }),
  simple({
    key: "anthropometry.genu_recurvatum",
    block: "anthropometry", sortOrder: 2,
    nl: "Genu recurvatum", en: "Genu recurvatum",
    laterality: "per_side", unit: "deg", direction: "target_range",
    protocolConfirmed: true,
    bands: [
      { status: "flexion_deficit", score: 0, lt: 0 },
      { status: "normal", score: 1, gte: 0, lt: 10 },
      { status: "recurvatum", score: 0, gte: 10 },
    ],
    note: `Bron: 1 bij 0-10 graden, 0 bij <0 of >10. Twee kanten slechter, dus target_range. ${BOUNDARY}`,
  }),
  simple({
    key: "anthropometry.mtp1_extension",
    block: "anthropometry", sortOrder: 3,
    nl: "MTP1-extensie", en: "MTP1 extension",
    laterality: "per_side", unit: "deg", direction: "higher_better",
    protocolConfirmed: true,
    bands: [
      { status: "limited", score: 0, lt: 60 },
      { status: "normal", score: 1, gte: 60 },
    ],
    note: `Bron: 0 bij <60, 1 bij >60. ${BOUNDARY} Exact 60 telt als 1.`,
  }),
  simple({
    key: "anthropometry.apley",
    block: "anthropometry", sortOrder: 4,
    nl: "Apley-schoudermobiliteit", en: "Apley shoulder mobility",
    laterality: "per_side", unit: "hand_lengths", direction: "lower_better",
    protocolConfirmed: false,
    bands: [
      { status: "normal", score: 1, lt: 1.5 },
      { status: "attention", score: 0, gte: 1.5 },
    ],
    classificationEnabled: false,
    note:
      "Spec §6: 'Protocol and direction must be explicit.' Tot de praktijk de " +
      "meetrichting vastlegt wordt deze waarde gemeten en getrend, niet ingedeeld.",
  }),

  // ── Mobiliteit onderste lidmaat ────────────────────────────────────────────
  simple({
    key: "mobility_ll.passive_slr",
    block: "mobility_ll", sortOrder: 1,
    nl: "Passieve SLR", en: "Passive straight-leg raise",
    laterality: "per_side", unit: "deg", direction: "higher_better",
    protocolConfirmed: true,
    bands: [
      { status: "poor", score: 0, lt: 75 },
      { status: "fair", score: 1, gte: 75, lt: 80 },
      { status: "good", score: 2, gte: 80, lt: 85 },
      { status: "excellent", score: 3, gte: 85 },
    ],
    note: BOUNDARY,
  }),
  simple({
    key: "mobility_ll.knee_extension_90_90",
    block: "mobility_ll", sortOrder: 2,
    nl: "Passieve 90-90 knie-extensie", en: "Passive 90-90 knee extension",
    laterality: "per_side", unit: "deg", direction: "higher_better",
    protocolConfirmed: false,
    bands: [
      { status: "poor", score: 0, lt: 17 },
      { status: "fair", score: 1, gte: 17, lt: 25 },
      { status: "good", score: 2, gte: 25, lt: 33 },
      { status: "excellent", score: 3, gte: 33 },
    ],
    classificationEnabled: false,
    note:
      "Spec §6: 'VERIFY PROTOCOL: if this is extension deficit, scoring direction " +
      "may be reversed.' Is de waarde een extensieTEKORT, dan wordt elke atleet " +
      "omgekeerd ingedeeld. Classificatie blijft uit tot de conventie vastligt.",
  }),
  simple({
    key: "mobility_ll.hip_ir_extension",
    block: "mobility_ll", sortOrder: 3,
    nl: "Heup-endorotatie in extensie", en: "Hip internal rotation in extension",
    laterality: "per_side", unit: "deg", direction: "higher_better",
    protocolConfirmed: true,
    bands: [
      { status: "poor", score: 0, lt: 30 },
      { status: "fair", score: 1, gte: 30, lt: 40 },
      { status: "good", score: 2, gte: 40, lt: 45 },
      { status: "excellent", score: 3, gte: 45 },
    ],
    note: BOUNDARY,
  }),
  simple({
    key: "mobility_ll.hip_er_extension",
    block: "mobility_ll", sortOrder: 4,
    nl: "Heup-exorotatie in extensie", en: "Hip external rotation in extension",
    laterality: "per_side", unit: "deg", direction: "higher_better",
    protocolConfirmed: true,
    bands: [
      { status: "poor", score: 0, lt: 35 },
      { status: "fair", score: 1, gte: 35, lt: 45 },
      { status: "good", score: 2, gte: 45, lt: 50 },
      { status: "excellent", score: 3, gte: 50 },
    ],
    note: BOUNDARY,
  }),
  simple({
    key: "mobility_ll.hip_abduction",
    block: "mobility_ll", sortOrder: 5,
    nl: "Lange-adductorlengte (heupabductie)", en: "Long adductor length (hip abduction)",
    laterality: "per_side", unit: "deg", direction: "higher_better",
    protocolConfirmed: false,
    bands: [
      { status: "poor", score: 0, lt: 40 },
      { status: "fair", score: 1, gte: 40, lt: 45 },
      { status: "good", score: 2, gte: 45, lt: 55 },
      { status: "excellent", score: 3, gte: 55 },
    ],
    note: `Spec §6: 'Name/protocol should be standardized.' Banden zijn sluitend, richting is eenduidig. ${BOUNDARY}`,
  }),
  simple({
    key: "mobility_ll.faber",
    block: "mobility_ll", sortOrder: 6,
    nl: "Korte-adductorlengte (FABER)", en: "Short adductor length (FABER)",
    laterality: "per_side", unit: "cm", direction: "lower_better",
    protocolConfirmed: false,
    bands: [
      { status: "excellent", score: 3, lt: 5 },
      { status: "good", score: 2, gte: 5, lt: 10 },
      { status: "fair", score: 1, gte: 10, lt: 15 },
      { status: "poor", score: 0, gte: 15 },
    ],
    note: `Lager is beter: de score loopt af terwijl de banden oplopen. Spec §6 vraagt om expliciete landmarks. ${BOUNDARY}`,
  }),
  simple({
    key: "mobility_ll.ely",
    block: "mobility_ll", sortOrder: 7,
    nl: "Ely", en: "Ely",
    laterality: "per_side", unit: "deg", direction: "higher_better",
    protocolConfirmed: false,
    bands: [
      { status: "poor", score: 0, lt: 120 },
      { status: "fair", score: 1, gte: 120, lt: 135 },
      { status: "good", score: 2, gte: 135, lt: 150 },
      { status: "excellent", score: 3, gte: 150 },
    ],
    note: BOUNDARY,
  }),
  simple({
    key: "mobility_ll.thomas",
    block: "mobility_ll", sortOrder: 8,
    nl: "Thomas", en: "Thomas",
    laterality: "per_side", unit: "deg", direction: "higher_better",
    protocolConfirmed: false,
    bands: [
      { status: "poor", score: 0, lt: 0 },
      { status: "fair", score: 1, gte: 0, lt: 10 },
      { status: "good", score: 2, gte: 10, lt: 20 },
      { status: "excellent", score: 3, gte: 20 },
    ],
    classificationEnabled: false,
    note: "Spec §6: 'VERIFY PROTOCOL and sign convention.' Classificatie blijft uit.",
  }),
  simple({
    key: "mobility_ll.thomas_tfl",
    block: "mobility_ll", sortOrder: 9,
    nl: "Thomas voor TFL", en: "Thomas for TFL",
    laterality: "per_side", unit: "score", direction: "higher_better",
    protocolConfirmed: true,
  }),
  simple({
    key: "mobility_ll.knee_to_wall",
    block: "mobility_ll", sortOrder: 10,
    nl: "Knee-to-wall", en: "Knee-to-wall",
    laterality: "per_side", unit: "cm", direction: "higher_better",
    protocolConfirmed: false,
    bands: [
      { status: "poor", score: 0, lt: 8 },
      { status: "fair", score: 1, gte: 8, lt: 10 },
      { status: "good", score: 2, gte: 10, lt: 12 },
      { status: "excellent", score: 3, gte: 12 },
    ],
    note: `Spec §6 vraagt om teen-muur- en hielcriteria. ${BOUNDARY}`,
  }),

  // ── Mobiliteit bovenste lidmaat ────────────────────────────────────────────
  simple({
    key: "mobility_ul.pectoralis_minor",
    block: "mobility_ul", sortOrder: 1,
    nl: "Pectoralis minor", en: "Pectoralis minor",
    laterality: "per_side", unit: "cm", direction: "lower_better",
    decimals: 2,
    protocolConfirmed: true,
    bands: [
      { status: "normal", score: 1, lt: 2.54 },
      { status: "attention", score: 0, gte: 2.54 },
    ],
    note: `Bron: 0 bij >2,54 cm, 1 bij <2,54. ${BOUNDARY}`,
  }),

  // ── Rompcontrole ───────────────────────────────────────────────────────────
  // ASLR en de push-uptest leveren rechtstreeks een 0-3-score op: de tester
  // scoort de landmarks. Er is dus geen afkapwaarde nodig; de meting IS de score.
  simple({
    key: "core.aslr",
    block: "core", sortOrder: 1,
    nl: "ASLR", en: "ASLR",
    laterality: "per_side", unit: "score", direction: "higher_better",
    protocolConfirmed: true,
  }),
  simple({
    key: "core.push_up_test",
    block: "core", sortOrder: 2,
    nl: "Push-uptest", en: "Push-up test",
    laterality: "bilateral", unit: "score", direction: "higher_better",
    protocolConfirmed: false,
  }),
  simple({
    key: "core.waiters_bow",
    block: "core", sortOrder: 3,
    nl: "Waiter's bow", en: "Waiter's bow",
    laterality: "bilateral", unit: "deg", direction: "higher_better",
    protocolConfirmed: true,
    bands: [
      { status: "poor", score: 0, lt: 45 },
      { status: "fair", score: 1, gte: 45, lt: 60 },
      { status: "good", score: 2, gte: 60, lt: 75 },
      { status: "excellent", score: 3, gte: 75 },
    ],
    note: BOUNDARY,
  }),

  // ── Bewegingskwaliteit ─────────────────────────────────────────────────────
  simple({
    key: "movement_ll.overhead_deep_squat",
    block: "movement_ll", sortOrder: 1,
    nl: "Overhead deep squat", en: "Overhead deep squat",
    laterality: "bilateral", unit: "score", direction: "higher_better",
    protocolConfirmed: true,
  }),
  simple({
    key: "movement_ll.lateral_step_down",
    block: "movement_ll", sortOrder: 2,
    nl: "Lateral step-down", en: "Lateral step-down",
    laterality: "per_side", unit: "score", direction: "higher_better",
    protocolConfirmed: false,
  }),

  // ── Isometrische push ──────────────────────────────────────────────────────
  // Alle drie uit: spec §6 noemt "VERIFY 'system weight' definition and
  // protocol", en §10 zet het mengen van N/kg, xBW en systeemgewicht op HIGH.
  // Zonder die definitie is een xBW-waarde niet eens eenduidig.
  ...(
    [
      { k: "hip", nl: "Heup", en: "Hip", lo: 2.2, hi: 2.5, top: 3, o: 1 },
      { k: "knee", nl: "Knie", en: "Knee", lo: 4.2, hi: 4.4, top: 5.5, o: 2 },
      { k: "ankle", nl: "Enkel", en: "Ankle", lo: 3.1, hi: 3.3, top: 4, o: 3 },
    ] as const
  ).map((t) =>
    simple({
      key: `forcedecks.${t.k}_iso_push`,
      block: "forcedecks", sortOrder: t.o,
      nl: `${t.nl} iso push`, en: `${t.en} iso push`,
      laterality: "per_side", unit: "xbw", direction: "higher_better",
      decimals: 2,
      device: "ForceDecks",
      protocolConfirmed: false,
      bands: [
        { status: "below_target", score: 0, lt: t.lo },
        { status: "target", score: 2, gte: t.lo, lt: t.hi },
        { status: "high", score: 3, gte: t.top },
      ],
      coverage: "gapped",
      classificationEnabled: false,
      note:
        `Bron: streefbereik ${t.lo}-${t.hi}x, hoog >${t.top}x. Tussen ${t.hi} en ` +
        `${t.top} noemt de bron geen band, dus coverage 'gapped'. Spec §6: ` +
        "VERIFY 'system weight' definition and protocol.",
    }),
  ),

  // ── ASH ────────────────────────────────────────────────────────────────────
  // Spec §6: "GAPS exist between categories; must define full bands." Bij ASH I
  // valt 165 N nergens in. Alleen de newtonwaarde wordt geseed; de N/kg-variant
  // uit de bron is dezelfde meting genormaliseerd en volgt uit per_body_mass.
  ...(
    [
      { k: "i", nl: "ASH I", lo: 150, mid: 180, hi: 200, o: 1 },
      { k: "y", nl: "ASH Y", lo: 125, mid: 155, hi: 170, o: 2 },
      { k: "t", nl: "ASH T", lo: 115, mid: 135, hi: 150, o: 3 },
    ] as const
  ).map((t) =>
    simple({
      key: `strength_ul.ash_${t.k}`,
      block: "strength_ul", sortOrder: t.o,
      nl: t.nl, en: t.nl,
      laterality: "per_side", unit: "n", direction: "higher_better",
      decimals: 0,
      protocolConfirmed: false,
      bands: [
        { status: "low", score: 1, lt: t.lo },
        { status: "moderate", score: 2, gte: t.mid, lt: t.hi },
        { status: "high", score: 3, gte: t.hi },
      ],
      coverage: "gapped",
      classificationEnabled: false,
      note:
        `Bron: 1 bij <${t.lo} N, 2 bij >${t.mid}, 3 bij >${t.hi}. Tussen ${t.lo} en ` +
        `${t.mid} N is geen band gedefinieerd. Spec §6: 'GAPS exist between ` +
        "categories; must define full bands.'",
    }),
  ),
];

export const LIBRARY: Library = {
  tests: PARTS.flatMap((p) => p.tests),
  protocols: PARTS.flatMap((p) => p.protocols),
  metrics: PARTS.flatMap((p) => p.metrics),
  rules: PARTS.flatMap((p) => p.rules),
};

/**
 * Controleert de bibliotheek. Draait bij het seeden en in CI, zonder databank.
 *
 * Dezelfde opzet als validateConditions() in lib/dossier/askWhen.ts, met
 * dezelfde motivatie: de faalwijzen hier zijn stil. Een regel die naar een
 * metriek verwijst die niet bestaat levert geen foutmelding op, alleen een test
 * die nooit een band krijgt. Overlappende banden leveren gewoon de eerste op die
 * past.
 *
 * Let op het onderscheid dat deze functie NIET afdwingt: protocolConfirmed en
 * classificationEnabled beantwoorden twee verschillende vragen.
 *
 *   protocolConfirmed=false  -> longitudinaal vergelijken is niet gedekt, want
 *                               positie, hoek of hefboom ligt niet vast.
 *   classificationEnabled=false -> indelen is niet veilig, want de
 *                               tekenconventie of de bandindeling klopt niet.
 *
 * Knee-to-wall heeft het eerste probleem en niet het tweede: de banden zijn
 * sluitend en meer is duidelijk beter, alleen ontbreken de teen-muurcriteria.
 * De 90-90 heeft het tweede. Ze aan elkaar koppelen zou de helft van de
 * bruikbare afkapwaarden uitzetten op grond van een andere vraag.
 */
export function validateLibrary(library: Library = LIBRARY): string[] {
  const errors: string[] = [];
  const dupes = (what: string, keys: string[]) => {
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) errors.push(`${what}: dubbele sleutel '${k}'`);
      seen.add(k);
    }
  };

  dupes("test_definitions", library.tests.map((t) => t.key));
  dupes("metric_definitions", library.metrics.map((m) => m.key));
  dupes(
    "test_protocols",
    library.protocols.map((p) => `${p.testKey}@${p.version}`),
  );
  dupes("reference_rules", library.rules.map((r) => `${r.ruleKey}@${r.version}`));

  // (block, sort_order) is uniek in de databank; een botsing hier is daar een
  // mislukte insert halverwege de seed.
  dupes(
    "test_definitions (block, sort_order)",
    library.tests.map((t) => `${t.block}#${t.sortOrder}`),
  );

  const testKeys = new Set(library.tests.map((t) => t.key));
  const metrics = new Map(library.metrics.map((m) => [m.key, m]));

  for (const p of library.protocols) {
    if (!testKeys.has(p.testKey)) {
      errors.push(`protocol '${p.testKey}@${p.version}' verwijst naar een onbekende test`);
    }
  }
  for (const t of library.tests) {
    if (!library.protocols.some((p) => p.testKey === t.key)) {
      errors.push(`test '${t.key}' heeft geen protocol`);
    }
  }
  for (const m of library.metrics) {
    if (!testKeys.has(m.testKey)) {
      errors.push(`metriek '${m.key}' verwijst naar een onbekende test '${m.testKey}'`);
    }
    // Een 0-3-score waarvan minder beter zou zijn bestaat niet in deze bron, en
    // zou elke band omdraaien.
    if (m.unit === "score" && m.direction !== "higher_better") {
      errors.push(`metriek '${m.key}': een score hoort higher_better te zijn`);
    }
  }

  for (const r of library.rules) {
    const metric = metrics.get(r.metricKey);
    if (!metric) {
      errors.push(`regel '${r.ruleKey}' verwijst naar een onbekende metriek '${r.metricKey}'`);
      continue;
    }
    // Spiegelt reference_rules_gapped_cannot_classify. Hier gevangen levert een
    // regelnaam op; daar levert het een mislukte migratie op.
    if (r.coverage === "gapped" && r.classificationEnabled) {
      errors.push(`regel '${r.ruleKey}': een reeks met gaten mag niet classificeren`);
    }
    if (r.evidence === "published" && !r.sourceCitation) {
      errors.push(`regel '${r.ruleKey}': een gepubliceerde norm heeft een citatie nodig`);
    }
    // Een streefbereik is aan twee kanten slechter en heeft dus minstens drie
    // banden; met twee is het gewoon een drempel en klopt de richting niet.
    if (metric.direction === "target_range" && r.bands.length < 3) {
      errors.push(`regel '${r.ruleKey}': target_range heeft minstens drie banden nodig`);
    }
    for (const problem of validateBands(r.bands, r.coverage)) {
      errors.push(`regel '${r.ruleKey}': ${problem}`);
    }
  }

  return errors;
}
