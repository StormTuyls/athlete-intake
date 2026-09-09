import { query } from "@/lib/db/sql";
import { appDb } from "@/lib/supabase/service";
import { getFieldDefinitions, syncDossier } from "@/lib/db/dossier";
import { listDocuments, readLatestReport, type DocumentSummary } from "@/lib/db/medical";
import { logAudit } from "@/lib/audit";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { resolveInjuryTimeline, type TimelineEntry } from "@/lib/dossier/timeline";
import {
  formatIntakeTitleOrNull,
  titleFromRow,
  type BodySide,
} from "@/lib/intake/title";
import type { Proposal, ResolvedField } from "@/lib/types";

/**
 * Het volledige dossier voor het reviewscherm van de coach.
 *
 * Hier komt wel alles langs, inclusief herkomstcitaten. Dat is precies waarom
 * elke aanroep een audit-entry schrijft: leesacties op medische velden kunnen
 * databasetriggers niet zien.
 */

export interface InjuryRow {
  id: string;
  intakeId: string | null;
  recordedAt: string | null;
  bodyRegion: string;
  side: string;
  diagnosis: string | null;
  onsetDate: string | null;
  endDate: string | null;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  quoteVerified: boolean;
}

/**
 * De ruwe vermeldingen. Elk document dat een blessure noemt staat hier apart,
 * met zijn eigen herkomst.
 */
/**
 * De blessurevermeldingen die bij deze intake horen te staan.
 *
 * Over de ATLEET en niet over de intake: een blessure uit een eerdere intake is
 * nog steeds voorgeschiedenis, en meestal precies wat de coach zoekt. Zonder
 * dit begon elke nieuwe intake met een lege tijdlijn terwijl het dossier de
 * historie had.
 *
 * Wel chronologisch begrensd, en dat is niet optioneel: zou dit alles van de
 * atleet teruggeven, dan verschijnt een blessure van september in het rapport
 * van maart. Een bevroren rapport hoort te tonen wat er toen bekend was, dus
 * alleen vermeldingen uit intakes die niet later begonnen dan deze.
 *
 * Losse vermeldingen zonder intake (een import op atleetniveau) gaan altijd
 * mee: die hebben geen datum om op af te wijzen.
 */
export async function getInjuryEntries(intakeId: string): Promise<InjuryRow[]> {
  const rows = await query<{
    id: string;
    intake_id: string | null;
    recorded_at: Date | null;
    body_region: string;
    side: string;
    diagnosis: string | null;
    // Kalenderdatums komen als tekst binnen, zie de typeparser in lib/db/sql.ts.
    onset_date: string | null;
    end_date: string | null;
    source_document_id: string | null;
    source_page: number | null;
    source_quote: string | null;
    quote_verified: boolean;
  }>(
    `with scope as (
       select athlete_id, started_at
         from public.intakes
        where id = $1
     )
     select e.id, e.intake_id, source.started_at as recorded_at,
            e.body_region, e.side, e.diagnosis, e.onset_date, e.end_date,
            e.source_document_id, e.source_page, e.source_quote, e.quote_verified
       from medical.injury_events e
       cross join scope
       left join public.intakes source on source.id = e.intake_id
      where e.athlete_id = scope.athlete_id
        and (e.intake_id is null or source.started_at <= scope.started_at)
      order by e.onset_date nulls last, e.id`,
    [intakeId],
  );

  return rows.map((row) => ({
    id: row.id,
    intakeId: row.intake_id,
    recordedAt: row.recorded_at ? row.recorded_at.toISOString().slice(0, 10) : null,
    bodyRegion: row.body_region,
    side: row.side,
    diagnosis: row.diagnosis,
    onsetDate: row.onset_date,
    endDate: row.end_date,
    sourceDocumentId: row.source_document_id,
    sourcePage: row.source_page,
    sourceQuote: row.source_quote,
    quoteVerified: row.quote_verified,
  }));
}

/**
 * De tijdlijn zoals de coach hem ziet: vermeldingen van dezelfde blessure
 * samengevoegd. Zie lib/dossier/timeline.ts voor de regel.
 */
export async function getInjuries(intakeId: string): Promise<TimelineEntry[]> {
  return resolveInjuryTimeline(await getInjuryEntries(intakeId), intakeId);
}

