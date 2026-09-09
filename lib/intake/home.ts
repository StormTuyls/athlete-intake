import { query } from "@/lib/db/sql";
import { sectionLabel } from "@/lib/intake/sections";
import { intakeTitles } from "@/lib/db/intakeTitle";
import type { IntakeTitle } from "@/lib/intake/title";
import type { Locale } from "@/lib/i18n/locale";

/**
 * Wat het thuisscherm van de atleet nodig heeft.
 *
 * Met een titel per intake, zoals in het ontwerp ("Shoulder — right"). Dit
 * stond hier eerst zonder, met het argument dat een lichaamsdeel op een
 * overzichtspagina meekijkbaar is in een kleedkamer. Dat argument is echt maar
 * het verloor: drie regels "Intake" onder elkaar zijn onbruikbaar, en dit is je
 * eigen dossier op je eigen scherm achter je eigen login. Zie lib/intake/title.ts
 * voor waar de titel vandaan komt en waar hij met opzet niet verschijnt.
 *
 * De voortgang komt uit dezelfde telling als de ring in het gesprek: secties
 * zonder verplicht gat en zonder conflict. Twee plekken die hetzelfde getal
 * anders berekenen is precies hoe een voortgangsbalk gaat liegen.
 */

export interface HomeIntake {
  id: string;
  status: "draft" | "submitted" | "in_review" | "approved";
  startedAt: string | null;
  submittedAt: string | null;
  sectionsDone: number;
  sectionsTotal: number;
  requiredFilled: number;
  requiredTotal: number;
  /** De sectie waar de assistent verder zou gaan. Null als alles beantwoord is. */
  nextSection: string | null;
  /**
   * Waar deze intake over gaat. Onopgemaakt, want de woorden eromheen hangen
   * aan de taal van de kijker en niet aan het dossier.
   */
  title: IntakeTitle;
}

export interface HomeData {
  /** Naam om te groeten. Zie displayName voor waar hij vandaan komt. */
  displayName: string | null;
  initials: string;
  inProgress: HomeIntake | null;
  recent: HomeIntake[];
}

/**
 * Hoe de atleet begroet wordt voordat zijn naam bekend is.
 *
 * Het aanmeldscherm vraagt alleen e-mail en wachtwoord, zoals in het ontwerp,
 * dus bij de eerste keer inloggen is er nog geen naam: die komt uit de
 * consent-stap of uit een document. "Good evening, there" is dan de uitkomst,
 * en dat leest als een bug.
 *
 * Het lokale deel van het eigen e-mailadres is geen verzinsel en geen gegeven
 * van iemand anders, dus dat is de terugval. Zodra de echte naam bekend is,
 * wint die.
 */
function displayName(fullName: string | null, email: string | null): string | null {
  if (fullName?.trim()) return fullName.trim();
  if (!email) return null;

  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return null;

  return local
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function initialsOf(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

interface Row {
  id: string;
  status: HomeIntake["status"];
  started_at: Date | null;
  submitted_at: Date | null;
  sections_total: string;
  sections_blocked: string;
  required_filled: string;
  required_total: string;
  next_section: string | null;
}

export async function loadHome(input: {
  athleteId: string;
  fullName: string | null;
  email: string | null;
  /** Voor de sectienaam bij "hier gaat het gesprek verder". */
  locale: Locale;
}): Promise<HomeData> {
  // Eén query voor alle intakes van deze atleet. De tellingen gebeuren in SQL,
  // want 41 velden per intake ophalen om ze in TypeScript te tellen is werk dat
  // de databank beter doet.
  const rows = await query<Row>(
    `with field_state as (
       select
         i.id as intake_id,
         i.status,
         i.started_at,
         i.submitted_at,
         d.key,
         d.section,
         d.sort_order,
         d.required,
         -- Zelfde regel als de ring in het gesprek: een sectie doet mee als er
         -- een verplicht veld in zit dat het gesprek kan vullen. consent wordt
         -- bij het aanmaken gevuld en nooit gevraagd, uploads heeft geen enkel
         -- verplicht veld. Zonder deze filter staat de balk op 2 van 7 voordat
         -- de atleet iets heeft gezegd.
         (d.required and d.key not like 'consent.%') as counts_for_progress,
         coalesce(f.status::text, 'missing') as field_status
       from public.intakes i
       cross join public.field_definitions d
       left join medical.dossier_fields f
         on f.intake_id = i.id and f.field_key = d.key
       where i.athlete_id = $1
     )
     select
       intake_id as id,
       min(status::text) as status,
       min(started_at) as started_at,
       min(submitted_at) as submitted_at,
       count(distinct section) filter (where counts_for_progress) as sections_total,
       count(distinct section) filter (
         where counts_for_progress
           and ((required and field_status = 'missing') or field_status = 'conflicting')
       ) as sections_blocked,
       count(*) filter (
         where required and field_status not in ('missing', 'conflicting')
       ) as required_filled,
       count(*) filter (where required) as required_total,
       (array_agg(section order by required desc, sort_order)
         filter (
           where key not like 'consent.%'
             and ((required and field_status = 'missing') or field_status = 'conflicting')
         )
       )[1] as next_section
     from field_state
     group by intake_id
     order by min(started_at) desc`,
    [input.athleteId],
  );

  // Eén tweede query voor alle intakes samen, geen n+1.
  const titles = await intakeTitles(rows.map((row) => row.id));

  const intakes: HomeIntake[] = rows.map((row) => ({
    id: row.id,
    status: row.status,
    startedAt: row.started_at?.toISOString() ?? null,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    sectionsDone: Number(row.sections_total) - Number(row.sections_blocked),
    sectionsTotal: Number(row.sections_total),
    requiredFilled: Number(row.required_filled),
    requiredTotal: Number(row.required_total),
    nextSection: row.next_section
      ? sectionLabel(row.next_section, input.locale)
      : null,
    title: titles.get(row.id) ?? { kind: "none" },
  }));

  const name = displayName(input.fullName, input.email);

  return {
    displayName: name,
    initials: initialsOf(name),
    inProgress: intakes.find((intake) => intake.status === "draft") ?? null,
    recent: intakes.filter((intake) => intake.status !== "draft"),
  };
}
