import { loadEnv } from "./env";
loadEnv();

import { Client } from "pg";

/**
 * Zet het wachtwoord van de rol intake_server voor lokale ontwikkeling.
 *
 * De rol wordt in een migratie aangemaakt zonder wachtwoord: dat hoort niet in
 * git. Lokaal willen we wel als die rol verbinden en niet als superuser, want
 * anders test je de rechten niet die in productie gelden.
 */
async function main() {
  const password = process.env.INTAKE_SERVER_PASSWORD;
  if (!password) throw new Error("INTAKE_SERVER_PASSWORD ontbreekt in .env.local");

  const admin = new Client({
    connectionString:
      process.env.SUPABASE_DB_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });

  await admin.connect();
  // Parameters kunnen niet in ALTER ROLE, dus quoten via de databank zelf.
  const quoted = await admin.query("select quote_literal($1) as value", [password]);
  await admin.query(`alter role intake_server password ${quoted.rows[0].value}`);
  await admin.end();

  console.log("wachtwoord voor intake_server gezet");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
