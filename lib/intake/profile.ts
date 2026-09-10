import { z } from "zod";
import { appDb } from "@/lib/supabase/service";

/**
 * Het profiel van de atleet: zijn eigen gegevens, en bij wie hij hoort.
 *
 * Twee dingen die geen intake-eigenschap zijn. Een adres verandert niet per
 * dossier, en de behandelaar die je toegewezen krijgt ook niet. Ze horen dus bij
 * de persoon in `public.athletes`, naast naam en telefoon, en niet in de
 * taxonomie.
 *
 * De keuzelijst met behandelaars wordt hier server-side opgehaald en niet via
 * een endpoint. Dat is dezelfde afweging als op het thuisscherm: de
 * RLS-policy `profiles_select_self` laat een atleet alleen zijn eigen profiel
 * lezen, en dat hoort zo te blijven. Een lijst met namen van de praktijk is
 * geen geheim, maar de tabel eromheen wel: daar staan e-mailadressen en rollen
 * in. Vandaar een expliciete projectie van drie velden in plaats van een
 * policy die de hele tabel opentrekt.
 */

export interface PractitionerOption {
  id: string;
  name: string;
  kind: "physio" | "coach";
  initials: string;
}

export interface AthleteProfileValues {
  fullName: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2, hoofdletters. */
  country: string | null;
  practitionerId: string | null;
}

export interface ProfileData {
  email: string | null;
  values: AthleteProfileValues;
  practitioners: PractitionerOption[];
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

/**
 * Iedereen met een vakgebied, op naam gesorteerd.
 *
 * Twee voorwaarden: een vakgebied (dat maakt iemand een behandelaar) en niet
 * gearchiveerd (dat maakt hem beschikbaar). Die stonden eerst in één kolom,
 * met het argument dat twee schakelaars voor één beslissing uit de pas gaan
 * lopen. Ze zijn geen één beslissing: wie vertrekt moet uit deze lijst
 * verdwijnen zonder zijn discipline te verliezen op de dossiers die hij al
 * behandeld heeft. Zie 20260910140000_practitioner_archive.sql.
 */
export async function listPractitioners(): Promise<PractitionerOption[]> {
  const { data, error } = await appDb()
    .from("profiles")
    .select("id, full_name, practitioner_kind")
    .not("practitioner_kind", "is", null)
    .is("archived_at", null)
    .order("full_name");

  if (error) throw new Error(`behandelaars ophalen mislukt: ${error.message}`);

  return (data ?? [])
    .map((row) => {
      // Een behandelaar zonder naam is voor de atleet niet te kiezen: "?" in
      // een lijstje is geen keuze. create-coach.ts zet de naam, dus dit is een
      // half aangemaakt account en dat hoort hier niet te verschijnen.
      const name = (row.full_name as string | null)?.trim();
      if (!name) return null;

      return {
        id: row.id as string,
        name,
        kind: row.practitioner_kind as PractitionerOption["kind"],
        initials: initialsOf(name),
      };
    })
    .filter((option): option is PractitionerOption => option !== null);
}

export async function loadProfile(input: {
  athleteId: string;
  email: string | null;
}): Promise<ProfileData> {
  const [athlete, practitioners] = await Promise.all([
    appDb()
      .from("athletes")
      .select("full_name, email, street, postal_code, city, country, practitioner_id")
      .eq("id", input.athleteId)
      .is("deleted_at", null)
      .maybeSingle(),
    listPractitioners(),
  ]);

  if (athlete.error) {
    throw new Error(`profiel ophalen mislukt: ${athlete.error.message}`);
  }

  const row = athlete.data;

  return {
    email: (row?.email as string | null) ?? input.email,
    values: {
      fullName: (row?.full_name as string | null) ?? null,
      street: (row?.street as string | null) ?? null,
      postalCode: (row?.postal_code as string | null) ?? null,
      city: (row?.city as string | null) ?? null,
      country: (row?.country as string | null) ?? null,
      practitionerId: (row?.practitioner_id as string | null) ?? null,
    },
    practitioners,
  };
}

/**
 * Het adres als één regel, of null als er niets staat.
 *
 * Voor schermen die het adres tonen en niet bewerken. Half ingevulde adressen
 * zijn de regel en niet de uitzondering (iemand vult een gemeente in en de rest
 * niet), dus lege delen vallen weg in plaats van een komma achter te laten.
 */
export function formatAddress(values: {
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}): string | null {
  const locality = [values.postalCode, values.city]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");

  const parts = [values.street?.trim(), locality, values.country?.trim()].filter(
    (part): part is string => Boolean(part),
  );

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Wat de atleet mag insturen.
 *
 * Leeg is hier niet hetzelfde als weggelaten, en dat is de reden dat dit een
 * eigen schema heeft in plaats van een handvol `?? null`. Wie een veld leegmaakt
 * en opslaat, bedoelt "dit weet ik niet meer": dat wordt null in de kolom, en
 * niet een lege string die in een rapport als een lege regel doorkomt.
 *
 * Het land gaat naar hoofdletters voordat de check-constraint eraan te pas komt.
 * "be" intypen is geen fout van de atleet.
 */
const inputSchema = z.object({
  fullName: z.string().trim().max(120).optional(),
  street: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(120).optional(),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => value === "" || /^[A-Z]{2}$/.test(value), {
      message: "country must be a two-letter country code",
    })
    .optional(),
  // Null en de lege string betekenen allebei "geen behandelaar gekozen". De
  // radiogroep stuurt "" terug, JSON-clients eerder null.
  practitionerId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
});

export type ProfileInput = z.input<typeof inputSchema>;

export type ParseResult =
  | { ok: true; values: AthleteProfileValues }
  | { ok: false; error: string };

const blankToNull = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value;

/**
 * Body omzetten naar kolomwaarden, of een leesbare weigering.
 *
 * `known` is de verzameling id's uit de keuzelijst. De databank kan niet
 * afdwingen dat `practitioner_id` naar staf wijst (een foreign key kan niet op
 * een gefilterde verzameling wijzen), dus dat gebeurt hier, tegen precies
 * dezelfde lijst die de atleet te zien kreeg.
 */
export function parseProfileInput(body: unknown, known: Set<string>): ParseResult {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" };
  }

