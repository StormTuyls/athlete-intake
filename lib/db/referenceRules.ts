import { logAudit } from "@/lib/audit";
import { query, queryOne, transaction } from "@/lib/db/sql";
import { BANDS, type Band, validateBands } from "@/lib/screening/bands";

/**
 * De referentieregels beheren. FR-02.
 *
 * Twee handelingen, en het verschil tussen de twee is de hele reden dat dit
 * bestand bestaat.
 *
 *   CLASSIFICATIE AAN/UIT is een update. De drempels veranderen niet; alleen de
 *   vraag of ze gebruikt mogen worden. Dat is precies het geval uit spec §18:
 *   de praktijk bevestigt het protocol van de 90-90 en de regel mag voortaan
 *   indelen. Historische uitkomsten veranderen niet mee, want die staan
 *   gematerialiseerd in medical.derived_results.
 *
 *   ANDERE DREMPELS is een nieuwe VERSIE. Een bestaande regel bijwerken zou met
 *   terugwerkende kracht veranderen wat "good" betekende toen een rapport werd
 *   goedgekeurd. De oude versie wordt uitgefaseerd, de nieuwe krijgt version + 1,
 *   en oude uitkomsten blijven naar de regel wijzen waaronder ze beoordeeld zijn.
 */

export interface RuleView {
  id: number;
  ruleKey: string;
  version: number;
  metricKey: string;
  testLabelNl: string;
  testLabelEn: string;
  block: string;
  unit: string;
  direction: string;
  decimals: number;
  layer: string;
  bands: Band[];
  coverage: "total" | "gapped";
  classificationEnabled: boolean;
  evidence: string;
  sourceCitation: string | null;
  sourceNote: string | null;
  protocolConfirmed: boolean;
  /** Hoeveel versies deze regel al gehad heeft. */
  versions: number;
}

function toView(row: Record<string, unknown>): RuleView | null {
  const parsed = BANDS.safeParse(row.bands);
  if (!parsed.success) return null;
  return {
    id: Number(row.id),
    ruleKey: row.rule_key as string,
    version: Number(row.version),
    metricKey: row.metric_key as string,
    testLabelNl: row.test_label_nl as string,
    testLabelEn: row.test_label_en as string,
    block: row.block as string,
    unit: row.unit as string,
    direction: row.direction as string,
    decimals: Number(row.decimals),
    layer: row.layer as string,
    bands: parsed.data,
    coverage: row.coverage as "total" | "gapped",
    classificationEnabled: row.classification_enabled as boolean,
    evidence: row.evidence as string,
    sourceCitation: (row.source_citation as string | null) ?? null,
    sourceNote: (row.source_note as string | null) ?? null,
    protocolConfirmed: row.protocol_confirmed as boolean,
    versions: Number(row.versions),
  };
}

const SELECT = `
  select r.id, r.rule_key, r.version, r.metric_key, r.layer, r.bands, r.coverage,
         r.classification_enabled, r.evidence, r.source_citation, r.source_note,
         m.unit, m.direction, m.decimals,
         t.label_nl as test_label_nl, t.label_en as test_label_en, t.block, t.sort_order,
         p.protocol_confirmed,
         (select count(*) from public.reference_rules v where v.rule_key = r.rule_key) as versions
    from public.reference_rules r
    join public.metric_definitions m on m.key = r.metric_key
    join public.test_definitions t on t.key = m.test_key
    join public.test_protocols p on p.test_key = t.key and p.retired_at is null`;

/** De geldende regels, een per metriek. Geen audit: dit is taxonomie. */
export async function listRules(): Promise<RuleView[]> {
  const rows = await query<Record<string, unknown>>(
    `${SELECT} where r.retired_at is null order by t.block, t.sort_order, r.metric_key`,
  );
  return rows.map(toView).filter((r): r is RuleView => r !== null);
}

export async function getRule(metricKey: string): Promise<RuleView | null> {
  const row = await queryOne<Record<string, unknown>>(
    `${SELECT} where r.metric_key = $1 and r.retired_at is null`,
    [metricKey],
  );
  return row ? toView(row) : null;
}

