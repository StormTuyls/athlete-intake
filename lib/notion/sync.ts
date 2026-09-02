import { notion } from "@/lib/notion/client";
import { appDb } from "@/lib/supabase/service";
import { syncDossier } from "@/lib/db/dossier";
import { logAudit } from "@/lib/audit";
import type { FieldDefinition } from "@/lib/types";

/**
 * Push van de commerciele laag naar Notion.
 *
 * Het enige echte risico van deze koppeling is dat er medische data meelift.
 * Daarom staat de scheiding hier niet in een comment maar in code:
 *
 * 1. Een expliciete lijst van velden die naar Notion mogen. Nieuwe velden gaan
 *    per definitie niet mee; iemand moet ze hier toevoegen.
 * 2. Een controle tegen de taxonomie: staat een veld uit die lijst in de
 *    databank als medisch gemarkeerd, dan weigert de sync in plaats van te
 *    lekken. Markeert iemand later `identity.medical_network` als medisch, dan
 *    stopt de koppeling en gaat er niets stiekem alsnog heen.
 *
 * Wat er verder heen gaat zijn twee getallen: volledigheid en het aantal
 * openstaande velden. Genoeg om te zien wie aandacht nodig heeft, te weinig om
 * een dossier te reconstrueren.
 */

const SYNCABLE_FIELDS = [
  "identity.full_name",
  "identity.email",
  "identity.phone",
  "identity.club",
  "identity.federation",
  "identity.sport",
] as const;

const SPORT_LABELS: Record<string, string> = {
  sprint: "Sprint",
  hurdles: "Horden",
  rowing: "Roeien",
  speed_skating: "Snelschaatsen",
  inline_skating: "Skeeleren",
  football: "Voetbal",
  other: "Andere",
};

export class MedicalLeakError extends Error {
  constructor(fieldKeys: string[]) {
    super(
      `Notion-sync geweigerd: ${fieldKeys.join(", ")} staat als medisch gemarkeerd en mag niet naar Notion`,
    );
    this.name = "MedicalLeakError";
  }
}

/**
 * Bouwt de payload en weigert bij een medisch veld in de lijst.
 * Puur, zonder IO, zodat de garantie te testen is zonder Notion of databank.
 */
export function buildAthleteProperties(input: {
  definitions: FieldDefinition[];
  values: Map<string, unknown>;
  intakeId: string;
  submittedAt: string | null;
  completenessRatio: number;
  openFields: number;
  dossierUrl: string;
  status: string;
}): Record<string, unknown> {
  const byKey = new Map(input.definitions.map((d) => [d.key, d]));

  const leaking = SYNCABLE_FIELDS.filter((key) => byKey.get(key)?.isMedical);
  if (leaking.length > 0) throw new MedicalLeakError(leaking);

  const text = (key: string): string => {
    const value = input.values.get(key);
    return value === null || value === undefined ? "" : String(value);
  };

  const sportKey = text("identity.sport");

  return {
    Naam: {
      title: [{ text: { content: text("identity.full_name") || "Naam onbekend" } }],
    },
    Status: { select: { name: input.status } },
    "E-mail": { email: text("identity.email") || null },
    Telefoon: { phone_number: text("identity.phone") || null },
    Sport: sportKey ? { select: { name: SPORT_LABELS[sportKey] ?? "Andere" } } : { select: null },
    Club: { rich_text: [{ text: { content: text("identity.club") } }] },
    Federatie: { rich_text: [{ text: { content: text("identity.federation") } }] },
    "Intake ID": { rich_text: [{ text: { content: input.intakeId } }] },
    "Intake ontvangen": input.submittedAt
      ? { date: { start: input.submittedAt.slice(0, 10) } }
      : { date: null },
    Volledigheid: { number: input.completenessRatio },
    "Openstaande velden": { number: input.openFields },
    Dossier: { url: input.dossierUrl },
  };
}

interface QueryResult {
  results: Array<{ id: string }>;
}

/**
 * Zet of werkt de atleet bij in Notion, en maakt bij een eerste sync de
 * standaard opvolgactie en factuurregel aan.
 *
 * Idempotent op Intake ID: twee keer syncen geeft geen dubbele rij.
 */
export async function syncIntakeToNotion(intakeId: string): Promise<{
  pageId: string;
  created: boolean;
}> {
  const athletesDb = process.env.NOTION_ATHLETES_DB;
  if (!athletesDb) throw new Error("NOTION_ATHLETES_DB ontbreekt");

  const { data: intake, error } = await appDb()
    .from("intakes")
    .select("id, status, submitted_at, locale")
    .eq("id", intakeId)
    .single();

  if (error || !intake) throw new Error(`intake niet gevonden: ${error?.message}`);

  const state = await syncDossier(intakeId, intake.locale as "nl" | "en");

  const values = new Map<string, unknown>();
  for (const key of SYNCABLE_FIELDS) {
    values.set(key, state.resolved.get(key)?.value ?? null);
  }

  const properties = buildAthleteProperties({
    definitions: state.definitions,
    values,
    intakeId,
    submittedAt: intake.submitted_at as string | null,
    completenessRatio:
      state.completeness.total === 0
        ? 0
        : state.completeness.filled / state.completeness.total,
    openFields: state.completeness.total - state.completeness.filled,
    dossierUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/review/${intakeId}`,
    status: intake.status === "approved" ? "Goedgekeurd" : intake.status === "in_review" ? "In review" : "Intake ontvangen",
  });

  const existing = await notion<QueryResult>(`/databases/${athletesDb}/query`, {
    method: "POST",
    body: {
      filter: { property: "Intake ID", rich_text: { equals: intakeId } },
      page_size: 1,
    },
  });

  let pageId: string;
  let created = false;

  if (existing.results.length > 0) {
    pageId = existing.results[0].id;
    await notion(`/pages/${pageId}`, { method: "PATCH", body: { properties } });
  } else {
    const page = await notion<{ id: string }>("/pages", {
      method: "POST",
      body: { parent: { database_id: athletesDb }, properties },
    });
    pageId = page.id;
    created = true;
    await createDefaults(pageId, String(values.get("identity.full_name") ?? "atleet"));
  }

  // Een export naar een derde partij is een verwerking en hoort in het spoor,
  // ook al gaat er geen medische data mee.
  await logAudit({
    action: "export",
    actorKind: "system",
    entitySchema: "public",
    entityTable: "intakes",
    entityId: intakeId,
    detail: { target: "notion", fields: SYNCABLE_FIELDS.length, created },
  });

  return { pageId, created };
}

async function createDefaults(athletePageId: string, name: string): Promise<void> {
  const tasksDb = process.env.NOTION_TASKS_DB;
  const invoicesDb = process.env.NOTION_INVOICES_DB;

  if (tasksDb) {
    await notion("/pages", {
      method: "POST",
      body: {
        parent: { database_id: tasksDb },
        properties: {
          Actie: { title: [{ text: { content: `Intake nakijken en goedkeuren: ${name}` } }] },
          Atleet: { relation: [{ id: athletePageId }] },
          Status: { select: { name: "Open" } },
          Bron: { select: { name: "Intake automatisch" } },
        },
      },
    });
  }

  if (invoicesDb) {
    await notion("/pages", {
      method: "POST",
      body: {
        parent: { database_id: invoicesDb },
        properties: {
          Omschrijving: { title: [{ text: { content: `Intake en eerste screening: ${name}` } }] },
          Atleet: { relation: [{ id: athletePageId }] },
          Status: { select: { name: "Te versturen" } },
        },
      },
    });
  }
}
