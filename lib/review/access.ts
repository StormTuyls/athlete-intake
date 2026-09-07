import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Wie het coachdossier mag zien.
 *
 * Hier stond eerst een omgevingsvariabele: het scherm was open en alleen
 * dichtgezet met REVIEW_UNAUTHENTICATED plus een harde weigering in productie.
 * Dat was een rem, geen slot. Nu is er een echte login, en de rem is weg: een
 * vlag die authenticatie omzeilt hoort niet in een codebase die artikel
 * 9-gegevens verwerkt, ook niet "alleen lokaal".
 *
 * De controle is dubbel, en dat is opzet. Deze functie beslist in de applicatie,
 * en de RLS-policies in 20260902090300_rls.sql beslissen nog eens in de
 * databank via private.is_staff(). Wie een van de twee vergeet, wordt door de
 * ander tegengehouden.
 *
 * getUser() en niet getSession(): de eerste laat de authserver het token
 * valideren, de tweede leest wat er in de cookie staat. Voor een
 * autorisatiebeslissing over een medisch dossier is dat verschil het hele punt.
 */

export class CoachAuthError extends Error {
  constructor() {
    super("geen geldige coachsessie");
    this.name = "CoachAuthError";
  }
}

export interface Coach {
  id: string;
  role: "coach" | "admin";
  fullName: string | null;
  email: string | null;
}

/**
 * Waarom niet inloggen en geen coach zijn twee verschillende uitkomsten zijn.
 *
 * Niet ingelogd hoort naar de login. Ingelogd maar geen behandelaar hoort naar
 * een 404: die persoon heeft niets aan het inlogformulier, en hem er toch heen
 * sturen levert een lus op (login, link aanvragen, opnieuw inloggen, nog steeds
 * geen coach, terug naar de login). Bovendien hoort een atleet niet te weten
 * dat dit dossier bestaat.
 */
export type CoachCheck =
  | { kind: "coach"; coach: Coach }
  | { kind: "anonymous" }
  | { kind: "not-a-coach" };

export async function checkCoach(): Promise<CoachCheck> {
  const supabase = await createServerSupabase();

  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) return { kind: "anonymous" };

  // De rol staat in public.profiles en niet in de tokenclaims. Bewust: een rol
  // in een token blijft geldig tot het verloopt, dus wie zijn coachrol verliest
  // zou nog een uur binnen kunnen. De policy profiles_select_self laat alleen de
  // eigen rij zien, dus dit lekt niets over anderen.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", auth.user.id)
    .single();

  if (!profile || (profile.role !== "coach" && profile.role !== "admin")) {
    return { kind: "not-a-coach" };
  }

  return {
    kind: "coach",
    coach: {
      id: auth.user.id,
      role: profile.role,
      fullName: profile.full_name ?? null,
      email: auth.user.email ?? null,
    },
  };
}

export async function currentCoach(): Promise<Coach | null> {
  const result = await checkCoach();
  return result.kind === "coach" ? result.coach : null;
}

/** Gooit als er geen coach is. Voor routes die zonder identiteit niets mogen doen. */
export async function requireCoach(): Promise<Coach> {
  const coach = await currentCoach();
  if (!coach) throw new CoachAuthError();
  return coach;
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
