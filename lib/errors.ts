/**
 * De fouten die een route handler in een status omzet.
 *
 * Eigen bestand, en met opzet zonder ook maar één import. `lib/http.ts` moet
 * kunnen zien welke fout er langskomt, en haalde die klassen eerst uit
 * `lib/intake/session.ts` en `lib/review/access.ts`. Dat betekende dat ELKE
 * route die `handleError` gebruikt de intake-sessielaag en de coachautorisatie
 * meesleepte, inclusief hun Supabase-clients, puur voor twee `instanceof`-takken.
 *
 * Dat viel op bij het uitzoeken van de screening als aparte applicatie: de
 * screeningroutes hebben met intakes niets te maken en importeerden er toch de
 * halve laag van. Zie docs/screening-app.md.
 *
 * De oude plekken exporteren ze opnieuw, zodat bestaande imports blijven werken
 * en dit geen zoek-en-vervang door de hele codebase is.
 */

/** Geen geldige coachsessie. Levert 401 op. */
export class CoachAuthError extends Error {
  constructor() {
    super("geen geldige coachsessie");
    this.name = "CoachAuthError";
  }
}

/** Geen geldige intakesessie. Levert 401 op. */
export class IntakeAuthError extends Error {
  constructor() {
    super("geen geldige intakesessie");
    this.name = "IntakeAuthError";
  }
}

/**
 * De intake is goedgekeurd en daarmee gesloten. Levert 409 op en geen 400: de
 * aanvraag was niet fout, de toestand is veranderd.
 */
export class IntakeLockedError extends Error {
  constructor() {
    super("intake is goedgekeurd en gesloten");
    this.name = "IntakeLockedError";
  }
}
