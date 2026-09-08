import { query } from "@/lib/db/sql";
import { appDb } from "@/lib/supabase/service";
import { listIntakesForCoach, type IntakeListRow } from "@/lib/db/review";

/**
 * De atleet als geheel, voor de coach.
 *
 * Tot nu bestond er alleen een intake-scherm, en dat wringt: een atleet met drie
 * intakes was drie losse dingen zonder iets dat hem als persoon toont. Vandaar
 * een lijst met namen en per naam een profiel.
 *
 * Wat hier NIET in staat is even bewust als wat er wel in staat: geen lengte,
 * geen gewicht, geen klachten, geen blessures. Alles wat `is_medical` heeft in
 * de taxonomie blijft in het dossier achter de intake. Dit is een pagina die je
 * openlaat terwijl er iemand naast je zit, net als het overzicht.
 *
 * (Hier hoort straks ook het verwijderpad, want wissen is een handeling op een
 * atleet en niet op een intake. Zie stap B3 in docs/plan.md.)
 */

export interface AthleteListRow {
  id: string;
  name: string | null;
  intakeCount: number;
  /** Ingediend en nog niet afgetekend: dit wacht op de coach. */
  waiting: number;
  conflicts: number;
  lastActivity: string | null;
}

function isWaiting(intake: IntakeListRow): boolean {
  return intake.status === "submitted" || intake.status === "in_review";
}

function activityOf(intake: IntakeListRow): string | null {
  return intake.submittedAt ?? intake.startedAt;
}

/**
 * Eén regel per atleet, nieuwste activiteit boven.
 *
 * Gebouwd op listIntakesForCoach en niet op een tweede query: die rekent de
 * standen al in SQL uit en is getest. Met een handvol atleten is groeperen in
 * TypeScript goedkoper dan een tweede versie van dezelfde telling, die uit de
 * pas kan gaan lopen.
 */
export async function listAthletesForCoach(): Promise<AthleteListRow[]> {
  const intakes = await listIntakesForCoach();
  const byAthlete = new Map<string, AthleteListRow>();

  for (const intake of intakes) {
    const existing = byAthlete.get(intake.athleteId);
    const row =
      existing ??
      {
        id: intake.athleteId,
        name: null,
        intakeCount: 0,
        waiting: 0,
        conflicts: 0,
        lastActivity: null as string | null,
      };

    row.intakeCount += 1;
    if (isWaiting(intake)) row.waiting += 1;
    row.conflicts += intake.conflicts;
    // De naam kan per intake verschillen: uit het account, of uit het dossier
    // van die ene intake. De lijst komt op nieuwste-eerst binnen, dus de eerste
    // die iets weet is de meest recente.
    row.name = row.name ?? intake.athleteName;

    const activity = activityOf(intake);
    if (activity && (!row.lastActivity || activity > row.lastActivity)) {
      row.lastActivity = activity;
    }

    if (!existing) byAthlete.set(intake.athleteId, row);
  }

  return [...byAthlete.values()].sort((a, b) => {
    if (a.lastActivity === b.lastActivity) return 0;
    if (!a.lastActivity) return 1;
    if (!b.lastActivity) return -1;
    return a.lastActivity > b.lastActivity ? -1 : 1;
  });
}

export interface AthleteProfile {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  club: string | null;
  federation: string | null;
  sport: string | null;
  discipline: string | null;
  coachName: string | null;
  /** Heeft deze atleet zelf een inlog, of bestaat hij alleen als dossier. */
  hasAccount: boolean;
  retentionMode: string;
  retentionBasis: string | null;
  retentionUntil: string | null;
  accountConsentAt: string | null;
  intakes: IntakeListRow[];
}

/**
 * De niet-medische identiteitsvelden zoals de intakes ze kennen.
 *
 * Zelfde terugvalgedachte als in het reviewscherm: public.athletes wordt alleen
 * bij het aanmaken van een account gevuld, dus een atleet die via documenten
 * binnenkwam heeft daar niets staan terwijl het dossier het wel weet.
 *
 * `is_medical` filtert hard, zodat er nooit per ongeluk een medisch veld op deze
 * pagina belandt als de taxonomie ooit uitbreidt. Tegenstrijdige waarden blijven
 * eruit: dat hoort de coach in het dossier op te lossen, niet als feit op een
 * profiel te zien.
 */
async function identityFromDossier(athleteId: string): Promise<Map<string, string>> {
  const rows = await query<{ field_key: string; value: unknown }>(
    `select distinct on (f.field_key) f.field_key, f.value
       from medical.dossier_fields f
       join public.field_definitions d
         on d.key = f.field_key and d.section = 'identity' and not d.is_medical
       join public.intakes i on i.id = f.intake_id
      where i.athlete_id = $1
        and f.value is not null
        and f.status not in ('missing', 'conflicting')
      order by f.field_key, i.submitted_at desc nulls last, i.started_at desc`,
    [athleteId],
  );

  const values = new Map<string, string>();
  for (const row of rows) {
    const value = Array.isArray(row.value) ? row.value.join(", ") : row.value;
    if (typeof value === "string" && value.trim() !== "") {
      values.set(row.field_key, value);
    } else if (typeof value === "number") {
      values.set(row.field_key, String(value));
    }
  }
  return values;
}

export async function getAthleteProfile(
  athleteId: string,
): Promise<AthleteProfile | null> {
  const { data: athlete, error } = await appDb()
    .from("athletes")
    .select(
      "id, profile_id, full_name, email, phone, club, federation, retention_mode, retention_basis, retention_until",
    )
    .eq("id", athleteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !athlete) return null;

  const [dossier, allIntakes, consent] = await Promise.all([
    identityFromDossier(athleteId),
    listIntakesForCoach(),
    appDb()
      .from("consents")
      .select("granted_at")
      .eq("athlete_id", athleteId)
      .is("intake_id", null)
      .is("withdrawn_at", null)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const pick = (column: unknown, fieldKey: string): string | null =>
    (typeof column === "string" && column.trim() !== "" ? column : null) ??
    dossier.get(fieldKey) ??
    null;

  return {
    id: athlete.id as string,
    name: pick(athlete.full_name, "identity.full_name"),
    email: pick(athlete.email, "identity.email"),
    phone: pick(athlete.phone, "identity.phone"),
    club: pick(athlete.club, "identity.club"),
    federation: pick(athlete.federation, "identity.federation"),
    sport: dossier.get("identity.sport") ?? null,
    discipline: dossier.get("identity.discipline") ?? null,
    coachName: dossier.get("identity.coach_name") ?? null,
    hasAccount: athlete.profile_id !== null,
    retentionMode: athlete.retention_mode as string,
    retentionBasis: (athlete.retention_basis as string | null) ?? null,
    retentionUntil: (athlete.retention_until as string | null) ?? null,
    accountConsentAt: (consent.data?.granted_at as string | null) ?? null,
    intakes: allIntakes.filter((intake) => intake.athleteId === athleteId),
  };
}
