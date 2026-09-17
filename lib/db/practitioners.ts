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

/**
 * Wat iemand mag, los van wat hij doet.
 *
 * Dit hoorde hier bewust niet thuis: promoveren tot admin bleef bij het script,
 * omdat het de handeling is die bepaalt wie er collega's kan aanmaken. Dat werkt
 * zolang er iemand met databanktoegang meekijkt, en het werkt niet meer zodra de
 * praktijk zelf een tweede beheerder nodig heeft omdat de eerste met vakantie
 * is. Een beheerder die niemand kan aanstellen is een enkel punt van falen met
 * een telefoonnummer eraan.
 *
 * Het is nu een keuze op het teamscherm, met twee grendels die het script niet
 * had: niemand zet zijn eigen beheerdersrol af, en de laatste actieve beheerder
 * blijft staan. Zie blockedTeamChange().
 */
export type PractitionerRole = "coach" | "admin";

export interface TeamMember {
  id: string;
  fullName: string | null;
  email: string | null;
  role: PractitionerRole;
  kind: PractitionerKind | null;
  archivedAt: string | null;
  /** Hoeveel atleten op dit moment aan deze behandelaar hangen. */
  athletes: number;
}

/**
 * De toestand van het team waar de grendels naar kijken.
 *
 * Een eigen, kleine vorm en niet TeamMember: deze controle heeft niets aan
 * e-mailadressen of atleetaantallen, en met een minimale vorm is hij te draaien
 * zonder databank. Zie evals/unit/team-roles.test.ts.
 */
export interface TeamRoleState {
  id: string;
  role: PractitionerRole;
  archivedAt: string | null;
}

export interface TeamChange {
  id: string;
  role?: PractitionerRole;
  archived?: boolean;
}

/**
 * Zegt waarom een wijziging niet mag, of null als ze mag.
 *
 * Er zijn twee manieren om een praktijk uit haar eigen beheerscherm te sluiten,
 * en allebei zijn ze een ongelukje van één klik. Iemand zet zijn eigen
 * beheerdersrol af en kan het scherm niet meer openen om hem terug te zetten. Of
 * de enige beheerder wordt gearchiveerd, en dan kan niemand nog een behandelaar
 * aanmaken. Er is geen scherm dat dat repareert: dan is het weer het script, en
 * dus iemand met databanktoegang.
 *
 * Archiveren viel hier tot nu toe buiten, en dat was een gat dat al bestond: die
 * knop stond er al en kon de laatste beheerder wel degelijk wegzetten.
 */
export function blockedTeamChange(input: {
  team: TeamRoleState[];
  actorId: string;
  change: TeamChange;
}): string | null {
  const target = input.team.find((member) => member.id === input.change.id);
  if (!target) return "That team member no longer exists.";

  // Eerst de twee gevallen over jezelf, want die hebben een antwoord dat zegt
  // wat er aan de hand is. De telling hieronder zou hetzelfde tegenhouden met
  // een reden die naast de schoen zit.
  const self = target.id === input.actorId;
  if (self && input.change.role === "coach") {
    return "You cannot take away your own administrator role.";
  }
  if (self && input.change.archived === true) {
    return "You cannot archive your own account.";
  }

  const after = input.team.map((member) =>
    member.id === target.id
      ? {
          ...member,
          role: input.change.role ?? member.role,
          archivedAt:
            input.change.archived === undefined
              ? member.archivedAt
              : input.change.archived
                ? new Date().toISOString()
                : null,
        }
      : member,
  );

  const admins = after.filter(
    (member) => member.role === "admin" && member.archivedAt === null,
  );
  if (admins.length === 0) {
    return "The practice needs at least one active administrator.";
  }

  return null;
}

/**
 * Alleen wat de grendel nodig heeft.
 *
 * listTeam() doet drie aanvragen waarvan één naar de admin-API voor
 * e-mailadressen, en een controle op rollen heeft daar niets aan.
 */