/** De oudere versies, nieuwste eerst. De geschiedenis van een drempel. */
export async function getRuleHistory(
  ruleKey: string,
): Promise<Array<{ version: number; bands: Band[]; retiredAt: string | null; sourceCitation: string | null }>> {
  const rows = await query<Record<string, unknown>>(
    `select version, bands, retired_at, source_citation
       from public.reference_rules where rule_key = $1 order by version desc`,
    [ruleKey],
  );
  return rows.map((row) => ({
    version: Number(row.version),
    bands: (BANDS.safeParse(row.bands).data ?? []) as Band[],
    retiredAt: row.retired_at ? (row.retired_at as Date).toISOString() : null,
    sourceCitation: (row.source_citation as string | null) ?? null,
  }));
}

/**
 * Classificatie aan of uit. Een update, geen nieuwe versie.
 *
 * De databank houdt hier nog een slot op: reference_rules_gapped_cannot_classify
 * weigert aanzetten zolang de bandenreeks gaten heeft, en
 * reference_rules_unverified... bestaat niet meer, maar de gaten-regel wel.
 */
export async function setClassification(
  ruleId: number,
  enabled: boolean,
  actor: { id: string | null; isAdmin: boolean },
): Promise<void> {
  await query(
    "update public.reference_rules set classification_enabled = $2 where id = $1",
    [ruleId, enabled],
  );
  await logAudit({
    actorId: actor.id,
    actorKind: actor.isAdmin ? "admin" : "coach",
    action: "update",
    entitySchema: "public",
    entityTable: "reference_rules",
    entityId: String(ruleId),
    detail: { classificationEnabled: enabled },
  });
}

export interface NewVersion {
  metricKey: string;
  bands: Band[];
  coverage: "total" | "gapped";
  classificationEnabled: boolean;
  evidence: "source_sheet" | "published" | "internal";
  sourceCitation: string | null;
  sourceNote: string | null;
}

/** Wat er mis is met deze invoer, in de taal van de invoerder. Leeg is goed. */
export function checkVersion(input: NewVersion): string[] {
  const problems = validateBands(input.bands, input.coverage);
  if (input.evidence === "published" && !input.sourceCitation?.trim()) {
    problems.push("a published reference needs a citation");
  }
  if (input.coverage === "gapped" && input.classificationEnabled) {
    problems.push("a band set with gaps cannot classify");
  }
  return problems;
}

/**
 * Een nieuwe versie van de regel voor deze metriek.
 *
 * Oude uitfaseren en nieuwe aanmaken in EEN transactie: de partiele unieke
 * index laat maar een actieve regel per metriek toe, dus halverwege stoppen
 * levert ofwel geen geldende regel op, ofwel een mislukte insert.
 */
export async function addVersion(
  input: NewVersion,
  actor: { id: string | null; isAdmin: boolean },
): Promise<number> {
  const id = await transaction(async (run) => {
    const current = await run<{ id: number; rule_key: string; version: number }>(
      `select id, rule_key, version from public.reference_rules
        where metric_key = $1 and retired_at is null`,
      [input.metricKey],
    );

    const ruleKey = current[0]?.rule_key ?? `practice.${input.metricKey}`;
    const next = current[0] ? current[0].version + 1 : 1;

    if (current[0]) {
      await run("update public.reference_rules set retired_at = now() where id = $1", [
        current[0].id,
      ]);
    }

    const created = await run<{ id: number }>(
      `insert into public.reference_rules
         (rule_key, version, metric_key, layer, bands, coverage,
          classification_enabled, evidence, source_citation, source_note)
       values ($1, $2, $3, 'published', $4::jsonb, $5, $6, $7, $8, $9)
       returning id`,
      [ruleKey, next, input.metricKey, JSON.stringify(input.bands), input.coverage,
       input.classificationEnabled, input.evidence,
       input.sourceCitation, input.sourceNote],
    );
    return created[0].id;
  });

  await logAudit({
    actorId: actor.id,
    actorKind: actor.isAdmin ? "admin" : "coach",
    action: "insert",
    entitySchema: "public",
    entityTable: "reference_rules",
    entityId: String(id),
    detail: { metricKey: input.metricKey, bands: input.bands.length },
  });

  return id;
}
