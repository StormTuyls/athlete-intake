import assert from "node:assert/strict";
import { loadEnv } from "../../scripts/env";
loadEnv();

import { query } from "../../lib/db/sql";

/**
 * Regressietest voor het verschil tussen jsonb 'null' en SQL NULL.
 *
 * JSON.stringify(null) geeft de string "null" en dat is een geldige
 * jsonb-waarde. Een kolom die zo gevuld wordt is niet leeg, en elke check die
 * `value is null` gebruikt laat het stil passeren of slaat onterecht toe.
 */
const rows = await query<{ sql_null: boolean; jsonb_null: boolean }>(
  `select ($1::jsonb is null) as sql_null, ($2::jsonb is null) as jsonb_null`,
  [null, JSON.stringify(null)],
);

assert.equal(rows[0].sql_null, true, "SQL NULL hoort null te zijn");
assert.equal(
  rows[0].jsonb_null,
  false,
  "jsonb 'null' is NIET SQL NULL: daarom bestaat toJsonb()",
);

console.log("jsonb-null: onderscheid bevestigd");
process.exit(0);
