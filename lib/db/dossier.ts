import { appDb } from "@/lib/supabase/service";
import { addProposals, getProposals, saveDossier } from "@/lib/db/medical";
import { resolveDossier } from "@/lib/dossier/merge";
import {
  computeCompleteness,
  computeGaps,
  type Completeness,
  type Gap,
} from "@/lib/dossier/completeness";
import type { FieldDefinition, ResolvedField } from "@/lib/types";

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

  return (data ?? []).map((row) => ({
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
  }));
}

export interface DossierState {
  definitions: FieldDefinition[];
  resolved: Map<string, ResolvedField>;
  gaps: Gap[];
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
  const [definitions, proposals] = await Promise.all([
    getFieldDefinitions(),
    getProposals(intakeId),
  ]);

  const resolved = resolveDossier(definitions, proposals);
  await saveDossier(intakeId, [...resolved.values()]);

  return {
    definitions,
    resolved,
    gaps: computeGaps(definitions, resolved, locale),
    completeness: computeCompleteness(definitions, resolved),
  };
}
