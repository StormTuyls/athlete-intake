import { loadEnv } from "./env";
loadEnv();

import { Client } from "pg";
import { LIBRARY, validateLibrary } from "../lib/screening/library";

/**
 * Seedt de screeningsbibliotheek uit lib/screening/library.ts.
 *
 * Waarom een script en niet supabase/seed.sql: de bibliotheek is getypeerde TS
 * met een validator eroverheen (zie validateLibrary), en die controle hoort voor
 * de insert te draaien en niet erna. Hetzelfde patroon als scripts/db-local.ts,
 * dat `npm run db:reset` al na de migraties aanroept.
 *
 * Idempotent, met een belangrijk verschil per tabel:
 *
 *   tests en metrieken  worden bijgewerkt. Een label corrigeren mag.
 *   protocollen         do nothing. De trigger protocols_immutable weigert een
 *                       update sowieso: een herziening is version + 1.
 *   referentieregels    do nothing, om dezelfde reden. Een gewijzigde afkapwaarde
 *                       is een nieuwe versie, anders verandert met terugwerkende
 *                       kracht hoe oude metingen ingedeeld waren.
 */
async function main() {
  const problems = validateLibrary();
  if (problems.length > 0) {
    console.error("de bibliotheek klopt niet, er is niets geseed:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const db = new Client({
    connectionString:
      process.env.SUPABASE_DB_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await db.connect();

  try {
    await db.query("begin");

    for (const t of LIBRARY.tests) {
      await db.query(
        `insert into public.test_definitions
           (key, block, sort_order, label_nl, label_en, laterality, body_region, source_note)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (key) do update set
           block = excluded.block,
           sort_order = excluded.sort_order,
           label_nl = excluded.label_nl,
           label_en = excluded.label_en,
           laterality = excluded.laterality,
           body_region = excluded.body_region,
           source_note = excluded.source_note`,
        [t.key, t.block, t.sortOrder, t.labelNl, t.labelEn, t.laterality,
         t.bodyRegion ?? null, t.sourceNote ?? null],
      );
    }

    for (const p of LIBRARY.protocols) {
      await db.query(
        `insert into public.test_protocols
           (test_key, version, label_nl, label_en, device, body_position,
            trial_count, trial_selection, protocol_confirmed, protocol_source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (test_key, version) do nothing`,
        [p.testKey, p.version, p.labelNl, p.labelEn, p.device ?? null,
         p.bodyPosition ?? null, p.trialCount ?? null, p.trialSelection,
         p.protocolConfirmed, p.protocolSource ?? null],
      );
    }

    for (const m of LIBRARY.metrics) {
      await db.query(
        `insert into public.metric_definitions
           (key, test_key, kind, label_nl, label_en, unit, direction, is_core, decimals)
         values ($1, $2, 'raw', $3, $4, $5, $6, $7, $8)
         on conflict (key) do update set
           test_key = excluded.test_key,
           label_nl = excluded.label_nl,
           label_en = excluded.label_en,
           unit = excluded.unit,
           direction = excluded.direction,
           is_core = excluded.is_core,
           decimals = excluded.decimals`,
        [m.key, m.testKey, m.labelNl, m.labelEn, m.unit, m.direction, m.isCore, m.decimals],
      );
    }

    for (const r of LIBRARY.rules) {
      await db.query(
        `insert into public.reference_rules
           (rule_key, version, metric_key, layer, bands, coverage,
            classification_enabled, evidence, source_citation, source_note)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
         on conflict (rule_key, version) do nothing`,
        [r.ruleKey, r.version, r.metricKey, r.layer, JSON.stringify(r.bands),
         r.coverage, r.classificationEnabled, r.evidence,
         r.sourceCitation ?? null, r.sourceNote ?? null],
      );
    }

    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }

  const classifying = LIBRARY.rules.filter((r) => r.classificationEnabled).length;
  console.log(
    `screening geseed: ${LIBRARY.tests.length} tests, ${LIBRARY.protocols.length} protocollen, ` +
      `${LIBRARY.metrics.length} metrieken, ${LIBRARY.rules.length} regels ` +
      `(${classifying} classificeren, ${LIBRARY.rules.length - classifying} wachten op protocolbevestiging)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
