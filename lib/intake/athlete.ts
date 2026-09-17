import { createServerSupabase } from "@/lib/supabase/server";
import { appDb } from "@/lib/supabase/service";
import { preConsentUntil } from "@/lib/intake/retention";

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
 * Een nieuwe aanmelding krijgt de rol 'athlete'. Dat is niet hetzelfde als de
 * coach-rol, en requireCoach() laat er dus niets door: dezelfde inlogmachinerie,
 * twee verschillende autorisaties.
 *
 * Wat de rol NIET doet is bepalen of iemand een atleet is. Dat zegt public.
 * athletes, via profile_id. Een behandelaar die zelf bij deze praktijk in
 * behandeling is, is allebei: staf in zijn rol, atleet in zijn dossier. Zie
 * roleAfterSignup() voor waarom een aanmelding die rol niet mag platwalsen.
 */

/**
 * Welke rol er na een aanmelding in het profiel hoort te staan.
 *
 * Bijna altijd 'athlete', en daarom stond hier eerst gewoon die waarde. Dat
 * klopte zolang staf en atleten twee gescheiden groepen mensen waren. Sinds een
 * behandelaar die zelf in behandeling is allebei kan zijn, is een vaste waarde
 * hier een stille degradatie: één aanroep en een kinesist is zijn rechten kwijt,
 * zonder fout en zonder spoor buiten het audit-log.
 *
 * De atleetkant heeft die rol niet nodig. currentAthlete() zoekt op profile_id
 * en de policies athletes_select en intakes_select geven toegang op
 * `profile_id = auth.uid()` óf `is_staff()`. Staf laten staan kost dus niets aan
 * de atleetkant en bewaart wel wat er anders verdwijnt.
 */
export function roleAfterSignup(
  existing: string | null | undefined,
): "athlete" | "coach" | "admin" {
  return existing === "coach" || existing === "admin" ? existing : "athlete";
}

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
 * bepaald en niet door de client meegegeven.
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

  // Eerst kijken wat er staat. Een upsert die de rol meeschrijft overschrijft
  // hem ook, en bij een behandelaar met een eigen dossier is dat het verschil
  // tussen een profiel bijwerken en iemand buitensluiten. Zie roleAfterSignup().
  const { data: current } = await db
    .from("profiles")
    .select("role")
    .eq("id", input.userId)
    .maybeSingle();

  const { error: profileError } = await db.from("profiles").upsert(
    {
      id: input.userId,
      role: roleAfterSignup(current?.role as string | undefined),
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
      // Voorlopige termijn, zie PRE_CONSENT_DAYS. recordAccountConsent
      // overschrijft hem in dezelfde aanvraag; blijft hij staan, dan is de
      // aanmelding halverwege gestrand en ruimt de retentiejob hem op.
      retention_until: preConsentUntil(),
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
