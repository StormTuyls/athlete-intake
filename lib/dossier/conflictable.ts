import type { FieldDataType } from "@/lib/types";

/**
 * Welke velden een conflict kunnen hebben, en welke niet.
 *
 * Dit onderscheid bleek nodig toen twee echte documenten van dezelfde atleet
 * door de pijplijn gingen. Er kwamen vier "conflicten" uit, waarvan er maar
 * één echt was:
 *
 *   biometrics.body_mass_kg      76,5 tegenover 77          -> echte tegenspraak
 *   identity.discipline          "100 en 200m" / "100m en 200m" -> notatie
 *   status.pain_location         "rechter hamstring" / "... proximaal" -> precisering
 *   medical.current_complaints   twee beschrijvingen van dezelfde klacht -> aanvulling
 *
 * Vrije tekst uit twee bronnen spreekt elkaar zelden tegen; die vult elkaar aan.
 * Zou elk tekstveld een conflict opleveren, dan krijgt de coach een scherm vol
 * vals alarm en kan een intake nooit ingediend worden, want conflicten
 * blokkeren goedkeuring. Dan is de functie sloopwerk in plaats van hulp.
 *
 * Dus: een conflict bestaat alleen waar twee waarden echt onverenigbaar zijn.
 */

/** Gestructureerde types: hier is verschil altijd tegenspraak. */
const CONFLICTABLE_TYPES: ReadonlySet<FieldDataType> = new Set([
  "number",
  "date",
  "boolean",
  "enum",
]);

/**
 * Korte tekst is normaal niet conflictgevoelig, met deze uitzonderingen. Bij
 * identiteit is verschil geen nuance maar een signaal: twee namen of twee
 * e-mailadressen in één dossier kan betekenen dat er een document van iemand
 * anders tussen zit. Dat wil een coach weten.
 */
const CONFLICTABLE_KEYS: ReadonlySet<string> = new Set([
  "identity.full_name",
  "identity.email",
  "identity.phone",
]);

export function isConflictable(fieldKey: string, dataType: FieldDataType): boolean {
  return CONFLICTABLE_TYPES.has(dataType) || CONFLICTABLE_KEYS.has(fieldKey);
}

/**
 * Bij niet-conflictgevoelige velden kiezen we de meest informatieve waarde.
 *
 * "rechter hamstring proximaal" zegt meer dan "rechter hamstring", en beide
 * kloppen. De kortere weggooien verliest niets: alle voorstellen blijven in
 * medical.field_proposals staan, dus het reviewscherm kan altijd tonen wat er in
 * welk document stond.
 */
export function mostInformative<T extends { value: unknown; id: number }>(
  candidates: T[],
): T {
  return candidates.reduce((best, candidate) => {
    const bestLength = String(best.value ?? "").trim().length;
    const candidateLength = String(candidate.value ?? "").trim().length;
    if (candidateLength > bestLength) return candidate;
    // Gelijke lengte: het meest recente voorstel wint.
    if (candidateLength === bestLength && candidate.id > best.id) return candidate;
    return best;
  });
}