  const value = parsed.data;
  const practitionerId =
    value.practitionerId === undefined || value.practitionerId === null || value.practitionerId === ""
      ? null
      : value.practitionerId;

  if (practitionerId !== null && !known.has(practitionerId)) {
    return { ok: false, error: "unknown practitioner" };
  }

  return {
    ok: true,
    values: {
      fullName: blankToNull(value.fullName),
      street: blankToNull(value.street),
      postalCode: blankToNull(value.postalCode),
      city: blankToNull(value.city),
      country: blankToNull(value.country),
      practitionerId,
    },
  };
}

/**
 * Opslaan, met de service role.
 *
 * `athletes_write` is alleen voor staf, dus een atleet kan zijn eigen rij niet
 * bijwerken vanuit de browser. Dat blijft zo: het filter op id doet hier het
 * werk dat RLS anders zou doen, en het id komt uit de sessie en niet uit de
 * body.
 *
 * De naam gaat ook naar `profiles`. Twee kolommen met dezelfde naam is niet
 * mooi, maar ze bestaan allebei al en ze worden allebei gelezen (het profiel bij
 * het inloggen, de atleet in het coachscherm). Eentje bijwerken en de andere
 * laten staan levert een atleet op die onder twee namen door het systeem loopt.
 */
export async function saveProfile(input: {
  athleteId: string;
  userId: string;
  values: AthleteProfileValues;
}): Promise<void> {
  const db = appDb();

  const { error } = await db
    .from("athletes")
    .update({
      full_name: input.values.fullName,
      street: input.values.street,
      postal_code: input.values.postalCode,
      city: input.values.city,
      country: input.values.country,
      practitioner_id: input.values.practitionerId,
    })
    .eq("id", input.athleteId)
    .is("deleted_at", null);

  if (error) throw new Error(`profiel opslaan mislukt: ${error.message}`);

  const { error: profileError } = await db
    .from("profiles")
    .update({ full_name: input.values.fullName })
    .eq("id", input.userId);

  if (profileError) {
    throw new Error(`naam in profiel opslaan mislukt: ${profileError.message}`);
  }
}
