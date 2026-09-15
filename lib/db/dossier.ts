import { appDb } from "@/lib/supabase/service";
import { addProposals, getProposals, saveDossier } from "@/lib/db/medical";
import { resolveDossier } from "@/lib/dossier/merge";
import {
  computeCompleteness,
  computeGaps,
  type Completeness,
  type Gap,
  type OutOfScope,
} from "@/lib/dossier/completeness";
import { parseAskWhen, validateConditions } from "@/lib/dossier/askWhen";
import { getSkippedFields } from "@/lib/db/medical";
import type { FieldDefinition, FieldTier, ResolvedField } from "@/lib/types";

export { addProposals, getProposals } from "@/lib/db/medical";

/**
 * De taxonomie staat in `public` en is geen medische data: labels en vragen
 * mogen door de coach in de browser gelezen worden.
 */
export async function getFieldDefinitions(): Promise<FieldDefinition[]> {
  const { data, error } = await appDb()
    .from("field_definitions")
    .select("*")
    .order("section")
    .order("sort_order");

  if (error) throw new Error(`velddefinities lezen mislukt: ${error.message}`);

  const definitions: FieldDefinition[] = (data ?? []).map((row) => ({
    key: row.key,
    section: row.section,
    sortOrder: row.sort_order,
    labelNl: row.label_nl,
    labelEn: row.label_en,
    dataType: row.data_type,
    required: row.required,
    isMedical: row.is_medical,
    enumOptions: row.enum_options,
    questionNl: row.question_nl,
    questionEn: row.question_en,
    tier: (row.tier ?? "standard") as FieldTier,
    askWhen: parseAskWhen(row.ask_when, row.key),
    fromProfile: Boolean(row.from_profile),
  }));

  // Eenmaal luid stuk bij het laden, in plaats van bij elke intake stil minder.
  //
  // Een voorwaarde die naar een niet-bestaand veld verwijst is voor altijd
  // onbekend, en onbekend is geen gat. Zonder deze controle verdwijnen de
  // afhankelijke vragen uit de intake van elke atleet zonder een enkele
  // foutmelding: er komt gewoon minder, en niemand merkt het. Zie
  // lib/dossier/askWhen.ts.
  validateConditions(definitions);

  return definitions;
}

export interface DossierState {
  definitions: FieldDefinition[];
  resolved: Map<string, ResolvedField>;
  gaps: Gap[];
  /** Wat deze intake niet vraagt, en waarom. Voor het scherm van de behandelaar. */
  outOfScope: OutOfScope[];
  completeness: Completeness;
}

/**
 * Herberekent het dossier uit alle voorstellen en schrijft het resultaat weg.
 *
 * medical.dossier_fields is dus een afgeleide, geen tweede waarheid. Verandert
 * de merge-regel, dan is een herberekening genoeg en is er geen migratie over
 * historische data nodig.
 *
 * Velden zonder enig voorstel krijgen expliciet status 'missing'. Dat lijkt
 * overbodig maar is het niet: "hierover is niets bekend" is een ander feit dan
 * "dit veld bestaat niet", en het rapport moet het eerste kunnen tonen.
 */
export async function syncDossier(
  intakeId: string,
  locale: "nl" | "en" = "nl",
): Promise<DossierState> {
  const [definitions, proposals, skipped] = await Promise.all([
    getFieldDefinitions(),
    getProposals(intakeId),
    getSkippedFields(intakeId),
  ]);

  const resolved = resolveDossier(definitions, proposals);
  await saveDossier(intakeId, [...resolved.values()]);

  // De gaten eerst, want daar komt uit wat buiten bereik valt, en de
  // volledigheid moet dat weten: een verplicht veld dat de bot nooit stelt kan
  // de atleet nooit vullen, en zou het indienen voor altijd blokkeren.
  const { gaps, outOfScope } = computeGaps(definitions, resolved, locale, skipped);
  const outOfScopeKeys = new Set(outOfScope.map((entry) => entry.fieldKey));

  return {
    definitions,
    resolved,
    gaps,
    outOfScope,
    completeness: computeCompleteness(definitions, resolved, outOfScopeKeys),
  };
}