export async function listTeamRoles(): Promise<TeamRoleState[]> {
  const { data, error } = await appDb()
    .from("profiles")
    .select("id, role, archived_at")
    .in("role", ["coach", "admin"]);

  if (error) throw new Error(`team ophalen mislukt: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    role: row.role as PractitionerRole,
    archivedAt: (row.archived_at as string | null) ?? null,
  }));
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

/**
 * Een account dat er al blijkt te zijn.
 *
 * Genoeg om de admin te laten zien wie hij voor zich heeft voordat hij iemand
 * rechten geeft. Dat dit bestaat is op zich al informatie ("heeft dit adres hier
 * een account"), maar dit scherm zit achter een adminlogin en de admin typte het
 * adres zelf in; blind promoveren is het grotere risico.
 */
export interface ExistingAccount {
  id: string;
  fullName: string | null;
  role: "coach" | "athlete" | "admin";
  /** Heeft deze persoon ook een dossier als atleet in deze praktijk. */
  athlete: boolean;
}

/**
 * Zoekt een bestaand account op adres.
 *
 * Via listUsers en niet via de foutmelding van createUser: die tekst is van
 * Supabase en kan tussen versies veranderen, en een controle die op een zin
 * leunt gaat stil kapot. Wie er echt staat is een feit dat we kunnen opvragen.
 */
async function findAccountByEmail(email: string): Promise<ExistingAccount | null> {
  const wanted = email.trim().toLowerCase();
  const users = await authAdmin().auth.admin.listUsers({ perPage: 200 });
  const match = users.data?.users.find((user) => user.email?.toLowerCase() === wanted);
  if (!match) return null;

  const db = appDb();
  const [profile, athlete] = await Promise.all([
    db.from("profiles").select("full_name, role").eq("id", match.id).maybeSingle(),
    db
      .from("athletes")
      .select("id")
      .eq("profile_id", match.id)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  return {
    id: match.id,
    fullName: (profile.data?.full_name as string | null) ?? null,
    role: (profile.data?.role as ExistingAccount["role"]) ?? "athlete",
    athlete: athlete.data !== null,
  };
}

/**
 * Een bestaand account stafrechten geven.
 *
 * Iets anders dan createPractitioner, en met opzet een aparte handeling in
 * plaats van een stille terugval daarvan. Aanmaken raakt iemand die er nog niet
 * was; dit raakt een account dat al bestaat en dat van iemand anders kan zijn
 * dan de admin denkt. Daarom eerst tonen wie het is, dan pas deze aanroep.
 *
 * Het dossier blijft staan. Er wordt geen atleetrij aangeraakt en geen wachtwoord
 * gezet: hij had er al een, en zijn eigen intakes blijven werken omdat
 * currentAthlete() op profile_id zoekt en niet op de rol.
 *
 * De weg terug is archiveren, niet degraderen: de rolkeuze op het teamscherm
 * kent alleen coach en admin, dus iemand terugzetten naar 'atleet zonder staf'
 * kan hier niet. Dat is voorlopig goed genoeg, want vertrekken is wat er in de
 * praktijk gebeurt en daar is archiveren voor.
 */
export async function promoteToPractitioner(input: {
  id: string;
  kind: PractitionerKind;
  role: PractitionerRole;
}): Promise<{ ok: boolean; error?: string }> {
  const db = appDb();

  const { data: existing } = await db
    .from("profiles")
    .select("id, role")
    .eq("id", input.id)
    .maybeSingle();

  if (!existing) return { ok: false, error: "That account no longer exists." };

  // De naam blijft van hem. De admin typte er een in het aanmaakformulier, maar
  // dit account heeft er al een die de persoon zelf heeft opgegeven, en die
  // overschrijven op grond van een formulier dat voor iemand anders bedoeld was
  // is de verkeerde kant op.
  const { error } = await db
    .from("profiles")
    .update({ role: input.role, practitioner_kind: input.kind })
    .eq("id", input.id);

  if (error) throw new Error(`promoveren mislukt: ${error.message}`);
  return { ok: true };
}

export type CreateResult =
  | { ok: true; id: string; password: string }
  | { ok: false; error: string; taken?: ExistingAccount };

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
  role: PractitionerRole;
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
    //
    // Maar "bestaat al" is ook geen eindpunt. Een kinesist die zelf bij deze
    // praktijk in behandeling is heeft een atleetaccount, en dat hoort hem geen
    // collega te beletten te worden: atleet-zijn zit in public.athletes, de rol
    // zegt alleen wat iemand als staf mag. Dus zoeken we op wie het is en geven
    // we dat terug, zodat het scherm kan vragen of die toegang erbij mag.
    const taken = await findAccountByEmail(input.email);
    return {
      ok: false,
      error: created.error?.message ?? "gebruiker aanmaken mislukt",
      ...(taken ? { taken } : {}),
    };
  }

  const userId = created.data.user.id;

  const { error } = await appDb().from("profiles").upsert({
    id: userId,
    role: input.role,
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

export type UpdateResult = { ok: true } | { ok: false; error: string };

/**
 * Vakgebied, rol of archiefstatus bijwerken.
 *
 * De rol bleef hier eerst buiten: iemand tot admin promoveren is een andere
 * beslissing dan hem als kinesist inschrijven, en het is de enige handeling hier
 * die iemand meer rechten geeft. Dat argument zegt dat er een grendel omheen
 * hoort, niet dat het scherm het niet mag; zonder scherm hangt de praktijk vast
 * aan wie er databanktoegang heeft.
 *
 * De grendel staat hier en niet in de route, want een tweede aanroeper hoort
 * hem ook te krijgen. Vandaar ook actorId als verplichte parameter: zonder te
 * weten wie het doet is "je zet je eigen rol niet af" niet te controleren.
 */
export async function updatePractitioner(input: {
  id: string;
  actorId: string;
  kind?: PractitionerKind | null;
  role?: PractitionerRole;
  archived?: boolean;
}): Promise<UpdateResult> {
  const patch: Record<string, unknown> = {};
  if (input.kind !== undefined) patch.practitioner_kind = input.kind;
  if (input.role !== undefined) patch.role = input.role;
  if (input.archived !== undefined) {
    patch.archived_at = input.archived ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  // Alleen ophalen wanneer er iets verandert dat de praktijk kan buitensluiten.
  // Een vakgebied wijzigen raakt de beheerders niet, en dat is de veruit meest
  // voorkomende wijziging op dit scherm.
  if (input.role !== undefined || input.archived !== undefined) {
    const blocked = blockedTeamChange({
      team: await listTeamRoles(),
      actorId: input.actorId,
      change: { id: input.id, role: input.role, archived: input.archived },
    });
    if (blocked) return { ok: false, error: blocked };
  }

  const { error } = await appDb()
    .from("profiles")
    .update(patch)
    .eq("id", input.id)
    .in("role", ["coach", "admin"]);

  if (error) throw new Error(`behandelaar bijwerken mislukt: ${error.message}`);
  return { ok: true };
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
