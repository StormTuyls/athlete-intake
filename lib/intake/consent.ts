import { appDb } from "@/lib/supabase/service";
import { retentionConfig, retentionUntil } from "@/lib/intake/retention";
import type { Locale } from "@/lib/i18n/locale";

/**
 * De consentregistratie, op twee niveaus.
 *
 * Accountniveau (intake_id null) dekt het verwerken van gezondheidsgegevens en
 * de bewaartermijn. Dat is waar de atleet bij het aanmaken van zijn account mee
 * instemt, en het geldt zolang het account bestaat. Het bij elke nieuwe intake
 * opnieuw vragen maakt het register niet sterker, alleen langer, en het leert de
 * atleet vinkjes wegklikken.
 *
 * Intakeniveau (intake_id gevuld) dekt het delen van een samenvatting met een
 * behandelaar. Dat hoort wel per intake: het gaat over dit dossier, en het is de
 * poort waar lib/notion/sync.ts op staat.
 */

export const CONSENT_VERSION = "2026-09-07";

export const ACCOUNT_PURPOSES = ["medical_processing", "retention_acknowledged"] as const;
export const INTAKE_PURPOSES = ["share_with_practitioners"] as const;

export interface ConsentContext {
  ip: string | null;
  userAgent: string | null;
  /**
   * De taal waarin de tekst op het scherm stond.
   *
   * Uit het cookie, want dat is wat rendert. Niet uit `athletes.locale` of
   * `intakes.locale`: het eerste is een voorkeur die morgen anders kan staan,
   * het tweede is de taal van het gesprek en niet van het vinkje. Eén versie
   * bestaat in twee talen, dus zonder dit kan het register niet zeggen welke
   * zin iemand gelezen heeft.
   */
  locale: Locale;
}

export function consentContext(request: Request, locale: Locale): ConsentContext {
  return {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
    locale,
  };
}

/**
 * De accountconsent vastleggen en de bewaartermijn definitief maken.
 *
 * De termijn hoort hier omdat hij onderdeel is van waar de atleet mee instemt.
 * Tot dit moment staat er een korte einddatum op de atleet, zodat een account
 * dat nooit iets doet opruimt; hierna geldt wat er in de consenttekst stond.
 */
export async function recordAccountConsent(input: {
  athleteId: string;
  context: ConsentContext;
}): Promise<void> {
  const db = appDb();

  const purposes = Object.fromEntries(ACCOUNT_PURPOSES.map((key) => [key, true]));

  // Geen upsert met onConflict. De unieke index is partieel (`where intake_id is
  // null`), en Postgres kan een partiële index niet gebruiken om een ON CONFLICT
  // te herleiden tenzij de statement dezelfde WHERE meekrijgt, wat PostgREST niet
  // doet. Dus eerst kijken, dan schrijven, en een dubbele insert van een race
  // opvatten als "stond er al" in plaats van als fout.
  if (!(await hasAccountConsent(input.athleteId))) {
    const { error } = await db.from("consents").insert({
      athlete_id: input.athleteId,
      intake_id: null,
      consent_version: CONSENT_VERSION,
      purposes,
      ip: input.context.ip,
      user_agent: input.context.userAgent,
      locale: input.context.locale,
    });

    // 23505 is de unieke index: iemand anders was net eerder. Dat is het
    // gewenste eindresultaat, geen fout om de aanmelding op te laten klappen.
    if (error && error.code !== "23505") {
      throw new Error(`accountconsent opslaan mislukt: ${error.message}`);
    }
  }

  // Eén bron voor de termijn, zie lib/intake/retention.ts: de tekst die de
  // atleet las en de datum die hier wordt opgeslagen moeten hetzelfde zeggen.
  const config = retentionConfig();
  const indefinite = config.mode === "indefinite";

  const { error: athleteError } = await db
    .from("athletes")
    .update({
      retention_mode: config.mode,
      retention_until: retentionUntil(),
      retention_basis: indefinite ? config.basis : null,
    })
    .eq("id", input.athleteId);

  if (athleteError) {
    throw new Error(`bewaartermijn vastleggen mislukt: ${athleteError.message}`);
  }
}

/** Heeft deze atleet toestemming op accountniveau gegeven? */
export async function hasAccountConsent(athleteId: string): Promise<boolean> {
  const { data } = await appDb()
    .from("consents")
    .select("id")
    .eq("athlete_id", athleteId)
    .is("intake_id", null)
    .is("withdrawn_at", null)
    .limit(1)
    .maybeSingle();

  return Boolean(data);
}

/**
 * De keuze om een samenvatting met een behandelaar te delen, voor één intake.
 *
 * Wordt gevraagd bij het indienen en niet bij het starten: dat is het moment
 * waarop het dossier naar de coach gaat, en dus het moment waarop de vraag
 * ergens over gaat. Een optionele toestemming vooraf vragen levert een vinkje
 * op waar niemand over nadenkt.
 */
export async function recordSharingChoice(input: {
  athleteId: string;
  intakeId: string;
  share: boolean;
  context: ConsentContext;
}): Promise<void> {
  const { error } = await appDb().from("consents").insert({
    athlete_id: input.athleteId,
    intake_id: input.intakeId,
    consent_version: CONSENT_VERSION,
    purposes: { share_with_practitioners: input.share },
    ip: input.context.ip,
    user_agent: input.context.userAgent,
    locale: input.context.locale,
  });

  if (error) throw new Error(`deelkeuze opslaan mislukt: ${error.message}`);
}
