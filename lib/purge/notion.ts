import { notion, isConfigured, NotionError } from "@/lib/notion/client";

/**
 * De atleetkaart uit de Notion-werkomgeving halen.
 *
 * Belangrijk, en dit hoort ook in de overdracht aan de klant: Notion kent geen
 * hard verwijderen via de API. `archived: true` zet een pagina in de prullenbak
 * van de werkruimte, waar een beheerder hem terug kan halen tot Notion hem
 * opruimt. "Verwijderd uit Notion" is dus niet iets wat dit systeem kan beweren.
 *
 * Daarom in deze volgorde: eerst de inhoud weg (de blokken op de pagina, waar de
 * klinische samenvatting staat), dan de identificerende eigenschappen leegmaken,
 * en pas dan archiveren. Wat er in de prullenbak belandt is dan een lege kaart
 * en geen dossier met een naam erop. Alleen archiveren zou een kaart met naam,
 * e-mail, telefoon en samenvatting laten staan op een plek waar niemand meer
 * kijkt, en dat is de slechtste van beide werelden.
 *
 * Facturatie- en opvolgkaarten hangen via de relatie "Atleet" aan de
 * atleetkaart. Die gaan mee, want een factuurregel met de naam van een
 * verwijderde atleet is nog steeds die naam.
 */

export interface NotionPurgeResult {
  /** Niet geconfigureerd: dan is er ook niets om op te ruimen. */
  skipped: boolean;
  pagesBlanked: number;
  pagesArchived: number;
  relatedArchived: number;
  note: string;
}

interface QueryResult {
  results: Array<{ id: string }>;
}

/** Alle blokken van een pagina weghalen: dat is waar de samenvatting staat. */
async function deleteBlocks(pageId: string): Promise<void> {
  const blocks = await notion<{ results: Array<{ id: string }> }>(
    `/blocks/${pageId}/children?page_size=100`,
  );
  for (const block of blocks.results) {
    await notion(`/blocks/${block.id}`, { method: "DELETE" });
  }
}

/**
 * De eigenschappen leegmaken. Een title kan niet null zijn, dus die wordt een
 * neutrale tekst; de rest gaat wel echt op null.
 */
async function blankProperties(pageId: string): Promise<void> {
  await notion(`/pages/${pageId}`, {
    method: "PATCH",
    body: {
      properties: {
        Naam: { title: [{ text: { content: "verwijderd op verzoek" } }] },
        Geboortedatum: { date: null },
        Discipline: { rich_text: [] },
        Club: { rich_text: [] },
        "E-mail": { email: null },
        Telefoon: { phone_number: null },
        Trainbaarheid: { select: null },
        Doelwedstrijd: { rich_text: [] },
        "Trainingsvolume per week": { number: null },
        "Intake ID": { rich_text: [] },
        Dossier: { url: null },
      },
    },
  });
}

async function archive(pageId: string): Promise<void> {
  await notion(`/pages/${pageId}`, { method: "PATCH", body: { archived: true } });
}

async function relatedPages(
  databaseId: string | undefined,
  athletePageId: string,
): Promise<string[]> {
  if (!databaseId) return [];

  const found = await notion<QueryResult>(`/databases/${databaseId}/query`, {
    method: "POST",
    body: {
      filter: { property: "Atleet", relation: { contains: athletePageId } },
      page_size: 100,
    },
  });

  return found.results.map((page) => page.id);
}

export async function purgeNotion(input: {
  intakeIds: string[];
}): Promise<NotionPurgeResult> {
  const note =
    "Notion kent geen hard verwijderen via de API: de kaart is leeggemaakt en gearchiveerd naar de prullenbak van de werkruimte.";

  if (!isConfigured() || !process.env.NOTION_ATHLETES_DB) {
    return {
      skipped: true,
      pagesBlanked: 0,
      pagesArchived: 0,
      relatedArchived: 0,
      note: "Notion is niet geconfigureerd, dus er stond niets.",
    };
  }

  const athletesDb = process.env.NOTION_ATHLETES_DB;
  let pagesBlanked = 0;
  let pagesArchived = 0;
  let relatedArchived = 0;

  for (const intakeId of input.intakeIds) {
    const found = await notion<QueryResult>(`/databases/${athletesDb}/query`, {
      method: "POST",
      body: {
        filter: { property: "Intake ID", rich_text: { equals: intakeId } },
        page_size: 10,
      },
    });

    for (const page of found.results) {
      // Eerst het gerelateerde werk, want daarna is de relatie niet meer te
      // volgen: een gearchiveerde atleetkaart komt niet terug uit een query.
      for (const related of [
        ...(await relatedPages(process.env.NOTION_TASKS_DB, page.id)),
        ...(await relatedPages(process.env.NOTION_INVOICES_DB, page.id)),
      ]) {
        await archive(related);
        relatedArchived += 1;
      }

      await deleteBlocks(page.id);
      await blankProperties(page.id);
      pagesBlanked += 1;
      await archive(page.id);
      pagesArchived += 1;
    }
  }

  return { skipped: false, pagesBlanked, pagesArchived, relatedArchived, note };
}

/**
 * Of een fout uit Notion het afbreken van de purge waard is.
 *
 * Een pagina die er niet meer is (404) of al gearchiveerd, is geen probleem: dan
 * is het doel bereikt. Een fout token of een intrekking van de integratie wel,
 * want dan blijft er een leesbare kaart met een naam staan terwijl de rest
 * verdwijnt.
 */
export function notionErrorIsHarmless(error: unknown): boolean {
  return error instanceof NotionError && error.status === 404;
}
