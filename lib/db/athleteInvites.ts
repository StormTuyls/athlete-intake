import { createClient } from "@supabase/supabase-js";
import { appDb } from "@/lib/supabase/service";
import { preConsentUntil } from "@/lib/intake/retention";
import type { Locale } from "@/lib/i18n/locale";

/**
 * Een atleet uitnodigen, vanaf de kant van de praktijk.
 *
 * Tot nu bestond een atleet alleen doordat hij zichzelf aanmeldde op /start. Dat
 * klopt voor wie een link doorgestuurd krijgt en het zelf doet, en het klopt
 * niet voor de helft van de praktijk: iemand zit voor je, je wil zijn intake
 * klaarzetten, en het enige antwoord was "typ dit adres maar over thuis".
 *
 * Wat hier NIET gebeurt is consent geven namens iemand anders. Dat is de hele
 * reden dat dit een uitnodiging is en geen aangemaakt dossier: de praktijk kan
 * een account klaarzetten, maar de grond om gezondheidsgegevens te verwerken kan
 * alleen de atleet zelf leggen. Hij tikt het vinkje bij zijn eerste keer
 * inloggen; tot dan staat er een account zonder consent en zonder termijn, en
 * dat is precies wat PRE_CONSENT_DAYS opruimt als er niets mee gebeurt.
 *
 * De uitnodiging gaat per mail én als link op het scherm. Niet uit
 * besluiteloosheid: de mail is de normale weg, en de link is er voor de keer dat
 * hij in een spamfilter hangt terwijl de atleet naast je staat. Een uitnodiging
 * die alleen per mail kan, maakt van een verkeerd ingestelde SMTP een reden dat
 * een intake niet doorgaat.
 */

export interface InviteResult {
  athleteId: string;
  userId: string;
  /** Een link waarmee hij binnenkomt, om door te geven als de mail niet aankomt. */
  link: string | null;
  /** Of de uitnodigingsmail eruit is. Bij false is de link de enige weg. */
  mailed: boolean;
}

export type InviteOutcome =
  | { ok: true; invite: InviteResult }
  | { ok: false; error: string };

function authAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL ontbreekt");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function findUserByEmail(email: string): Promise<string | null> {
  const wanted = email.trim().toLowerCase();
  const users = await authAdmin().auth.admin.listUsers({ perPage: 200 });
  return users.data?.users.find((user) => user.email?.toLowerCase() === wanted)?.id ?? null;
}

/**
 * Nodigt uit, en zorgt dat er een account en een dossier klaarstaan.
 *
 * De volgorde is niet willekeurig. Eerst de mail proberen, want die aanroep
 * maakt de gebruiker én verstuurt in één keer. Lukt het versturen niet, dan
 * maken we de gebruiker alsnog aan zonder mail: een praktijk zonder werkende
 * SMTP hoort een atleet nog steeds te kunnen uitnodigen, met de link in de hand.
 *
 * Er wordt geen wachtwoord gezet. Hij komt binnen via de link en kiest er zelf
 * een op zijn profiel, en zo staat er nergens een wachtwoord dat iemand anders
 * ook kent.
 */
/**
 * De link die we doorgeven, gebouwd op onze eigen callback.
 *
 * Niet het `action_link` dat generateLink teruggeeft, en dat is geen detail: dat
 * adres wijst naar /auth/v1/verify van Supabase, en dat endpoint zet de tokens
 * in de fragment van de URL (`#access_token=...`). Een fragment wordt door een
 * browser nooit naar de server gestuurd, dus /auth/callback is een serverroute
 * die per definitie niets ziet. Getest: de callback werd geraakt zonder `code`
 * en zonder `token_hash`, en stuurde netjes door naar het inlogscherm.
 *
 * `hashed_token` is wel serverzijdig in te wisselen, met verifyOtp, en dat is
 * precies de variant die /auth/callback al ondersteunt.
 */
function callbackLink(origin: string, hashedToken: string | undefined): string | null {
  if (!hashedToken) return null;
  const url = new URL(`${origin}/auth/callback`);
  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", "magiclink");
  url.searchParams.set("next", "/home");
  return url.toString();
}

export async function inviteAthlete(input: {
  email: string;
  fullName: string | null;
  locale: Locale;
  /** De behandelaar die uitnodigt. Meteen de toewijzing, want die weet hij nu. */
  practitionerId: string;
  /** De basis waar de link naar terugwijst, bijvoorbeeld https://intake.praktijk.be. */
  origin: string;
}): Promise<InviteOutcome> {
  const admin = authAdmin();
  const email = input.email.trim();

  if (await findUserByEmail(email)) {
    // Geen uitnodiging bovenop een bestaand account. Dat zou een tweede dossier
    // opleveren voor iemand die er al een heeft, en dat is precies het soort
    // dubbele dat later niemand meer uit elkaar haalt.
    return { ok: false, error: "That email address already has an account here." };
  }

  // Waar hij uitkomt na het klikken: de consentpoort staat voor /home, dus dat
  // is het enige adres dat hier nodig is.
  const redirectTo = `${input.origin}/auth/callback?next=/home`;

  const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

  let userId = invited.data?.user?.id ?? null;
  let mailed = invited.error === null;

  if (!userId) {
    // De mail ging niet weg. Meestal geen SMTP ingesteld, en dat mag geen reden
    // zijn om de uitnodiging niet te kunnen doen: het account komt er, de link
    // hieronder is dan de weg naar binnen.
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) {
      return {
        ok: false,
        error: created.error?.message ?? "could not create the account",
      };
    }
    userId = created.data.user.id;
    mailed = false;
  }

  // De kopieerbare link, los van de mail. Een magic link en geen invite-link:
  // die tweede is al opgebruikt door de mail hierboven, en twee links voor
  // hetzelfde account is één link te veel om uit te leggen.
  const generated = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });

  const db = appDb();

  const { error: profileError } = await db.from("profiles").upsert(
    { id: userId, role: "athlete", full_name: input.fullName, locale: input.locale },
    { onConflict: "id" },
  );

  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, error: `profiel opslaan mislukt: ${profileError.message}` };
  }

  const { data: athlete, error } = await db
    .from("athletes")
    .insert({
      profile_id: userId,
      full_name: input.fullName,
      email,
      locale: input.locale,
      practitioner_id: input.practitionerId,
      retention_mode: "until_date",
      // Dezelfde voorlopige termijn als bij zelfaanmelding. Geeft hij nooit
      // consent, dan ruimt de retentiejob dit op: een uitnodiging die niemand
      // aanneemt hoort niet als dossier te blijven staan.
      retention_until: preConsentUntil(),
    })
    .select("id")
    .single();

  if (error || !athlete) {
    await db.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, error: `atleet aanmaken mislukt: ${error?.message}` };
  }

  return {
    ok: true,
    invite: {
      athleteId: athlete.id as string,
      userId,
      link: callbackLink(input.origin, generated.data?.properties?.hashed_token),
      mailed,
    },
  };
}
