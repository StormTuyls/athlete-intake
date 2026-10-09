import { logAudit } from "@/lib/audit";
import { query, queryOne, transaction } from "@/lib/db/sql";
import { BANDS, type Band } from "@/lib/screening/bands";
import type { Direction } from "@/lib/screening/direction";
import type { MetricSpec, ResultRow, Side } from "@/lib/screening/evaluate";
import type { HistoryPoint } from "@/lib/screening/baseline";
import type { Unit } from "@/lib/screening/units";

/**
 * Lezen en schrijven op de screeningstabellen.
 *
 * Spiegelt lib/db/medical.ts: directe pg-verbinding als intake_server, en elke
 * leesactie op medische data krijgt een expliciete logAudit(), want triggers
 * kunnen leesacties niet zien.
 *
 * Let op numeric: node-pg levert die als STRING, want een numeric past niet
 * altijd in een JS number. Dat wordt hier op de rand omgezet, net als
 * byteSize in lib/db/medical.ts, en niet globaal via een typeparser: dat zou
 * stil elke numerieke kolom raken die er ooit bij komt.
 */

/** De invoerwaarden van een asymmetrierij; null voor alles wat er geen heeft. */
function readSides(
  value: unknown,
): { left?: number | null; right?: number | null; previous?: number | null } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if ("left" in raw || "right" in raw) {
    return { left: num(raw.left), right: num(raw.right) };
  }
  if ("previous" in raw) return { previous: num(raw.previous) };
  return null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface LibraryTest {
  testKey: string;
  block: string;
  sortOrder: number;
  labelNl: string;
  labelEn: string;
  laterality: "bilateral" | "per_side" | "either";
  protocolId: string;
  protocolConfirmed: boolean;
  metricKey: string;
  metricLabelNl: string;
  metricLabelEn: string;
  unit: Unit;
  direction: Direction;
  decimals: number;
  /** Null als er geen regel is, of de regel geen banden mag toepassen. */
  rule: { id: number; layer: "published" | "internal_target"; bands: Band[];
          coverage: "total" | "gapped"; classificationEnabled: boolean } | null;
  ruleNote: string | null;
}

/**
 * De actieve bibliotheek: per test de huidige protocolversie, zijn metriek en de
 * geldende referentieregel.
 *
 * Alleen niet-uitgefaseerde rijen. Een test zonder actief protocol hoort niet in
 * een invoerscherm, want er is niets om de meting aan te hangen.
 *
 * Geen audit: public.test_definitions en vrienden zijn geen patientgegeven.
 */
export async function getLibrary(): Promise<LibraryTest[]> {
  const rows = await query<Record<string, unknown>>(
    `select t.key as test_key, t.block, t.sort_order, t.label_nl, t.label_en,
            t.laterality,
            p.id as protocol_id, p.protocol_confirmed,
            m.key as metric_key, m.label_nl as metric_label_nl,
            m.label_en as metric_label_en, m.unit, m.direction, m.decimals,
            r.id as rule_id, r.layer, r.bands, r.coverage,
            r.classification_enabled, r.source_note
       from public.test_definitions t
       join public.test_protocols p
         on p.test_key = t.key and p.retired_at is null
       join public.metric_definitions m
         on m.test_key = t.key
       left join public.reference_rules r
         on r.metric_key = m.key and r.retired_at is null
      where t.retired_at is null
      order by t.block, t.sort_order, m.sort_order`,
  );

  return rows.map((row) => {
    // bands komt als jsonb terug en wordt door hetzelfde schema gehaald als bij
    // het seeden. Een rij die de praktijk met de hand aanpaste en die niet meer
    // klopt, hoort hier te stranden en niet pas bij het classificeren.
    const parsed = row.bands ? BANDS.safeParse(row.bands) : null;

    return {
      testKey: row.test_key as string,
      block: row.block as string,
      sortOrder: Number(row.sort_order),
      labelNl: row.label_nl as string,
      labelEn: row.label_en as string,
      laterality: row.laterality as LibraryTest["laterality"],
      protocolId: row.protocol_id as string,
      protocolConfirmed: row.protocol_confirmed as boolean,
      metricKey: row.metric_key as string,
      metricLabelNl: row.metric_label_nl as string,
      metricLabelEn: row.metric_label_en as string,
      unit: row.unit as Unit,
      direction: row.direction as Direction,
      decimals: Number(row.decimals),
      rule:
        parsed?.success && row.rule_id !== null
          ? {
              id: Number(row.rule_id),
              layer: row.layer as "published" | "internal_target",
              bands: parsed.data,
              coverage: row.coverage as "total" | "gapped",
              classificationEnabled: row.classification_enabled as boolean,
            }
          : null,
      ruleNote: (row.source_note as string | null) ?? null,
    };
  });
}

