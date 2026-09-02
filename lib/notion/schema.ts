/**
 * De Notion-structuur voor de commerciele laag.
 *
 * Waarom dit er is: de klant wil in Notion zien aan wie welke facturen en
 * opvolgacties moeten uitgaan. Dat is een planbord, en daar is Notion goed in.
 *
 * Waarom er geen medische data in staat: Notion is een verwerker buiten de EU
 * zonder toegangscontrole op veldniveau, zonder bruikbaar audit-spoor en zonder
 * verwijderingspad dat je aan een toezichthouder kunt uitleggen. Bijzondere
 * categorie persoonsgegevens horen daar niet. De scheiding is geen afspraak maar
 * een filter in lib/notion/sync.ts, met een test die het bewijst.
 *
 * Wat er dus wel heen gaat: naam, contact, club, federatie, sport, de status van
 * de intake en twee getallen over volledigheid. Genoeg om te weten wie
 * aandacht nodig heeft, te weinig om een dossier te reconstrueren.
 */

export const ATHLETE_STATUS = [
  "Intake ontvangen",
  "In review",
  "Goedgekeurd",
  "Actief",
  "Gestopt",
] as const;

export const INVOICE_STATUS = [
  "Te versturen",
  "Verstuurd",
  "Betaald",
  "Vervallen",
] as const;

export const TASK_STATUS = ["Open", "Bezig", "Klaar"] as const;

export const TASK_SOURCE = ["Intake automatisch", "Coach", "Review"] as const;

export const SPORTS = [
  "Sprint",
  "Horden",
  "Roeien",
  "Snelschaatsen",
  "Skeeleren",
  "Voetbal",
  "Andere",
] as const;

function select(options: readonly string[]) {
  return { select: { options: options.map((name) => ({ name })) } };
}

/** Database 1: atleten. Bewust zonder medische velden. */
export const ATHLETES_DB = {
  title: "Atleten",
  description:
    "Commerciele laag van de atletenbegeleiding. Bevat met opzet geen medische gegevens; die blijven in Postgres.",
  properties: {
    Naam: { title: {} },
    Status: select(ATHLETE_STATUS),
    "E-mail": { email: {} },
    Telefoon: { phone_number: {} },
    Sport: select(SPORTS),
    Club: { rich_text: {} },
    Federatie: { rich_text: {} },
    "Intake ID": { rich_text: {} },
    "Intake ontvangen": { date: {} },
    Volledigheid: { number: { format: "percent" } },
    "Openstaande velden": { number: { format: "number" } },
    Dossier: { url: {} },
  },
} as const;

/** Database 2: facturatie. Relatie naar Atleten wordt bij setup ingevuld. */
export function invoicesDb(athletesDatabaseId: string) {
  return {
    title: "Facturatie",
    description: "Wat er per atleet gefactureerd moet worden.",
    properties: {
      Omschrijving: { title: {} },
      Atleet: { relation: { database_id: athletesDatabaseId, single_property: {} } },
      Bedrag: { number: { format: "euro" } },
      Status: select(INVOICE_STATUS),
      Vervaldatum: { date: {} },
      Factuurnummer: { rich_text: {} },
    },
  };
}

/** Database 3: opvolgacties. */
export function tasksDb(athletesDatabaseId: string) {
  return {
    title: "Opvolgacties",
    description: "Wat er per atleet moet gebeuren, en door wie.",
    properties: {
      Actie: { title: {} },
      Atleet: { relation: { database_id: athletesDatabaseId, single_property: {} } },
      Deadline: { date: {} },
      Status: select(TASK_STATUS),
      Verantwoordelijke: { people: {} },
      Bron: select(TASK_SOURCE),
    },
  };
}