export interface IntakeListRow {
  id: string;
  /** Nodig om te groeperen: twee atleten zonder naam zijn niet dezelfde atleet. */
  athleteId: string;
  athleteName: string | null;
  status: string;
  submittedAt: string | null;
  /** Voor een draft is er nog geen indiendatum; dan is dit de laatste activiteit. */
  startedAt: string | null;
  /**
   * Waar deze intake over gaat, in een paar woorden.
   *
   * Een lijst van "waiting for review · 2026-03-08" is niet te lezen zodra een
   * atleet er twee heeft: de status is voor elke rij hetzelfde en de datum zegt
   * niets over de inhoud. De klacht wel.
   *
   * Dit is medische inhoud, en dat is een bewuste afweging: het staat alleen op
   * schermen achter een coachlogin, en de pagina zegt niet langer dat er geen
   * medische gegevens op staan. Zonder dit label moet een coach elk dossier
   * openen om te zien welk dossier hij zoekt, en dan wordt de medische inhoud
   * alsnog geopend, alleen vaker.
   */
  label: string | null;
  requiredFilled: number;
  requiredTotal: number;
  conflicts: number;
}

/**
 * De werklijst van de behandelaar.
 *
 * Rekent de standen uit `medical.dossier_fields` in SQL, niet door 41 velden per
 * intake in TypeScript te halen. Met een handvol atleten maakt dat niets uit,
 * maar de query is even lang en dit schaalt wel.
 *
 * Alleen tellingen, geen waarden. Een overzicht mag geen medische inhoud tonen:
 * dit is de pagina die openstaat terwijl er iemand meekijkt.
 */
/**
 * Het label van een intake: de blessure, of anders de pijnlocatie.
 *
 * De afleiding zelf staat in lib/intake/title.ts en wordt gedeeld met het
 * thuisscherm van de atleet. Hier stond een eigen versie, met een andere
 * volgorde en met het ruwe enumwoord voor de zijde ("right", ook in een
 * Nederlandse interface). Dan noemen de coach en de atleet hetzelfde dossier
 * anders, en dat merk je pas in een gesprek waarin ze langs elkaar heen praten.
 *
 * De woorden zijn hier Engels omdat het coachscherm dat is; het thuisscherm
 * geeft dezelfde functie zijn eigen vertalingen mee.
 */
const COACH_SIDE_LABELS: Record<Exclude<BodySide, "unknown">, string> = {
  left: "left",
  right: "right",
  bilateral: "both sides",
};

function intakeLabel(row: {
  injury_region: string | null;
  injury_side: string | null;
  injury_diagnosis: string | null;
  pain_location: string | null;
}): string | null {
  return formatIntakeTitleOrNull(
    titleFromRow({
      bodyRegion: row.injury_region,
      side: (row.injury_side as BodySide | null) ?? null,
      diagnosis: row.injury_diagnosis,
      painLocation: row.pain_location,
    }),
    COACH_SIDE_LABELS,
  );
}

export async function listIntakesForCoach(): Promise<IntakeListRow[]> {
  const rows = await query<{
    id: string;
    athlete_id: string;
    status: string;
    submitted_at: Date | null;
    started_at: Date | null;
    required_filled: string;
    required_total: string;
    conflicts: string;
    dossier_name: string | null;
    injury_region: string | null;
    injury_side: string | null;
    injury_diagnosis: string | null;
    pain_location: string | null;
  }>(
    `select
       i.id,
       i.athlete_id,
       i.status::text as status,
       i.submitted_at,
       i.started_at,
       count(*) filter (
         where d.required and f.status is not null
           and f.status not in ('missing', 'conflicting')
       ) as required_filled,
       count(*) filter (where d.required) as required_total,
       count(*) filter (where f.status = 'conflicting') as conflicts,
       -- De naam zoals de intake hem vond, als terugval op public.athletes.
       -- Niet bij 'conflicting': staan er twee namen in een dossier, dan is
       -- er stil een kiezen wat de coach juist moet zien.
       max(f.value #>> '{}') filter (
         where d.key = 'identity.full_name'
           and f.status is not null
           and f.status not in ('missing', 'conflicting')
       ) as dossier_name,
       -- Waar deze intake over gaat. De blessure van deze intake als er een is,
       -- anders de pijnlocatie uit het dossier. max() over een waarde die per
       -- intake constant is: de lateral levert één rij, de cross join hierboven
       -- herhaalt hem per veld.
       max(inj.body_region) as injury_region,
       max(inj.side::text) as injury_side,
       max(inj.diagnosis) as injury_diagnosis,
       max(f.value #>> '{}') filter (
         where d.key = 'status.pain_location'
           and f.status is not null
           and f.status not in ('missing', 'conflicting')
       ) as pain_location
     from public.intakes i
     left join lateral (
       select e.body_region, e.side, e.diagnosis
         from medical.injury_events e
        where e.intake_id = i.id
        -- Met diagnose eerst: dat is het meest zeggende label.
        order by (e.diagnosis is not null) desc, e.onset_date nulls last, e.id
        limit 1
     ) inj on true
     cross join public.field_definitions d
     left join medical.dossier_fields f
       on f.intake_id = i.id and f.field_key = d.key
     group by i.id, i.athlete_id, i.status, i.submitted_at, i.started_at
     order by i.submitted_at desc nulls last, i.started_at desc`,
  );

  // De naam staat in public.athletes en die tabel is voor deze rol alleen
  // leesbaar via PostgREST, niet via de directe verbinding. Vandaar apart.
  const { data: athletes } = await appDb()
    .from("intakes")
    .select("id, athletes(full_name)");

  // PostgREST geeft een ingebedde relatie soms als object en soms als array,
  // afhankelijk van hoe hij de kardinaliteit inschat. Beide afhandelen is
  // goedkoper dan erop vertrouwen dat het niet verandert.
  const nameOf = (embedded: unknown): string | null => {
    const row = Array.isArray(embedded) ? embedded[0] : embedded;
    if (!row || typeof row !== "object") return null;
    const value = (row as { full_name?: unknown }).full_name;
    return typeof value === "string" ? value : null;
  };

  const nameById = new Map<string, string | null>(
    (athletes ?? []).map((row) => [row.id as string, nameOf(row.athletes)]),
  );

  return rows.map((row) => ({
    id: row.id,
    athleteId: row.athlete_id,
    athleteName: nameById.get(row.id) ?? row.dossier_name ?? null,
    status: row.status,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    label: intakeLabel(row),
    requiredFilled: Number(row.required_filled),
    requiredTotal: Number(row.required_total),
    conflicts: Number(row.conflicts),
  }));
}

