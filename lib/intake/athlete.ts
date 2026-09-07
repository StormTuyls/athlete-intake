import { createServerSupabase } from "@/lib/supabase/server";
import { appDb } from "@/lib/supabase/service";

/**
 * Wie de atleet is, los van welke intake hij open heeft staan.
 *
 * Tot nu toe was een atleet niets meer dan een cookie: een capability-token van
 * dertig dagen, geldig voor precies één intake. Dat werkt voor één invulsessie,
 * maar het thuisscherm uit het ontwerp toont eerdere intakes, en dan moet er
 * iets zijn dat zegt dat die drie dossiers van dezelfde persoon zijn. Een lijst
 * met medische dossiers achter een cookie is geen lijst die je wil bouwen.
 *
 * De koppeling bestond al in het schema: `athletes.profile_id` verwijst naar
 * `public.profiles`, en de RLS-policies athletes_select en intakes_select
 * gebruiken hem al. Er was alleen nog niets dat hem vulde.
 *
 * De rol blijft 'athlete'. Dat is niet hetzelfde als de coach-rol, en
 * requireCoach() laat er dus niets door: dezelfde inlogmachinerie, twee
 * verschillende autorisaties.
 */

export interface AthleteIdentity {
  /** auth.users.id, tevens profiles.id. */
  userId: string;
  /** public.athletes.id. De medische kant hangt hieraan, niet aan de user. */
  athleteId: string;
  email: string | null;
  fullName: string | null;
  locale: "nl" | "en";
}

export async function currentAthlete(): Promise<AthleteIdentity | null> {
  const supabase = await createServerSupabase();

  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) return null;

  // Via de service role, want de atleet mag zijn eigen `athletes`-rij lezen maar
  // niet aanmaken (athletes_write is alleen voor staf). Het filter op profile_id
  // doet hier het werk dat RLS anders zou doen.
  const { data: athlete } = await appDb()
    .from("athletes")
    .select("id, full_name, email, locale, deleted_at")
    .eq("profile_id", auth.user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!athlete) return null;

  return {
    userId: auth.user.id,
    athleteId: athlete.id as string,
    email: (athlete.email as string | null) ?? auth.user.email ?? null,
    fullName: (athlete.full_name as string | null) ?? null,
    locale: (athlete.locale as "nl" | "en") ?? "en",
  };
}

/**
 * Zorgt dat er een profiel en een atleetrij bestaan voor de ingelogde gebruiker.
 *
 * Wordt aangeroepen na signUp. De client kan dit niet zelf: er is geen
 * insert-policy op `profiles` en `athletes_write` is alleen voor staf, dus dit
 * moet met de service role. Dat is ook waar het hoort, want de rol wordt hier
 * vastgezet op 'athlete' en niet door de client meegegeven.
 *
 * Idempotent: twee keer aanroepen levert geen tweede atleet op.
 */
export async function ensureAthleteForUser(input: {
  userId: string;
  email: string | null;
  fullName: string | null;
  locale: "nl" | "en";
}): Promise<AthleteIdentity> {
  const db = appDb();

  const { error: profileError } = await db.from("profiles").upsert(
    {
      id: input.userId,
      role: "athlete",
      full_name: input.fullName,
      locale: input.locale,
    },
    { onConflict: "id" },
  );
  if (profileError) throw new Error(`profiel opslaan mislukt: ${profileError.message}`);

  const { data: existing } = await db
    .from("athletes")
    .select("id")
    .eq("profile_id", input.userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    return {
      userId: input.userId,
      athleteId: existing.id as string,
      email: input.email,
      fullName: input.fullName,
      locale: input.locale,
    };
  }

  // Retentie blijft hier bewust leeg. De databank staat dat alleen toe tussen
  // aanmaken en het geven van consent, en consent is de plek waar de termijn
  // wordt vastgelegd omdat het onderdeel is van waar iemand mee instemt.
  const { data: created, error } = await db
    .from("athletes")
    .insert({
      profile_id: input.userId,
      full_name: input.fullName,
      email: input.email,
      locale: input.locale,
      retention_mode: "until_date",
      retention_until: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
    })
    .select("id")
    .single();

  if (error || !created) throw new Error(`atleet aanmaken mislukt: ${error?.message}`);

  return {
    userId: input.userId,
    athleteId: created.id as string,
    email: input.email,
    fullName: input.fullName,
    locale: input.locale,
  };
}
