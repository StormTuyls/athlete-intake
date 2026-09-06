import { loadEnv } from "./env";
loadEnv();

import { notion } from "../lib/notion/client";
import { ATHLETES_DB, RETIRED_PROPERTIES } from "../lib/notion/schema";

/**
 * Brengt een bestaande Atleten-database op de huidige structuur.
 *
 * Notion voegt onbekende eigenschappen toe en laat bestaande staan, dus dit is
 * veilig om opnieuw te draaien.
 *
 * Met --prune verwijdert het ook de kolommen uit een eerdere versie. Dat wist de
 * inhoud van die kolommen, dus het staat achter een vlag en niet in de standaard.
 */
async function main() {
  const databaseId = process.argv[2] ?? process.env.NOTION_ATHLETES_DB;
  if (!databaseId) throw new Error("geef een database id mee of zet NOTION_ATHLETES_DB");

  const before = await notion<{ properties: Record<string, unknown> }>(
    `/databases/${databaseId}`,
  );
  const had = Object.keys(before.properties);

  const properties: Record<string, unknown> = { ...ATHLETES_DB.properties };

  if (process.argv.includes("--prune")) {
    for (const name of RETIRED_PROPERTIES) {
      if (had.includes(name)) properties[name] = null;
    }
  }

  const after = await notion<{ properties: Record<string, unknown> }>(
    `/databases/${databaseId}`,
    { method: "PATCH", body: { properties } },
  );
  const has = Object.keys(after.properties);

  const added = has.filter((key) => !had.includes(key));
  const removed = had.filter((key) => !has.includes(key));
  console.log(`${had.length} -> ${has.length} eigenschappen`);
  if (added.length > 0) console.log(`toegevoegd: ${added.sort().join(", ")}`);
  if (removed.length > 0) console.log(`verwijderd: ${removed.sort().join(", ")}`);
  if (removed.length === 0 && !process.argv.includes("--prune")) {
    console.log("(geef --prune mee om oude kolommen te verwijderen)");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