/** De bibliotheek als specs voor de rekenmotor. */
export function toSpecs(library: readonly LibraryTest[]): Map<string, MetricSpec> {
  return new Map(
    library.map((t) => [
      t.metricKey,
      {
        key: t.metricKey,
        unit: t.unit,
        direction: t.direction,
        perSide: t.laterality === "per_side",
        rule: t.rule,
      },
    ]),
  );
}

/**
 * Eerdere metingen van deze atleet, per metriek EN per zijde. Spec §5 laag 1.
 *
 * De protocolversie reist mee en wordt NIET hier gefilterd: lib/screening/
 * baseline.ts doet dat, en die kent ook het verschil tussen "geen historie" en
 * "historie onder een ander protocol". Zou deze query al filteren, dan ziet de
 * motor dat tweede geval als leeg en verdwijnt de protocolwissel uit beeld.
 *
 * Alleen metingen met een waarde: een eerdere sessie waarin deze test niet
 * gemeten is, is geen baseline.
 */
export function historyKey(metricKey: string, side: string): string {
  return `${metricKey}|${side}`;
}

export async function getHistory(
  athleteId: string,
  metricKeys: readonly string[],
): Promise<Map<string, HistoryPoint[]>> {
  const history = new Map<string, HistoryPoint[]>();
  if (metricKeys.length === 0) return history;

  const rows = await query<Record<string, unknown>>(
    `select me.metric_key, ti.side, ti.protocol_id, s.occurred_at, me.value
       from medical.measurements me
       join medical.test_items ti on ti.id = me.test_item_id
       join medical.screening_sessions s on s.id = ti.session_id
      where s.athlete_id = $1
        and me.metric_key = any($2)
        and me.value is not null
      order by s.occurred_at`,
    [athleteId, metricKeys],
  );

  for (const row of rows) {
    // Per metriek EN per zijde. Zonder de zijde vergelijkt een linkerknie met
    // de vorige rechterknie zodra die toevallig als laatste is ingevoerd, en
    // dat levert een plausibel percentage op dat nergens over gaat.
    const key = historyKey(row.metric_key as string, row.side as string);
    const list = history.get(key) ?? [];
    list.push({
      occurredAt: (row.occurred_at as Date).toISOString(),
      protocolId: row.protocol_id as string,
      value: Number(row.value),
    });
    history.set(key, list);
  }

  return history;
}

export interface NewSession {
  athleteId: string;
  occurredOn: string;
  testerProfileId: string | null;
  bodyMassKg: number | null;
  notes: string | null;
  entries: Array<{
    protocolId: string;
    metricKey: string;
    side: Side;
    value: number | null;
  }>;
}

/**
 * Slaat een screening op en berekent de uitkomsten in dezelfde transactie.
 *
 * Alles of niets: een sessie met metingen maar zonder uitkomsten zou een scherm
 * opleveren waar de waarden wel staan en de banden niet, en dat is niet van een
 * nog-niet-doorgerekende sessie te onderscheiden.
 */
