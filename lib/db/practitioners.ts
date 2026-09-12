import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { appDb } from "@/lib/supabase/service";

/**
 * Het team van de praktijk: wie er behandelt, en wie er niet meer.
 *
 * Dit stond alleen in scripts/create-coach.ts, en dat betekende dat een nieuwe
 * kinesist aannemen een ontwikkelaar met databanktoegang vroeg. Voor een
 * praktijk die af en toe iemand aanneemt is dat geen werkbare afspraak, en het
 * is ook de verkeerde persoon: wie er behandelt is een beslissing van de
 * praktijk.
 *
 * Wat hier NIET gebeurt is zelfregistratie. Een behandelaar wordt aangemaakt
 * door een admin die al binnen is; er is geen formulier dat iemand kan vinden.
 * Dat was het uitgangspunt van het script en het blijft het uitgangspunt van
 * dit scherm.
 *
 * Verwijderen bestaat niet, archiveren wel. Een behandelaar die vertrekt staat
 * op dossiers die hij behandeld heeft, en dat is geschiedenis: die naam hoort
 * te blijven staan. Zie 20260910140000_practitioner_archive.sql.
 */

export type PractitionerKind = "physio" | "coach";

export interface TeamMember {
  id: string;
  fullName: string | null;
  email: string | null;
  role: "coach" | "admin";
  kind: PractitionerKind | null;
  archivedAt: string | null;
  /** Hoeveel atleten op dit moment aan deze behandelaar hangen. */
  athletes: number;
}

/**
 * Een leesbaar wachtwoord, lang genoeg om niet te raden.
 *
 * Zelfde alfabet en dezelfde lengte als scripts/create-coach.ts: geen tekens
 * die in een mail of een terminal verminken. Hier staat het één keer op het
 * scherm van de admin, en daarna nergens meer.
 */
export function generatePassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/**
 * Een client met de admin-API van Auth erbij.
 *
 * appDb() volstaat niet: die praat met PostgREST, en gebruikers leven in
 * `auth.users`, waar geen enkele applicatierol bij mag. De service role heeft
 * daar wel een eigen API voor.
 */
function authAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL ontbreekt");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Het hele team, gearchiveerde leden inbegrepen.
 *
 * Het e-mailadres komt uit `auth.users` via de admin-API en niet uit
 * `profiles`: dat is waar het staat, en het dupliceren zou betekenen dat een
 * adreswijziging op twee plekken moet gebeuren. Met een handvol behandelaars is
 * één lijstoproep goedkoper dan een kolom die uit de pas kan lopen.
 */
