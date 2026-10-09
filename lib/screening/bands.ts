import { z } from "zod";

/**
 * Van een waarde naar een statusband.
 *
 * De vorm is een oplopende array van HALFOPEN intervallen [gte, lt):
 *
 *   [{"status":"poor","score":0,"lt":75},
 *    {"status":"fair","score":1,"gte":75,"lt":80},
 *    {"status":"good","score":2,"gte":80,"lt":85},
 *    {"status":"excellent","score":3,"gte":85}]
 *
 * Halfopen, altijd, als conventie van het schema en niet per regel. Dat
 * beantwoordt in één keer de drie randvragen die spec §6 open laat en die anders
 * 25 keer afzonderlijk beantwoord moeten worden:
 *
 *   "decide handling at exactly 1.0 cm"   -> ondergrens telt mee
 *   "Define exactly 60 degrees"           -> ondergrens telt mee
 *   "Define exactly 1.5x hand length"     -> ondergrens telt mee
 *
 * Waarom een array en geen lower_limit/upper_limit zoals spec §4 suggereert:
 * twee kolommen kunnen één drempel uitdrukken, maar een 0-3-schaal wordt dan
 * vier rijen zonder enige manier om af te dwingen dat die vier samen de hele
 * getallenlijn dekken. Juist die volledigheid is wat spec §10 bij ASH mist.
 */

export const BAND = z
  .object({
    status: z.string().min(1),
    score: z.number().int().min(0).max(3).nullable().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
  })
  // Een band zonder enige grens vangt alles af en maakt de rest onbereikbaar.
  .refine((b) => b.gte !== undefined || b.lt !== undefined, {
    message: "een band heeft minstens een gte of een lt",
  });

export const BANDS = z.array(BAND).min(1);

export type Band = z.infer<typeof BAND>;

/** Waarom er geen band is. Spiegelt de redenen die het scherm moet uitleggen. */
export type UnclassifiedReason =
  | "classification_disabled"
  | "outside_bands"
  | "not_measured";

export type Classification =
  | { readonly ok: true; readonly status: string; readonly score: number | null }
  | { readonly ok: false; readonly reason: UnclassifiedReason };

/** De regel zoals public.reference_rules hem oplevert, voor zover classificatie telt. */
export interface ClassifiableRule {
  readonly bands: Band[];
  readonly coverage: "total" | "gapped";
  readonly classificationEnabled: boolean;
}

function inBand(value: number, band: Band): boolean {
  if (band.gte !== undefined && value < band.gte) return false;
  if (band.lt !== undefined && value >= band.lt) return false;
  return true;
}

/**
 * De band waar deze waarde in valt, of null.
 *
 * Null is een echt antwoord en geen fout: bij een regel met gaten (ASH I/Y/T,
 * waar spec §6 letterlijk 150-180 ongedefinieerd laat) hoort een waarde in het
 * gat GEEN buurband te krijgen. Dichtstbijzijnde band kiezen zou van een gat in
 * de bron een stille aanname maken.
 */
export function matchBand(value: number, bands: readonly Band[]): Band | null {
  return bands.find((b) => inBand(value, b)) ?? null;
}

/**
 * Classificeert een waarde tegen een regel.
 *
 * De schakelaar classification_enabled gaat VOOR de banden. Spec §10 en §18
 * noemen een reeks tests waarvan de tekenconventie of de bandindeling niet
 * vaststaat (90-90 knee extension, Thomas, ASH I/Y/T). Die worden gemeten en
 * getrend, maar niet ingedeeld, tot de praktijk het protocol bevestigt. Dat is
 * een datawijziging op de regel en geen release.
 */
export function classify(
  value: number | null,
  rule: ClassifiableRule,
): Classification {
  if (value === null || !Number.isFinite(value)) {
    return { ok: false, reason: "not_measured" };
  }
  if (!rule.classificationEnabled) {
    return { ok: false, reason: "classification_disabled" };
  }
  const band = matchBand(value, rule.bands);
  if (!band) return { ok: false, reason: "outside_bands" };
  return { ok: true, status: band.status, score: band.score ?? null };
}

/**
 * Controleert een bandenreeks. Draait bij het laden van de seed en in CI.
 *
 * Dezelfde opzet als validateConditions() in lib/dossier/askWhen.ts, met
 * dezelfde motivatie: de faalwijze is stil. Overlappende banden leveren gewoon
 * de eerste op die past, en een gat levert 'unclassified' voor een deel van de
 * atleten zonder dat iemand ziet dat het aan de regel ligt.
 *
 * `coverage` is wat de seed BEWEERT. Deze functie controleert die bewering: wie
 * 'total' zegt en een gat laat, krijgt een fout en niet stilletijgend een regel
 * die een deel van de waarden niet indeelt.
 */
export function validateBands(
  bands: readonly Band[],
  coverage: "total" | "gapped",
): string[] {
  const errors: string[] = [];
  if (bands.length === 0) return ["bandenreeks is leeg"];

  // Precies één band mag onderaan open staan, en precies één bovenaan; anders is
  // de getallenlijn aan een kant niet gedekt of dubbel gedekt.
  if (bands.filter((b) => b.gte === undefined).length !== 1) {
    errors.push("er hoort precies een band zonder ondergrens te zijn");
  }
  if (bands.filter((b) => b.lt === undefined).length !== 1) {
    errors.push("er hoort precies een band zonder bovengrens te zijn");
  }

  for (const band of bands) {
    if (band.gte !== undefined && band.lt !== undefined && band.gte >= band.lt) {
      errors.push(`band '${band.status}': gte ${band.gte} ligt niet onder lt ${band.lt}`);
    }
  }

  // Oplopend op ondergrens, zodat 'de eerste die past' ook de bedoelde is.
  const sorted = [...bands].sort(
    (a, b) => (a.gte ?? Number.NEGATIVE_INFINITY) - (b.gte ?? Number.NEGATIVE_INFINITY),
  );
  if (sorted.some((b, i) => b !== bands[i])) {
    errors.push("banden horen oplopend op ondergrens te staan");
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const upper = sorted[i].lt;
    const nextLower = sorted[i + 1].gte;
    if (upper === undefined || nextLower === undefined) continue;
    if (upper > nextLower) {
      errors.push(
        `banden '${sorted[i].status}' en '${sorted[i + 1].status}' overlappen op ${nextLower}`,
      );
    } else if (upper < nextLower && coverage === "total") {
      errors.push(
        `gat tussen '${sorted[i].status}' en '${sorted[i + 1].status}' (${upper} tot ${nextLower}), ` +
          "maar de regel zegt coverage 'total'",
      );
    }
  }

  return errors;
}
