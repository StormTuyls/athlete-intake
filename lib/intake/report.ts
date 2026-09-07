import { appDb } from "@/lib/supabase/service";
import { listDocuments } from "@/lib/db/medical";
import { getProposals, syncDossier } from "@/lib/db/dossier";
import { formatValue } from "@/lib/intake/format";
import { sectionLabel } from "@/lib/intake/copy";

/**
 * Het intakerapport zoals de ATLEET het ziet.
 *
 * Bewust niet hetzelfde als het coachrapport, en het verschil is één ding:
 * hier staan geen bronciteten. app/api/intake/state/route.ts strippt die al voor
 * de atleet, met de reden dat een letterlijk fragment uit een medisch verslag
 * teruglezen op een webpagina een gesprek is dat een behandelaar hoort te
 * voeren. Dat argument geldt hier net zo goed.
 *
 * Wat er wel staat is de bestandsnaam waar een waarde uit komt. Dat is geen
 * citaat maar wel precies wat een atleet nodig heeft om te zien of iets uit het
 * juiste document komt, en het is zijn eigen bestand.
 */

export interface ReportValue {
  fieldKey: string;
  label: string;
  value: string;
  required: boolean;
  /** Null als de atleet het zelf heeft opgegeven. */
  fromDocument: string | null;
  /** Waar als dit nog nagekeken moet worden: leeg terwijl het verplicht is, of tegenstrijdig. */
  needsAttention: boolean;
  reason: "missing" | "conflicting" | null;
}

export interface ReportSection {
  key: string;
  label: string;
  values: ReportValue[];
  filled: number;
  total: number;
}

export interface AthleteReport {
  intakeId: string;
  status: string;
  startedAt: string | null;
  submittedAt: string | null;
  sections: ReportSection[];
  documents: Array<{ filename: string; failed: boolean }>;
  requiredFilled: number;
  requiredTotal: number;
  attention: ReportValue[];
}

/** Null als deze intake niet van deze atleet is. Geen reden, geen verschil met "bestaat niet". */
export async function loadAthleteReport(input: {
  intakeId: string;
  athleteId: string;
}): Promise<AthleteReport | null> {
  const { data: intake } = await appDb()
    .from("intakes")
    .select("id, athlete_id, status, started_at, submitted_at, locale")
    .eq("id", input.intakeId)
    .maybeSingle();

  if (!intake || intake.athlete_id !== input.athleteId) return null;

  const locale = (intake.locale as "nl" | "en") ?? "en";
  const [state, proposals, documents] = await Promise.all([
    syncDossier(input.intakeId, locale),
    getProposals(input.intakeId),
    listDocuments(input.intakeId),
  ]);

  const proposalById = new Map(proposals.map((p) => [p.id, p]));
  const filenameById = new Map(documents.map((d) => [d.id, d.originalFilename]));

  const sections = new Map<string, ReportSection>();
  const attention: ReportValue[] = [];

  for (const definition of state.definitions) {
    // De consentvelden horen niet in dit overzicht: de atleet gaf die
    // toestemming bij het aanmaken van zijn account en bij het indienen, en ze
    // als "veld" tussen zijn lengte en zijn klachten zetten maakt ze onzichtbaar
    // in plaats van duidelijk.
    if (definition.key.startsWith("consent.")) continue;

    const resolved = state.resolved.get(definition.key);
    const winner =
      resolved?.winningProposalId === null || resolved?.winningProposalId === undefined
        ? undefined
        : proposalById.get(resolved.winningProposalId);

    const status = resolved?.status ?? "missing";
    const missing = status === "missing";
    const conflicting = status === "conflicting";

    const entry: ReportValue = {
      fieldKey: definition.key,
      label: locale === "nl" ? definition.labelNl : definition.labelEn,
      value: missing ? "" : formatValue(definition, resolved?.value ?? null),
      required: definition.required,
      fromDocument:
        winner?.sourceDocumentId ? (filenameById.get(winner.sourceDocumentId) ?? null) : null,
      needsAttention: conflicting || (missing && definition.required),
      reason: conflicting ? "conflicting" : missing ? "missing" : null,
    };

    if (entry.needsAttention) attention.push(entry);

    const existing = sections.get(definition.section);
    if (existing) {
      existing.values.push(entry);
      existing.total += 1;
      if (!missing && !conflicting) existing.filled += 1;
    } else {
      sections.set(definition.section, {
        key: definition.section,
        label: sectionLabel(definition.section),
        values: [entry],
        filled: !missing && !conflicting ? 1 : 0,
        total: 1,
      });
    }
  }

  return {
    intakeId: input.intakeId,
    status: intake.status as string,
    startedAt: (intake.started_at as string | null) ?? null,
    submittedAt: (intake.submitted_at as string | null) ?? null,
    sections: [...sections.values()],
    documents: documents.map((document) => ({
      filename: document.originalFilename,
      failed: Boolean(document.processingError),
    })),
    requiredFilled: state.completeness.requiredFilled,
    requiredTotal: state.completeness.requiredTotal,
    attention,
  };
}
