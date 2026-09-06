/**
 * De poort voor het coachdossier, zolang er geen coach-login is.
 *
 * Het reviewscherm en zijn endpoints tonen het volledige medische dossier,
 * inclusief bronciteten, aan iedereen die een intake-id kent. Er stond een
 * comment bij dat dit niet naar een publieke omgeving mag, en een comment is
 * geen controle. Dit is de controle.
 *
 * Twee voorwaarden, en beide doen werk:
 *
 * 1. Productie weigert onvoorwaardelijk. Geen omgevingsvariabele die iemand op
 *    een vrijdagavond omzet. VERCEL_ENV en niet NODE_ENV, want previews draaien
 *    met NODE_ENV=production en die moeten wel demonstreerbaar blijven.
 * 2. Elke andere omgeving is standaard dicht en vraagt een expliciete vlag. Zo
 *    staat de vlag in .env.example met de waarschuwing erbij, in plaats van dat
 *    iemand vergeet dat het scherm openstaat.
 *
 * Waarom dit nu al nodig is en niet pas bij oplevering: lib/notion/sync.ts
 * schrijft de dossier-URL in de Notion-rij van de atleet. Zonder poort is die
 * rij een sleutel tot een medisch dossier voor iedereen die de werkomgeving kan
 * openen.
 *
 * Wat hierna komt: Supabase Auth met public.profiles.role, waarvoor de policies
 * in 20260902090300_rls.sql al klaarstaan. Dan vervangt requireCoach() deze
 * functie en krijgt de auditregel eindelijk een actor_id.
 */
export function reviewAccessAllowed(): boolean {
  if (process.env.VERCEL_ENV === "production") return false;
  return process.env.REVIEW_UNAUTHENTICATED === "true";
}

/**
 * 404 en geen 403.
 *
 * Een 403 bevestigt dat de intake bestaat, en dat is precies het ene bit dat een
 * dossier dat er niet mag zijn niet hoort te lekken.
 */
export class ReviewClosedError extends Error {
  constructor() {
    super("reviewscherm staat dicht");
    this.name = "ReviewClosedError";
  }
}

export function assertReviewEnabled(): void {
  if (!reviewAccessAllowed()) throw new ReviewClosedError();
}

/**
 * Een intake-id is een uuid. Alles wat dat niet is gaat niet naar de databank:
 * een misvormd pad hoort een 404 te geven, geen pg-fout die als 500 naar buiten
 * komt.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isIntakeId(value: string): boolean {
  return UUID.test(value);
}
