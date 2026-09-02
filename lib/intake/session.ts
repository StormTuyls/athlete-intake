import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { appDb } from "@/lib/supabase/service";

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
    .select("id, athlete_id, status, locale, consent_granted_at")
    .eq("access_token_hash", hashToken(token))
    .maybeSingle();

  if (error || !data) return null;

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