export async function createSession(
  input: NewSession,
  results: readonly ResultRow[],
  actor: { id: string | null },
): Promise<string> {
  const sessionId = await transaction(async (run) => {
    const session = await run<{ id: string }>(
      // occurred_at volgt de GEMETEN datum en niet now(). Een behandelaar die de
      // screening van vorige maand vandaag invoert, hoort hem in de tijdlijn op
      // vorige maand te zien staan; met now() sorteert de tijdlijn op
      // invoervolgorde en vergelijkt laag 1 tegen de verkeerde vorige sessie.
      //
      // Wanneer hij is INGEVOERD staat in created_at. Dat zijn twee vragen en
      // dus twee kolommen. Spec §12.1 vraagt de lokale testtijd te bewaren; het
      // formulier geeft alleen een datum, dus dat is wat er staat.
      `insert into medical.screening_sessions
         (athlete_id, occurred_at, occurred_on, tester_profile_id, body_mass_kg,
          notes, created_by, source_system)
       values ($1, $2::date, $2, $3, $4, $5, $6, 'manual')
       returning id`,
      [input.athleteId, input.occurredOn, input.testerProfileId,
       input.bodyMassKg, input.notes, actor.id],
    );
    const id = session[0].id;

    // Een test_item per (protocol, zijde). De meting hangt daaraan, niet aan de
    // sessie: zonder dat niveau is er geen protocolversie bij de waarde.
    const itemIds = new Map<string, string>();
    for (const entry of input.entries) {
      const key = `${entry.protocolId}|${entry.side}`;
      if (itemIds.has(key)) continue;
      const item = await run<{ id: string }>(
        `insert into medical.test_items (session_id, protocol_id, side)
         values ($1, $2, $3) returning id`,
        [id, entry.protocolId, entry.side],
      );
      itemIds.set(key, item[0].id);
    }

    for (const entry of input.entries) {
      const itemId = itemIds.get(`${entry.protocolId}|${entry.side}`)!;
      await run(
        `insert into medical.measurements
           (test_item_id, metric_key, value, entered_directly, entered_by)
         values ($1, $2, $3, true, $4)`,
        [itemId, entry.metricKey, entry.value, actor.id],
      );
    }

    for (const r of results) {
      // Asymmetrie hoort bij geen van beide zijden en dus bij geen item. De
      // ruwe waarde en de verandering tegenover de vorige sessie wel: zonder
      // dat zouden links en rechts op dezelfde rij uitkomen, want de unieke
      // index loopt over (sessie, item, metriek, soort).
      const itemId =
        r.kind === "asymmetry"
          ? null
          : (itemIds.get(
              `${input.entries.find((e) => e.metricKey === r.metricKey && e.side === r.side)?.protocolId}|${r.side}`,
            ) ?? null);

      await run(
        `insert into medical.derived_results
           (session_id, test_item_id, metric_key, value, unit, status,
            unavailable_reason, derived_key, derived_version, engine_version,
            reference_rule_id, reference_layer, band_status, band_score, inputs)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)`,
        [id, itemId, r.metricKey, r.value, r.unit, r.status, r.unavailableReason,
         r.derivedKey, r.derivedVersion, r.engineVersion, r.referenceRuleId,
         r.referenceLayer, r.bandStatus, r.bandScore, JSON.stringify(r.inputs)],
      );
    }

    return id;
  });

  await logAudit({
    actorId: actor.id,
    actorKind: "coach",
    action: "insert",
    entitySchema: "medical",
    entityTable: "screening_sessions",
    entityId: sessionId,
    detail: { entries: input.entries.length, results: results.length },
  });

  return sessionId;
}

export interface SessionView {
  id: string;
  athleteId: string;
  athleteName: string | null;
  occurredOn: string;
  bodyMassKg: number | null;
  notes: string | null;
  results: Array<{
    metricKey: string;
    testLabelNl: string;
    testLabelEn: string;
    metricLabelNl: string;
    metricLabelEn: string;
    block: string;
    side: Side;
    kind: "absolute" | "asymmetry" | "delta";
    value: number | null;
    unit: string;
    decimals: number;
    status: string;
    unavailableReason: string | null;
    bandStatus: string | null;
    bandScore: number | null;
    /** Bij asymmetrie: links en rechts, zodat §11's "toon teller en noemer" kan. */
    inputs: {
      left?: number | null;
      right?: number | null;
      previous?: number | null;
    } | null;
    protocolConfirmed: boolean;
    /** Herkomst van de regel die deze band gaf, of uitlegt waarom er geen is. FR-08. */
    ruleNote: string | null;
    ruleSource: string | null;
    ruleEvidence: string | null;
  }>;
}

