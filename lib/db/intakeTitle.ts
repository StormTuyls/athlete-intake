import { query } from "@/lib/db/sql";
import { titleFromRow, type BodySide, type IntakeTitle } from "@/lib/intake/title";

/**
 * De titel van een intake ophalen.
 *
 * Los van lib/intake/title.ts omdat dit bestand `pg` binnentrekt en dat bestand
 * vanuit de browser geimporteerd wordt. Dezelfde scheiding als tussen
 * transcript.ts en transcriptTypes.ts.
 */

interface TitleRow {
  id: string;
  body_region: string | null;
  side: BodySide | null;
  diagnosis: string | null;
  pain_location: string | null;
  complaints: string | null;
}

/**
 * De titels van een reeks intakes, in één query.
 *
 * Per intake en niet per atleet: een blessure uit een eerdere intake hoort in de
 * tijdlijn thuis, maar niet in de kop van deze. Anders heten twee intakes van
 * dezelfde atleet hetzelfde en is de lijst weer even onbruikbaar als met drie
 * keer "Intake".
 */
export async function intakeTitles(
  intakeIds: string[],
): Promise<Map<string, IntakeTitle>> {
  const out = new Map<string, IntakeTitle>();
  if (intakeIds.length === 0) return out;

  const rows = await query<TitleRow>(
    `select
       t.id::text as id,
       injury.body_region,
       injury.side::text as side,
       injury.diagnosis,
       location.value #>> '{}' as pain_location,
       complaint.value #>> '{}' as complaints
     from unnest($1::uuid[]) as t(id)
     left join lateral (
       select e.body_region, e.side, e.diagnosis
         from medical.injury_events e
        where e.intake_id = t.id
        -- Exact dezelfde volgorde als listIntakesForCoach: met diagnose eerst,
        -- dat is het meest zeggende label. Wijkt die af, dan heet hetzelfde
        -- dossier bij de coach anders dan bij de atleet.
        order by (e.diagnosis is not null) desc, e.onset_date nulls last, e.id
        limit 1
     ) injury on true
     left join lateral (
       select f.value
         from medical.dossier_fields f
        where f.intake_id = t.id
          and f.field_key = 'status.pain_location'
          and f.value is not null
          and f.status not in ('missing', 'conflicting')
     ) location on true
     left join lateral (
       select f.value
         from medical.dossier_fields f
        where f.intake_id = t.id
          and f.field_key = 'medical.current_complaints'
          and f.value is not null
          and f.status not in ('missing', 'conflicting')
     ) complaint on true`,
    [intakeIds],
  );

  for (const row of rows) {
    out.set(
      row.id,
      titleFromRow({
        bodyRegion: row.body_region,
        side: row.side,
        diagnosis: row.diagnosis,
        painLocation: row.pain_location,
        complaints: row.complaints,
      }),
    );
  }

  return out;
}

/** Eén intake. Dezelfde query, zodat er maar één terugvalketen bestaat. */
export async function intakeTitle(intakeId: string): Promise<IntakeTitle> {
  return (await intakeTitles([intakeId])).get(intakeId) ?? { kind: "none" };
}
