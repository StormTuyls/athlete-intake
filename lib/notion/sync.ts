import { notion } from "@/lib/notion/client";
import { TRAINABILITY } from "@/lib/notion/schema";
import { appDb } from "@/lib/supabase/service";
import { syncDossier } from "@/lib/db/dossier";
import { listDocuments } from "@/lib/db/medical";
import { clinicalSummary, commercialSummary } from "@/lib/claude/summarise";
import { getInjuries } from "@/lib/db/review";
import { markdownToBlocks } from "@/lib/notion/blocks";
import { label } from "@/lib/dossier/labels";
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

/**
 * De enige velden die naar Notion mogen.
 *
 * Nieuwe velden gaan per definitie niet mee: iemand moet ze hier toevoegen en
 * daarbij nadenken. `identity.medical_network` staat er met opzet niet in en is
 * inmiddels ook in de taxonomie als medisch gemarkeerd, want een lijst van
 * behandelaars verraadt iets over gezondheid.
 *
 * `status.goals` en `status.motivation` staan er ook niet in, hoewel de
 * taxonomie ze niet-medisch noemt: dat zijn lange vrije tekstvelden waar een
 * atleet in de praktijk zijn klachten in beschrijft.
 */
/**
 * Medische velden die naar Notion mogen, en alleen als de atleet toestemming gaf
 * om met zijn behandelaars te delen.
 *
 * Deze Notion is de werkomgeving van de behandelend kinesist, dus delen is hier
 * gedeeld met een behandelaar en geen commerciele verwerking. Dat maakt het
 * toelaatbaar, maar niet vanzelf: zonder het vinkje gaat er niets medisch heen
 * en valt de pagina terug op de zakelijke samenvatting.
 */
const PRACTITIONER_FIELDS = ["status.training_availability"] as const;

const SYNCABLE_FIELDS = [
  "identity.full_name",
  "identity.date_of_birth",
  "identity.email",
  "identity.phone",
  "identity.sport",
  "identity.discipline",
  "identity.club",
  "identity.federation",
  "identity.coach_name",
  "training.weekly_volume_hours",
  "training.season_phase",
  "training.seasons_experience",
  "training.strength_training_years",
  "status.target_event",
  "consent.share_with_practitioners",
  "uploads.medical_documents_provided",
  "uploads.test_data_provided",
  "uploads.programme_provided",
  "uploads.video_provided",
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
  conflicts: number;
  dossierUrl: string;
  status: string;
  /** Gaf de atleet toestemming om met zijn behandelaars te delen. */
  sharingAllowed: boolean;
  /** Alleen gelezen als sharingAllowed waar is. */
  medicalValues: Map<string, unknown>;
}): Record<string, unknown> {
  const byKey = new Map(input.definitions.map((d) => [d.key, d]));

  const leaking = SYNCABLE_FIELDS.filter((key) => byKey.get(key)?.isMedical);
  if (leaking.length > 0) throw new MedicalLeakError(leaking);

  const raw = (key: string): unknown => input.values.get(key);

  const text = (key: string): string => {
    const value = raw(key);
    return value === null || value === undefined ? "" : String(value);
  };

  const number = (key: string): number | null => {
    const value = raw(key);
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const richText = (value: string) =>
    value ? { rich_text: [{ text: { content: value.slice(0, 2000) } }] } : { rich_text: [] };

  const date = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: { start: value } } : { date: null };

  const sportKey = text("identity.sport");

  // Trainbaarheid is medisch en gaat alleen mee met toestemming.
  const availability = input.sharingAllowed
    ? String(input.medicalValues.get("status.training_availability") ?? "")
    : "";
  const trainability =
    availability === "full"
      ? TRAINABILITY[0]
      : availability === "modified"
        ? TRAINABILITY[1]
        : availability === "none"
          ? TRAINABILITY[2]
          : null;

  return {
    Naam: {
      title: [{ text: { content: text("identity.full_name") || "Naam onbekend" } }],
    },
    Status: { select: { name: input.status } },
    "Aandacht nodig": { checkbox: input.conflicts > 0 },
    Geboortedatum: date(text("identity.date_of_birth")),
    Sport: sportKey
      ? { select: { name: SPORT_LABELS[sportKey] ?? "Andere" } }
      : { select: null },
    Discipline: richText(text("identity.discipline")),
    Club: richText(text("identity.club")),
    "E-mail": { email: text("identity.email") || null },
    Telefoon: { phone_number: text("identity.phone") || null },
    Trainbaarheid: trainability ? { select: { name: trainability } } : { select: null },
    Doelwedstrijd: richText(text("status.target_event")),
    "Trainingsvolume per week": { number: number("training.weekly_volume_hours") },
    "Intake ontvangen": input.submittedAt
      ? { date: { start: input.submittedAt.slice(0, 10) } }
      : { date: null },
    "Intake ID": { rich_text: [{ text: { content: input.intakeId } }] },
    Dossier: { url: input.dossierUrl },
  };
}

