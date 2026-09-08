import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { appDb } from "@/lib/supabase/service";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Sessie voor de publieke intake.
 *
 * De atleet komt binnen via een linktree en heeft geen account. In plaats van
 * een login gebruikt hij een capability token:
 *
 * - het token zit in een httpOnly cookie, niet in de URL, want een URL komt in
 *   browsergeschiedenis, in server-logs en in een screenshot terecht
 * - alleen de SHA-256 van het token staat in de databank, dus een dump van
 *   public.intakes geeft niemand toegang tot een dossier
 * - de opzoeking loopt via de unieke index op de hash, dus in constante tijd
 *
 * Wat dit niet is: een inlog. Hervatten op een ander toestel zit niet in deze
 * MVP en vraagt een magic link naar het e-mailadres van de atleet.
 */

const COOKIE = "intake_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export interface IntakeSession {
  intakeId: string;
  athleteId: string;
  status: "draft" | "submitted" | "in_review" | "approved";
  locale: "nl" | "en";
  consentGrantedAt: string | null;
}

/**
 * De intake achter het cookie, of null. Geeft nooit een reden terug: het
 * verschil tussen "geen cookie" en "onbekend token" is niets waard voor de
 * gebruiker en wel voor iemand die aan het raden is.
 */
export async function currentIntake(): Promise<IntakeSession | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const { data, error } = await appDb()
    .from("intakes")
    .select("id, athlete_id, status, locale, consent_granted_at, athletes(profile_id)")
    .eq("access_token_hash", hashToken(token))
    .maybeSingle();

  if (error || !data) return null;

  // Hoort deze intake bij een account, dan moet de ingelogde gebruiker dat
  // account zijn. Zonder deze controle is het cookie op zichzelf genoeg, en dan
  // opent een gekopieerd of gestolen cookie het dossier van iemand anders,
  // ongeacht wie er ingelogd is.
  //
  // Intakes zonder profile_id blijven werken op alleen het cookie. Dat zijn de
  // dossiers van voor de accounts; nieuwe intakes krijgen altijd een eigenaar.
  const embedded = Array.isArray(data.athletes) ? data.athletes[0] : data.athletes;
  const ownerId = (embedded as { profile_id: string | null } | null)?.profile_id ?? null;

  if (ownerId !== null) {
    const supabase = await createServerSupabase();
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user?.id !== ownerId) return null;
  }

  return {
    intakeId: data.id as string,
    athleteId: data.athlete_id as string,
    status: data.status as IntakeSession["status"],
    locale: data.locale as "nl" | "en",
    consentGrantedAt: data.consent_granted_at as string | null,
  };
}

export class IntakeAuthError extends Error {
  constructor() {
    super("geen geldige intakesessie");
    this.name = "IntakeAuthError";
  }
}

/** Voor route handlers: sessie of een fout die als 401 uitkomt. */
export async function requireIntake(): Promise<IntakeSession> {
  const session = await currentIntake();
  if (!session) throw new IntakeAuthError();
  return session;
}

export class IntakeLockedError extends Error {
  constructor() {
    super("intake is goedgekeurd en gesloten");
    this.name = "IntakeLockedError";
  }
}

/**
 * Voor route handlers die iets aan de intake VERANDEREN.
 *
 * Na goedkeuring staat het dossier vast. De coach heeft een rapportversie
 * afgetekend met zijn naam eronder, en die verwijst naar deze inhoud; komt er
 * daarna nog een antwoord of een document bij, dan klopt "goedgekeurd op 8
 * september" niet meer met wat er staat.
 *
 * Bewust niet in requireIntake zelf: lezen moet blijven werken. De atleet mag
 * zijn eigen rapport en zijn transcript ook na goedkeuring nog opvragen, en dat
 * is precies wanneer hij dat wil.
 */
export async function requireEditableIntake(): Promise<IntakeSession> {
  const session = await requireIntake();
  if (session.status === "approved") throw new IntakeLockedError();
  return session;
}
