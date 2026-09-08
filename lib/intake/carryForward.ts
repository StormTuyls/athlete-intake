import { query } from "@/lib/db/sql";

/**
 * Wat deze atleet vorige keer al vertelde.
 *
 * Alleen de velden met `carry_forward` in public.field_definitions, en alleen om
 * ter bevestiging voor te leggen. Er wordt hier niets weggeschreven: de waarde
 * belandt pas in het dossier als de atleet in het gesprek zegt dat hij nog
 * klopt, en dan langs het gewone pad met `proposed_by: 'athlete'`.
 *
 * Dat onderscheid is het hele punt. Een waarde uit een intake van maart
 * automatisch overnemen in september levert een dossierveld op dat niemand deze
 * keer heeft bevestigd en waar geen citaat onder ligt. Precies het soort stille
 * aanname waar de rest van dit systeem tegen gebouwd is. De winst zit er ook
 * zonder: één beurt "kloppen deze nog?" vervangt acht losse vragen.
 */

export interface CarriedValue {
  fieldKey: string;
  label: string;
  value: unknown;
  /** Wanneer de atleet dit zei, zodat het gesprek kan zeggen hoe oud het is. */
  fromDate: string | null;
}

export async function carriedValues(input: {
  athleteId: string;
  /** De huidige intake, die uitgesloten wordt: dit gaat over eerdere. */
  intakeId: string;
  locale: "nl" | "en";
}): Promise<CarriedValue[]> {
  // distinct on met deze ordening pakt per veld de waarde uit de meest recente
  // eerdere intake. Tegenstrijdige en ontbrekende waarden vallen af: iets
  // voorleggen waar de vorige keer geen uitsluitsel over kwam is geen hulp.
  const rows = await query<{
    field_key: string;
    label: string;
    value: unknown;
    submitted_at: Date | null;
    started_at: Date | null;
  }>(
    `select distinct on (f.field_key)
       f.field_key,
       case when $3 = 'nl' then d.label_nl else d.label_en end as label,
       f.value,
       i.submitted_at,
       i.started_at
     from medical.dossier_fields f
     join public.field_definitions d
       on d.key = f.field_key and d.carry_forward
     join public.intakes i on i.id = f.intake_id
     where i.athlete_id = $1
       and f.intake_id <> $2
       and f.value is not null
       and f.status not in ('missing', 'conflicting')
     order by f.field_key, i.submitted_at desc nulls last, i.started_at desc`,
    [input.athleteId, input.intakeId, input.locale],
  );

  return rows.map((row) => ({
    fieldKey: row.field_key,
    label: row.label,
    value: row.value,
    fromDate:
      row.submitted_at?.toISOString().slice(0, 10) ??
      row.started_at?.toISOString().slice(0, 10) ??
      null,
  }));
}