/** Alle voorstellen per veld, zodat de coach ziet wat in welk document stond. */
export async function getProposalsByField(
  intakeId: string,
): Promise<Map<string, Proposal[]>> {
  const rows = await query<{
    id: string;
    field_key: string;
    value: unknown;
    proposed_by: Proposal["proposedBy"];
    source_document_id: string | null;
    source_page: number | null;
    source_quote: string | null;
    quote_verified: boolean;
    model_id: string | null;
    created_at: Date;
  }>(
    `select id, field_key, value, proposed_by, source_document_id, source_page,
            source_quote, quote_verified, model_id, created_at
     from medical.field_proposals where intake_id = $1 order by id desc`,
    [intakeId],
  );

  const byField = new Map<string, Proposal[]>();
  for (const row of rows) {
    const proposal: Proposal = {
      id: Number(row.id),
      fieldKey: row.field_key,
      value: row.value,
      proposedBy: row.proposed_by,
      sourceDocumentId: row.source_document_id,
      sourcePage: row.source_page,
      sourceQuote: row.source_quote,
      quoteVerified: row.quote_verified,
      modelId: row.model_id,
      createdAt: row.created_at.toISOString(),
    };
    const list = byField.get(row.field_key);
    if (list) list.push(proposal);
    else byField.set(row.field_key, [proposal]);
  }
  return byField;
}

export interface ReviewData {
  intakeId: string;
  /** Voor de weg terug naar het atleetprofiel. */
  athleteId: string;
  athleteName: string | null;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  /** De naam van de coach die aftekende, niet zijn id: dit gaat naar het scherm. */
  approvedBy: string | null;
  /** Nieuwste vastgelegde rapportversie, of null als er nog geen is. */
  reportVersion: number | null;
  sections: Array<{
    section: string;
    fields: Array<{
      key: string;
      label: string;
      dataType: string;
      required: boolean;
      isMedical: boolean;
      enumOptions: string[] | null;
      value: unknown;
      status: ResolvedField["status"];
      confidence: ResolvedField["confidence"];
      proposedBy: ResolvedField["proposedBy"];
      conflicts: ResolvedField["conflicts"];
      proposals: Proposal[];
    }>;
  }>;
  injuries: TimelineEntry[];
  documents: DocumentSummary[];
  completeness: {
    total: number;
    filled: number;
    requiredTotal: number;
    requiredFilled: number;
    conflicts: number;
    readyToSubmit: boolean;
  };
}

type Embedded = { full_name: string | null } | Array<{ full_name: string | null }> | null;

