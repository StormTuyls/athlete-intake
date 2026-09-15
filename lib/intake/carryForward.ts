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

/**
 * Waar het bij deze atleet eerder over ging.
 *
 * Losstaand van carriedValues, en het verschil is de bedoeling ervan.
 * carriedValues levert WAARDEN die de atleet mag bevestigen en die daarna in
 * het dossier belanden. Dit levert CONTEXT: de assistent mag weten dat er in
 * augustus een hamstringklacht was, zodat hij kan vragen of dit dezelfde plek
 * is. Er komt hier nooit een dossierveld uit, in geen enkel pad.
 *
 * Waarom dat als apart begrip bestaat en niet als een bredere carry-forward:
 * de medische velden die je zou willen meenemen zijn long_text. Ze bevatten
 * alinea's. Een openingsbericht dat iemands volledige blessurehistoriek en
 * operatieverleden opsomt om te laten bevestigen is geen tijdwinst maar een
 * muur tekst, en precies daarom stonden medische velden buiten de
 * carry-forward. Wat een terugkerende atleet wel verwacht is dat je WEET dat
 * hij er al eens was. Daar is een regel van drie woorden genoeg voor.
 *
 * Alleen eerdere intakes, en hoogstens drie: verder terug zegt niets meer over
 * de vraag of de klacht van vandaag ergens bij hoort.
 */

export interface EarlierIntake {
  intakeId: string;
  /** De datum waarop die intake liep, als YYYY-MM-DD. */
  date: string | null;
  /** De blessures die in die intake zijn vastgelegd. Kan leeg zijn. */
  injuries: Array<{
    bodyRegion: string;
    side: string;
    diagnosis: string | null;
    onsetDate: string | null;
  }>;
  /** De klacht zoals de atleet die toen beschreef, ingekort. */
  complaint: string | null;
}

export async function earlierIntakes(input: {
  athleteId: string;
  intakeId: string;
}): Promise<EarlierIntake[]> {
  const rows = await query<{
    intake_id: string;
    happened_at: Date | null;
    complaint: string | null;
    injuries:
      | Array<{
          body_region: string;
          side: string;
          diagnosis: string | null;
          onset_date: string | null;
        }>
      | null;
  }>(
    `select
       i.id::text as intake_id,
       coalesce(i.submitted_at, i.started_at) as happened_at,
       complaint.value #>> '{}' as complaint,
       injury.list as injuries
     from public.intakes i
     left join lateral (
       select f.value
         from medical.dossier_fields f
        where f.intake_id = i.id
          and f.field_key = 'medical.current_complaints'
          and f.value is not null
          and f.status not in ('missing', 'conflicting')
     ) complaint on true
     left join lateral (
       select json_agg(
                json_build_object(
                  'body_region', e.body_region,
                  'side', e.side,
                  'diagnosis', e.diagnosis,
                  'onset_date', to_char(e.onset_date, 'YYYY-MM-DD')
                )
                order by e.onset_date nulls last, e.id
              ) as list
         from medical.injury_events e
        where e.intake_id = i.id
     ) injury on true
     where i.athlete_id = $1
       and i.id <> $2
     order by coalesce(i.submitted_at, i.started_at) desc
     limit 3`,
    [input.athleteId, input.intakeId],
  );

  return rows.map((row) => ({
    intakeId: row.intake_id,
    date: row.happened_at?.toISOString().slice(0, 10) ?? null,
    injuries: (row.injuries ?? []).map((injury) => ({
      bodyRegion: injury.body_region,
      side: injury.side,
      diagnosis: injury.diagnosis,
      onsetDate: injury.onset_date,
    })),
    // Eén zin is genoeg om te herkennen waar het over ging. De volle tekst
    // hoort in het dossier van die intake en niet in de prompt van deze.
    complaint: row.complaint ? firstSentence(row.complaint, 160) : null,
  }));
}

function firstSentence(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const stop = trimmed.search(/[.!?](\s|$)/);
  const sentence = stop > 0 ? trimmed.slice(0, stop + 1) : trimmed;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}
