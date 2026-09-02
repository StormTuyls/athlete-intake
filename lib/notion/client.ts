/**
 * Minimale Notion-client.
 *
 * Geen SDK: we gebruiken drie endpoints en de officiele client voegt vooral
 * types toe die we hier zelf al scherper hebben. Eén dependency minder in een
 * codebase die medische data verwerkt is een bewuste keuze.
 */

const API = "https://api.notion.com/v1";
const VERSION = process.env.NOTION_API_VERSION ?? "2022-06-28";

export class NotionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(`Notion ${status} ${code}: ${message}`);
    this.name = "NotionError";
  }
}

export async function notion<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error("NOTION_API_KEY ontbreekt");

  const response = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Notion-Version": VERSION,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new NotionError(
      response.status,
      String(payload.code ?? "unknown"),
      String(payload.message ?? "geen melding"),
    );
  }

  return payload as T;
}

export function isConfigured(): boolean {
  return Boolean(process.env.NOTION_API_KEY && process.env.NOTION_PARENT_PAGE_ID);
}