/**
 * De naam die de coach hoort te zien.
 *
 * public.athletes.full_name wordt alleen bij het aanmaken van een account
 * gevuld, uit wat de atleet daar zelf invulde. Een intake die uit documenten
 * komt heeft dat vaak niet, en dan stond er "Naam onbekend" boven een dossier
 * dat twee secties lager "Jonas Peeters" zegt, met citaat. Dat is geen ontbrekende
 * gegeven maar een niet-gelegde verbinding.
 *
 * Terugval en geen terugschrijven naar public.athletes: dossier_fields is een
 * afgeleide en athletes is de administratie. Terugschrijven maakt er een tweede
 * waarheid van die kan gaan schuiven, laat een modelgok een accountnaam
 * overschrijven, en zet bij elke herberekening een audit-regel.
 */
function dossierName(resolved: Map<string, ResolvedField>): string | null {
  const field = resolved.get("identity.full_name");
  if (!field || field.status === "conflicting" || field.status === "missing") return null;
  return typeof field.value === "string" && field.value.trim() !== "" ? field.value : null;
}

function athleteNameFrom(embedded: unknown): string | null {
  const value = embedded as Embedded;
  if (!value) return null;
  if (Array.isArray(value)) return value[0]?.full_name ?? null;
  return value.full_name ?? null;
}

export async function getReviewData(
  intakeId: string,
  /** Wie het dossier opvraagt. Gaat mee in het spoor; zonder actor is een
   *  leesregel alleen "iemand heeft gekeken", en dat is te weinig. */
  actorId?: string,
  /**
   * De taal van de COACH, niet die van de intake.
   *
   * Wie tien dossiers per week nakijkt wil niet dat de veldlabels van taal
   * wisselen bij het openen van een dossier van een Engelstalige atleet.
   * `intake.locale` blijft wel de taal van de gaten en de vragen hieronder: die
   * gaan naar de atleet.
   */
  coachLocale: Locale = DEFAULT_LOCALE,
): Promise<ReviewData | null> {
  const { data: intake, error } = await appDb()
    .from("intakes")
    .select(
      "id, status, submitted_at, approved_at, approved_by, locale, athlete_id, athletes(full_name)",
    )
    .eq("id", intakeId)
    .maybeSingle();

  if (error || !intake) return null;

  const [state, injuries, documents, proposals, report] = await Promise.all([
    syncDossier(intakeId, intake.locale as "nl" | "en"),
    getInjuries(intakeId),
    listDocuments(intakeId),
    getProposalsByField(intakeId),
    readLatestReport(intakeId),
  ]);

  // Apart opgehaald en niet als embed: de foreign key naar profiles heeft geen
  // benoemde relatie in de gegenereerde types, en een embed die op de naam van
  // een constraint leunt breekt zodra iemand die constraint hernoemt.
  let approverName: string | null = null;
  if (intake.approved_by) {
    const { data: approver } = await appDb()
      .from("profiles")
      .select("full_name")
      .eq("id", intake.approved_by)
      .maybeSingle();
    approverName = approver?.full_name ?? null;
  }

  await logAudit({
    action: "read",
    actorKind: "coach",
    actorId: actorId ?? null,
    entitySchema: "medical",
    entityTable: "dossier_fields",
    entityId: intakeId,
    detail: { screen: "review", fields: state.definitions.length },
  });

  const bySection = new Map<string, ReviewData["sections"][number]["fields"]>();
  for (const definition of state.definitions) {
    const field = state.resolved.get(definition.key);
    const entry = {
      key: definition.key,
      label: coachLocale === "nl" ? definition.labelNl : definition.labelEn,
      dataType: definition.dataType,
      required: definition.required,
      isMedical: definition.isMedical,
      enumOptions: definition.enumOptions,
      value: field?.value ?? null,
      status: field?.status ?? ("missing" as const),
      confidence: field?.confidence ?? ("low" as const),
      proposedBy: field?.proposedBy ?? null,
      conflicts: field?.conflicts ?? [],
      proposals: proposals.get(definition.key) ?? [],
    };
    const list = bySection.get(definition.section);
    if (list) list.push(entry);
    else bySection.set(definition.section, [entry]);
  }

  return {
    intakeId,
    athleteId: intake.athlete_id as string,
    // Een many-to-one embed komt als object terug, een one-to-many als array.
    // Beide vormen afhandelen is goedkoper dan erop vertrouwen.
    athleteName: athleteNameFrom(intake.athletes) ?? dossierName(state.resolved),
    status: intake.status as string,
    submittedAt: intake.submitted_at as string | null,
    approvedAt: intake.approved_at as string | null,
    approvedBy: approverName,
    reportVersion: report?.version ?? null,
    sections: [...bySection.entries()].map(([section, fields]) => ({ section, fields })),
    injuries,
    documents,
    completeness: state.completeness,
  };
}

export { getFieldDefinitions };