/**
 * De paginabody: een leesbare samenvatting plus een expliciete verwijzing naar
 * waar het medische deel staat.
 *
 * Dat laatste is geen decoratie. Wie deze pagina opent moet weten dat dit niet
 * het dossier is, anders gaat iemand ervan uit dat de klachten hier ook wel
 * zouden staan als ze er waren.
 */
export function buildAthleteBody(input: {
  summary: string;
  clinical: boolean;
  dossierUrl: string;
}): unknown[] {
  const notice = input.clinical
    ? "Samenvatting van de intake voor de behandelend kinesist, gedeeld met toestemming van de atleet. Feiten komen uit de aangeleverde documenten, observaties zijn interpretatie en geen diagnose. De ruwe documenten en de herkomst per gegeven staan in het dossier."
    : "Deze atleet gaf geen toestemming om gegevens met behandelaars te delen, dus hier staat alleen de zakelijke samenvatting. De medische intake staat uitsluitend in het dossier.";

  return [
    {
      object: "block",
      type: "callout",
      callout: {
        icon: { emoji: input.clinical ? "🩺" : "🔒" },
        rich_text: [{ type: "text", text: { content: notice } }],
      },
    },
    ...markdownToBlocks(input.summary),
    {
      object: "block",
      type: "bookmark",
      bookmark: { url: input.dossierUrl },
    },
  ];
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
  clinical: boolean;
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

  // Toestemming om met behandelaars te delen. Zonder dat vinkje gaat er niets
  // medisch naar Notion, ook niet de samenvatting. Dat is de hele reden dat dat
  // vinkje bestaat.
  const sharingAllowed =
    state.resolved.get("consent.share_with_practitioners")?.value === true;

  const medicalValues = new Map<string, unknown>();
  if (sharingAllowed) {
    for (const key of PRACTITIONER_FIELDS) {
      medicalValues.set(key, state.resolved.get(key)?.value ?? null);
    }
  }

  const dossierUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/review/${intakeId}`;

  const properties = buildAthleteProperties({
    definitions: state.definitions,
    values,
    medicalValues,
    sharingAllowed,
    intakeId,
    submittedAt: intake.submitted_at as string | null,
    conflicts: state.completeness.conflicts,
    dossierUrl,
    status:
      intake.status === "approved"
        ? "Goedgekeurd"
        : intake.status === "in_review"
          ? "In review"
          : "Intake ontvangen",
  });

  // Met toestemming de klinische samenvatting, anders de zakelijke. De zakelijke
  // krijgt uitsluitend de gefilterde waarden mee, dus daar kan per constructie
  // geen klinische inhoud in belanden.
  const summary = sharingAllowed
    ? await clinicalSummary({
        definitions: state.definitions,
        resolved: state.resolved,
        injuries: await getInjuries(intakeId),
      })
    : await commercialSummary({
        values,
        documentCount: (await listDocuments(intakeId)).length,
        openFields: state.completeness.total - state.completeness.filled,
        conflicts: state.completeness.conflicts,
      });

  const existing = await notion<QueryResult>(`/databases/${athletesDb}/query`, {
    method: "POST",
    body: {
      filter: { property: "Intake ID", rich_text: { equals: intakeId } },
      page_size: 1,
    },
  });

  const children = buildAthleteBody({
    summary: summary.text,
    clinical: sharingAllowed,
    dossierUrl,
  });

  let pageId: string;
  let created = false;

  if (existing.results.length > 0) {
    pageId = existing.results[0].id;
    await notion(`/pages/${pageId}`, { method: "PATCH", body: { properties } });
    // De samenvatting hoort mee te veranderen met het dossier. Laat je de body
    // staan, dan leest de kinesist volgende maand een tekst die niet meer klopt.
    await replaceBody(pageId, children);
  } else {
    const page = await notion<{ id: string }>("/pages", {
      method: "POST",
      body: { parent: { database_id: athletesDb }, properties, children },
    });
    pageId = page.id;
    created = true;
    await createDefaults(pageId, String(values.get("identity.full_name") ?? "atleet"));
  }

  await logAudit({
    action: "export",
    actorKind: "system",
    entitySchema: "public",
    entityTable: "intakes",
    entityId: intakeId,
    detail: {
      target: "notion",
      clinical: sharingAllowed,
      created,
      model: summary.modelId,
    },
  });

  return { pageId, created, clinical: sharingAllowed };
}

/**
 * Vervangt de hele paginabody.
 *
 * Notion kent geen "vervang de inhoud", dus de bestaande blokken worden verwijderd
 * en de nieuwe toegevoegd. Dat mag hier, want deze body is volledig afgeleid van
 * het dossier: er gaat geen door mensen getypte tekst verloren. Notities die de
 * kinesist zelf toevoegt horen in een comment of een subpagina, niet in dit blok.
 */
async function replaceBody(pageId: string, children: unknown[]): Promise<void> {
  const existing = await notion<{ results: Array<{ id: string; type: string }> }>(
    `/blocks/${pageId}/children?page_size=100`,
  );

  for (const block of existing.results) {
    await notion(`/blocks/${block.id}`, { method: "DELETE" });
  }

  await notion(`/blocks/${pageId}/children`, {
    method: "PATCH",
    body: { children },
  });
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
