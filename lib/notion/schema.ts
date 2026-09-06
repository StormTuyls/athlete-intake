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
 * Wat er wel heen gaat: identiteit, contact, sport en club, trainingsbelasting,
 * doelwedstrijd, wat er aangeleverd is, en getallen over volledigheid en
 * conflicten. Genoeg om te weten wie aandacht nodig heeft en wie een factuur
 * moet krijgen, te weinig om een dossier te reconstrueren.
 *
 * Eén regel die verder gaat dan is_medical: er gaat geen enkel lang vrij
 * tekstveld heen dat de atleet zelf invult. Doelstellingen en motivatie staan in
 * de taxonomie als niet-medisch, maar in de praktijk schrijft een atleet daar
 * "weer sprinten zonder pijn in mijn hamstring". Een veld dat formeel
 * niet-medisch is kan dus wel klinische inhoud bevatten. Alleen gestructureerde
 * velden en korte tekst gaan mee.
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

export const SEASON_PHASES: Record<string, string> = {
  off_season: "Overgangsperiode",
  general_prep: "Algemene voorbereiding",
  specific_prep: "Specifieke voorbereiding",
  competition: "Wedstrijdperiode",
  transition: "Transitie",
};

export const DELIVERED = [
  "Medische documenten",
  "Test- of VALD-data",
  "Trainingsschema",
  "Video",
] as const;

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

export const TRAINABILITY = [
  "Volledig trainbaar",
  "Aangepast trainbaar",
  "Niet trainbaar",
] as const;

/**
 * Database 1: atleten.
 *
 * Kort gehouden, want de lezer is de kinesist en niet een administratie. Een
 * kine heeft niets aan "jaren krachttraining" of "volledigheid 68 procent" in
 * een kolom; die kijkt naar wie het is, waar het zit en wat er aan de hand is.
 * Het verhaal staat in de paginabody, niet in twintig kolommen.
 *
 * "Intake ID" is technisch en staat er alleen zodat de sync dezelfde rij
 * terugvindt in plaats van een tweede aan te maken. Die kolom kun je in Notion
 * gewoon verbergen in de weergave.
 */
export const ATHLETES_DB = {
  title: "Atleten",
  description:
    "Atleetkaarten voor de behandelend kinesist. De samenvatting staat op de pagina zelf.",
  properties: {
    Naam: { title: {} },
    Status: select(ATHLETE_STATUS),
    "Aandacht nodig": { checkbox: {} },
    Geboortedatum: { date: {} },
    Sport: select(SPORTS),
    Discipline: { rich_text: {} },
    Club: { rich_text: {} },
    "E-mail": { email: {} },
    Telefoon: { phone_number: {} },
    // Medisch, dus alleen gevuld als de atleet toestemming gaf om met zijn
    // behandelaars te delen. Zie lib/notion/sync.ts.
    Trainbaarheid: select(TRAINABILITY),
    Doelwedstrijd: { rich_text: {} },
    "Trainingsvolume per week": { number: { format: "number" } },
    "Intake ontvangen": { date: {} },
    "Intake ID": { rich_text: {} },
    Dossier: { url: {} },
  },
} as const;

/** Kolommen uit een eerdere versie die weg mogen bij een prune. */
export const RETIRED_PROPERTIES = [
  "Federatie",
  "Coach",
  "Seizoensfase",
  "Jaren ervaring",
  "Jaren krachttraining",
  "Aangeleverd",
  "Documenten",
  "Toestemming delen met behandelaars",
  "Volledigheid",
  "Openstaande velden",
  "Tegenstrijdigheden",
] as const;

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