export async function getSession(
  sessionId: string,
  actor: { id: string | null },
): Promise<SessionView | null> {
  const head = await queryOne<Record<string, unknown>>(
    `select s.id, s.athlete_id, s.occurred_on, s.body_mass_kg, s.notes, a.full_name
       from medical.screening_sessions s
       join public.athletes a on a.id = s.athlete_id
      where s.id = $1`,
    [sessionId],
  );
  if (!head) return null;

  const rows = await query<Record<string, unknown>>(
    // De zijde staat op test_items en niet op derived_results: een uitkomst
    // hangt aan een test in een protocolversie, en een asymmetrie hangt aan geen
    // van beide zijden (dan is test_item_id null).
    `select d.metric_key, ti.side, d.derived_key, d.value, d.unit, d.status,
            d.unavailable_reason, d.band_status, d.band_score, d.inputs,
            m.label_nl as metric_label_nl, m.label_en as metric_label_en, m.decimals,
            t.label_nl as test_label_nl, t.label_en as test_label_en,
            t.block, t.sort_order,
            p.protocol_confirmed, r.source_note, r.source_citation, r.evidence
       from medical.derived_results d
       left join medical.test_items ti on ti.id = d.test_item_id
       join public.metric_definitions m on m.key = d.metric_key
       join public.test_definitions t on t.key = m.test_key
       join public.test_protocols p on p.test_key = t.key and p.retired_at is null
       -- Ook koppelen als er geen band uitkwam: dan is juist de noot het
       -- antwoord op "waarom staat hier niets". Vandaar op de metriek en niet
       -- op reference_rule_id, dat bij een uitgezette regel null is.
       left join public.reference_rules r
         on r.metric_key = d.metric_key and r.retired_at is null
      where d.session_id = $1
      order by t.block, t.sort_order, d.derived_key nulls first, ti.side`,
    [sessionId],
  );

  await logAudit({
    actorId: actor.id,
    actorKind: "coach",
    action: "read",
    entitySchema: "medical",
    entityTable: "screening_sessions",
    entityId: sessionId,
    detail: { results: rows.length },
  });

  return {
    id: head.id as string,
    athleteId: head.athlete_id as string,
    athleteName: (head.full_name as string | null) ?? null,
    occurredOn: head.occurred_on as string,
    bodyMassKg: num(head.body_mass_kg),
    notes: (head.notes as string | null) ?? null,
    results: rows.map((row) => ({
      metricKey: row.metric_key as string,
      testLabelNl: row.test_label_nl as string,
      testLabelEn: row.test_label_en as string,
      metricLabelNl: row.metric_label_nl as string,
      metricLabelEn: row.metric_label_en as string,
      block: row.block as string,
      side: (row.side as Side | null) ?? "bilateral",
      // Geen eigen kolom: derived_key zegt welke soort uitkomst dit is, en
      // null betekent de ruwe waarde zelf.
      kind:
        row.derived_key === null
          ? "absolute"
          : row.derived_key === "asymmetry"
            ? "asymmetry"
            : "delta",
      value: num(row.value),
      unit: row.unit as string,
      decimals: Number(row.decimals),
      status: row.status as string,
      unavailableReason: (row.unavailable_reason as string | null) ?? null,
      bandStatus: (row.band_status as string | null) ?? null,
      bandScore: row.band_score === null ? null : Number(row.band_score),
      inputs: readSides(row.inputs),
      protocolConfirmed: row.protocol_confirmed as boolean,
      ruleNote: (row.source_note as string | null) ?? null,
      ruleSource: (row.source_citation as string | null) ?? null,
      ruleEvidence: (row.evidence as string | null) ?? null,
    })),
  };
}

/** Screenings van een atleet, nieuwste eerst. Voor de atleetpagina. */
export async function listSessions(
  athleteId: string,
  actor: { id: string | null },
): Promise<Array<{ id: string; occurredOn: string; measurements: number }>> {
  const rows = await query<Record<string, unknown>>(
    `select s.id, s.occurred_on,
            (select count(*) from medical.measurements me
               join medical.test_items ti on ti.id = me.test_item_id
              where ti.session_id = s.id) as measurements
       from medical.screening_sessions s
      where s.athlete_id = $1
      order by s.occurred_at desc`,
    [athleteId],
  );

  await logAudit({
    actorId: actor.id,
    actorKind: "coach",
    action: "read",
    entitySchema: "medical",
    entityTable: "screening_sessions",
    entityId: athleteId,
    detail: { sessions: rows.length },
  });

  return rows.map((row) => ({
    id: row.id as string,
    occurredOn: row.occurred_on as string,
    measurements: Number(row.measurements),
  }));
}
