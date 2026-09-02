import { loadEnv } from "./env";
loadEnv();

import { notion } from "../lib/notion/client";
import { ATHLETES_DB, invoicesDb, tasksDb } from "../lib/notion/schema";

/**
 * Maakt de Notion-structuur voor de commerciele laag.
 *
 * Eenmalig. De databases zelf zijn geen migratie: Notion is hier een weergave,
 * geen bron van waarheid. Raakt de structuur kwijt, dan draai je dit opnieuw en
 * synchroniseert de volgende push alles terug uit Postgres.
 *
 *   npm run notion:setup -- <parent_page_id>
 *
 * De bovenliggende pagina moet met de integratie gedeeld zijn, anders ziet de
 * API hem niet en krijg je een object_not_found in plaats van een rechtenfout.
 */

interface CreatedPage {
  id: string;
  url: string;
}

async function main() {
  const parent = process.argv[2] ?? process.env.NOTION_PARENT_PAGE_ID;
  if (!parent) {
    throw new Error(
      "geef een parent page id mee: npm run notion:setup -- <page_id>",
    );
  }

  const container = await notion<CreatedPage>("/pages", {
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: parent },
      properties: {
        title: [{ type: "text", text: { content: "Atletenbegeleiding" } }],
      },
      children: [
        {
          object: "block",
          type: "callout",
          callout: {
            rich_text: [
              {
                type: "text",
                text: {
                  content:
                    "Commerciele laag van de atletenbegeleiding. Hier staan met opzet geen medische gegevens: die blijven in Postgres, achter autorisatie en een audit-spoor. Deze pagina wordt automatisch bijgewerkt vanuit het intakesysteem.",
                },
              },
            ],
            icon: { emoji: "🔒" },
          },
        },
      ],
    },
  });

  console.log(`container: ${container.id}`);

  const athletes = await notion<CreatedPage>("/databases", {
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: container.id },
      title: [{ type: "text", text: { content: ATHLETES_DB.title } }],
      description: [{ type: "text", text: { content: ATHLETES_DB.description } }],
      properties: ATHLETES_DB.properties,
    },
  });

  // Facturatie en opvolgacties hebben een relatie naar Atleten, dus die moet
  // eerst bestaan.
  const invoiceSpec = invoicesDb(athletes.id);
  const invoices = await notion<CreatedPage>("/databases", {
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: container.id },
      title: [{ type: "text", text: { content: invoiceSpec.title } }],
      description: [{ type: "text", text: { content: invoiceSpec.description } }],
      properties: invoiceSpec.properties,
    },
  });

  const taskSpec = tasksDb(athletes.id);
  const tasks = await notion<CreatedPage>("/databases", {
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: container.id },
      title: [{ type: "text", text: { content: taskSpec.title } }],
      description: [{ type: "text", text: { content: taskSpec.description } }],
      properties: taskSpec.properties,
    },
  });

  console.log("\nZet deze in .env.local:\n");
  console.log(`NOTION_PARENT_PAGE_ID=${container.id}`);
  console.log(`NOTION_ATHLETES_DB=${athletes.id}`);
  console.log(`NOTION_INVOICES_DB=${invoices.id}`);
  console.log(`NOTION_TASKS_DB=${tasks.id}`);
  console.log(`\nPagina: ${container.url}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