export async function listTeam(): Promise<TeamMember[]> {
  const db = appDb();

  const [profiles, athletes, users] = await Promise.all([
    db
      .from("profiles")
      .select("id, full_name, role, practitioner_kind, archived_at")
      .in("role", ["coach", "admin"])
      .order("full_name"),
    db.from("athletes").select("practitioner_id").is("deleted_at", null),
    authAdmin().auth.admin.listUsers({ perPage: 200 }),
  ]);

  if (profiles.error) throw new Error(`team ophalen mislukt: ${profiles.error.message}`);

  const counts = new Map<string, number>();
  for (const row of athletes.data ?? []) {
    const id = row.practitioner_id as string | null;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const emails = new Map<string, string>();
  for (const user of users.data?.users ?? []) {
    if (user.email) emails.set(user.id, user.email);
  }

  return (profiles.data ?? []).map((row) => ({
    id: row.id as string,
    fullName: (row.full_name as string | null) ?? null,
    email: emails.get(row.id as string) ?? null,
    role: row.role as TeamMember["role"],
    kind: (row.practitioner_kind as PractitionerKind | null) ?? null,
    archivedAt: (row.archived_at as string | null) ?? null,
    athletes: counts.get(row.id as string) ?? 0,
  }));
}

export type CreateResult =
  | { ok: true; id: string; password: string }
  | { ok: false; error: string };

/**
 * Een behandelaar aanmaken: gebruiker in Auth, rij in profiles.
 *
 * Twee stappen, want er hangt geen trigger aan auth.users. Zonder die tweede
 * stap kan iemand inloggen en ziet hij niets, want checkCoach() leest de rol uit
 * profiles en niet uit het token.
 *
 * Het wachtwoord wordt hier gezet en één keer teruggegeven. Geen
 * uitnodigingsmail: die zou het aanmaken laten afhangen van een mailserver, en
 * een behandelaar die niet binnen kan omdat een mail in een spamfilter hangt is
 * een slechter startpunt dan een wachtwoord dat de praktijk zelf doorgeeft. Hij
 * kan het daarna zelf wijzigen, en de herstelmail bestaat voor wie hem kwijt is.
 */
export async function createPractitioner(input: {
  email: string;
  fullName: string;
  kind: PractitionerKind;
}): Promise<CreateResult> {
  const admin = authAdmin();

  // Meteen bevestigd: de praktijk maakt het account aan, dus wachten op een
  // bevestigingsmail zit alleen in de weg.
  const password = generatePassword();
  const created = await admin.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
  });

  if (created.error || !created.data.user) {
    // Bestaat het adres al, dan is dit geen scherm om een wachtwoord mee te
    // overschrijven: dat is een ander soort handeling met een ander risico.
    return {
      ok: false,
      error: created.error?.message ?? "gebruiker aanmaken mislukt",
    };
  }

  const userId = created.data.user.id;

  const { error } = await appDb().from("profiles").upsert({
    id: userId,
    role: "coach",
    full_name: input.fullName,
    locale: "nl",
    practitioner_kind: input.kind,
  });

  if (error) {
    // De gebruiker bestaat nu wel en het profiel niet, en dan kan hij inloggen
    // zonder iets te zien. Terugdraaien is hier beter dan een half account.
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, error: `profiel opslaan mislukt: ${error.message}` };
  }

  return { ok: true, id: userId, password };
}

/**
 * Vakgebied of archiefstatus bijwerken.
 *
 * De rol blijft buiten dit scherm. Iemand tot admin promoveren is een andere
 * beslissing dan hem als kinesist inschrijven, en het is de enige handeling
 * hier die iemand meer rechten geeft; die blijft bij het script.
 */
export async function updatePractitioner(input: {
  id: string;
  kind?: PractitionerKind | null;
  archived?: boolean;
}): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.kind !== undefined) patch.practitioner_kind = input.kind;
  if (input.archived !== undefined) {
    patch.archived_at = input.archived ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) return;

  const { error } = await appDb()
    .from("profiles")
    .update(patch)
    .eq("id", input.id)
    .in("role", ["coach", "admin"]);

  if (error) throw new Error(`behandelaar bijwerken mislukt: ${error.message}`);
}

/**
 * De behandelaar van een atleet zetten of weghalen, vanaf de coachkant.
 *
 * De atleet kiest zelf op zijn profiel, en de praktijk kan het corrigeren. Dat
 * is met opzet geen tweede kolom: één veld met één antwoord, en het audit-log
 * zegt wie het voor het laatst veranderde. Twee velden ("gewenst" en
 * "toegewezen") zouden een vraag opleveren die niemand stelt zolang er drie
 * behandelaars zijn.
 *
 * Gearchiveerde behandelaars mogen hier wél gekozen worden: de coach weet wat
 * hij doet, en een dossier terugzetten op wie het behandeld heeft is een
 * legitieme correctie. De keuzelijst van de ATLEET toont ze niet.
 */
export async function setAthletePractitioner(input: {
  athleteId: string;
  practitionerId: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (input.practitionerId !== null) {
    const { data } = await appDb()
      .from("profiles")
      .select("id")
      .eq("id", input.practitionerId)
      .in("role", ["coach", "admin"])
      .not("practitioner_kind", "is", null)
      .maybeSingle();

    if (!data) return { ok: false, error: "unknown practitioner" };
  }

  const { error } = await appDb()
    .from("athletes")
    .update({ practitioner_id: input.practitionerId })
    .eq("id", input.athleteId)
    .is("deleted_at", null);

  if (error) throw new Error(`toewijzing opslaan mislukt: ${error.message}`);
  return { ok: true };
}
