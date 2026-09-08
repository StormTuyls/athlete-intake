import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { loadEnv } from "../scripts/env";

loadEnv();

import { createClient } from "@supabase/supabase-js";
import { appDb, storage, DOCUMENTS_BUCKET } from "../lib/supabase/service";
import { query } from "../lib/db/sql";
import { newToken } from "../lib/intake/session";
import { addProposals, syncDossier } from "../lib/db/dossier";
import { addInjuries, savePages, upsertDocument } from "../lib/db/medical";
import { ensureFrozenReport } from "../lib/report/freeze";
import { enqueuePurge } from "../lib/purge/jobs";
import { runPurgeJob } from "../lib/purge/purge";

/**
 * De test die M6 eist: bewijzen dat er niets achterblijft.
 *
 * Dit is de eis waar de klant expliciet om vroeg. Een verwijderpad zonder deze
 * test is een belofte; met deze test is het een eigenschap.
 *
 * Twee dingen die makkelijk fout gaan en hier daarom expres in zitten:
 *
 * 1. Er wordt eerst gecontroleerd dat alles ER IS. Een test die alleen nullen
 *    achteraf controleert, slaagt ook als de opbouw stilletjes niets deed.
 * 2. Er staat een bestand in Storage dat NIET in medical.documents geregistreerd
 *    is. Een signed upload-URL wordt uitgegeven voordat het document bestaat,
 *    dus dat is een echt scenario, en een implementatie die alleen de
 *    administratie volgt laat precies dat medische document staan. Zonder dit
 *    geval slaagt de test tegen een kapotte implementatie.
 *
 * En één ding dat mensen vergeten: het audit-spoor moet ER NOG ZIJN. "Niets
 * achtergebleven" mag niet per ongeluk "het spoor is gewist" betekenen.
 */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const db = appDb();
const PAGE_TEXT = `Verslag onderzoek

Patient: Purge Testatleet
Lengte: 176 cm
Gewicht: 68,4 kg
Klachten sinds 01-07-2026, rechter kuit.
`;

async function count(sql: string, values: unknown[]): Promise<number> {
  const rows = await query<{ n: string }>(sql, values);
  return Number(rows[0].n);
}

// --- opbouw -----------------------------------------------------------------

const email = `purge-${randomUUID()}@example.invalid`;
const { data: created, error: userError } = await admin.auth.admin.createUser({
  email,
  password: `Purge-${randomUUID()}`,
  email_confirm: true,
});
if (userError) throw new Error(`gebruiker maken mislukt: ${userError.message}`);
const userId = created.user!.id;

const { error: profileError } = await db
  .from("profiles")
  .upsert({ id: userId, role: "athlete", locale: "nl" });
if (profileError) throw new Error(`profiel maken mislukt: ${profileError.message}`);

const { data: athleteRow, error: athleteError } = await db
  .from("athletes")
  .insert({
    profile_id: userId,
    full_name: "Purge Testatleet",
    email,
    locale: "nl",
    retention_basis: "purge-test",
  })
  .select("id")
  .single();
if (athleteError) throw new Error(`atleet maken mislukt: ${athleteError.message}`);
const athleteId = athleteRow!.id as string;

async function makeIntake(submitted: boolean): Promise<string> {
  const { hash } = newToken();
  const { data, error } = await db
    .from("intakes")
    .insert({
      athlete_id: athleteId,
      locale: "nl",
      access_token_hash: hash,
      consent_granted_at: new Date().toISOString(),
      ...(submitted ? { status: "submitted", submitted_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`intake maken mislukt: ${error.message}`);
  return data!.id as string;
}

const submittedIntake = await makeIntake(true);
const draftIntake = await makeIntake(false);
const intakeIds = [submittedIntake, draftIntake];

// Toestemming op beide niveaus: het account en deze intake.
const consents: Array<{
  athlete_id: string;
  intake_id: string | null;
  consent_version: string;
  purposes: Record<string, boolean>;
}> = [
  { athlete_id: athleteId, intake_id: null, consent_version: "test", purposes: { intake: true } },
  { athlete_id: athleteId, intake_id: submittedIntake, consent_version: "test", purposes: { share: true } },
];
for (const consent of consents) {
  const { error } = await db.from("consents").insert(consent);
  if (error) throw new Error(`toestemming maken mislukt: ${error.message}`);
}

const { error: chatError } = await db.from("chat_messages").insert([
  { intake_id: submittedIntake, role: "assistant", content: "Hoe groot ben je?" },
  { intake_id: submittedIntake, role: "user", content: "176 cm" },
]);
if (chatError) throw new Error(`gesprek maken mislukt: ${chatError.message}`);

// Twee geregistreerde documenten met paginatekst.
const documentIds: string[] = [];
const storagePaths: string[] = [];
for (const intakeId of intakeIds) {
  const path = `${intakeId}/${randomUUID()}.txt`;
  const upload = await storage()
    .from(DOCUMENTS_BUCKET)
    .upload(path, Buffer.from(PAGE_TEXT, "utf8"), { contentType: "text/plain" });
  if (upload.error) throw new Error(`upload mislukt: ${upload.error.message}`);
  storagePaths.push(path);

  const documentId = await upsertDocument({
    intakeId,
    storagePath: path,
    originalFilename: "verslag.txt",
    mimeType: "text/plain",
    byteSize: Buffer.byteLength(PAGE_TEXT),
    sha256: createHash("sha256").update(`${path}${PAGE_TEXT}`).digest("hex"),
    kind: "pdf_text",
    pageCount: 1,
  });
  documentIds.push(documentId);
  await savePages(documentId, [{ pageNumber: 1, text: PAGE_TEXT }]);
}

// Het weesbestand: in Storage, in geen enkele tabel. Zie de toelichting boven.
const orphanPath = `${submittedIntake}/${randomUUID()}.txt`;
const orphanUpload = await storage()
  .from(DOCUMENTS_BUCKET)
  .upload(orphanPath, Buffer.from("wees", "utf8"), { contentType: "text/plain" });
if (orphanUpload.error) throw new Error(`weesupload mislukt: ${orphanUpload.error.message}`);

await addProposals(submittedIntake, [
  {
    fieldKey: "identity.full_name",
    value: "Purge Testatleet",
    proposedBy: "athlete",
    sourceDocumentId: null,
    sourcePage: null,
    sourceQuote: null,
    quoteVerified: false,
  },
  {
    fieldKey: "biometrics.height_cm",
    value: 176,
    proposedBy: "model",
    sourceDocumentId: documentIds[0],
    sourcePage: 1,
    sourceQuote: "Lengte: 176 cm",
    quoteVerified: true,
    modelId: "test",
  },
  // Twee documenten die het oneens zijn: levert een conflicting dossierveld op.
  {
    fieldKey: "biometrics.body_mass_kg",
    value: 68.4,
    proposedBy: "model",
    sourceDocumentId: documentIds[0],
    sourcePage: 1,
    sourceQuote: "Gewicht: 68,4 kg",
    quoteVerified: true,
    modelId: "test",
  },
  {
    fieldKey: "biometrics.body_mass_kg",
    value: 70,
    proposedBy: "model",
    sourceDocumentId: documentIds[1],
    sourcePage: 1,
    sourceQuote: "Gewicht: 70 kg",
    quoteVerified: false,
    modelId: "test",
  },
]);

await addInjuries([
  {
    athleteId,
    intakeId: submittedIntake,
    bodyRegion: "kuit",
    side: "right",
    diagnosis: "overbelasting kuit rechts",
    onsetDate: "2026-07-01",
    endDate: null,
    sourceDocumentId: documentIds[0],
    sourcePage: 1,
    sourceQuote: "Klachten sinds 01-07-2026, rechter kuit.",
    quoteVerified: true,
  },
]);

// Testsessie met metingen: die hangen aan de atleet, niet aan de intake.
const sessionRows = await query<{ id: string }>(
  `insert into medical.test_sessions (athlete_id, intake_id, device, protocol, occurred_on)
   values ($1, $2, 'VALD ForceDecks', 'CMJ', current_date) returning id`,
  [athleteId, submittedIntake],
);
const sessionId = sessionRows[0].id;
await query(
  `insert into medical.test_measurements (test_session_id, metric, value, unit, limb)
   values ($1, 'peak_force', 1420, 'N', 'right')`,
  [sessionId],
);

for (const intakeId of intakeIds) await syncDossier(intakeId, "nl");

const report = await ensureFrozenReport(submittedIntake, "export");
assert.ok(report.version >= 1, "er moet een vastgelegde rapportversie zijn");

// --- controleren dat het er ECHT staat ---------------------------------------

const before = {
  proposals: await count(
    "select count(*)::text as n from medical.field_proposals where intake_id = any($1)",
    [intakeIds],
  ),
  dossier: await count(
    "select count(*)::text as n from medical.dossier_fields where intake_id = any($1)",
    [intakeIds],
  ),
  pages: await count(
    "select count(*)::text as n from medical.document_pages where document_id = any($1)",
    [documentIds],
  ),
  measurements: await count(
    "select count(*)::text as n from medical.test_measurements where test_session_id = $1",
    [sessionId],
  ),
};

assert.ok(before.proposals >= 4, "de opbouw moet voorstellen hebben gemaakt");
assert.ok(before.dossier > 0, "de opbouw moet een dossier hebben gemaakt");
assert.equal(before.pages, 2);
assert.equal(before.measurements, 1);

// Het bestaande spoor vastleggen: dat moet de purge overleven.
const auditBefore = await count(
  "select count(*)::text as n from public.audit_log where entity_id = any($1)",
  [[...intakeIds, ...documentIds]],
);
assert.ok(auditBefore > 0, "er moet al een audit-spoor zijn om te bewaren");

// --- purgen ------------------------------------------------------------------

const job = await enqueuePurge({ athleteId, reason: "coach_request" });
const finished = await runPurgeJob(job.id);

assert.equal(finished.result.phase, "done", "de opdracht moet afgerond zijn");
assert.ok(finished.completedAt, "completed_at moet gezet zijn");
assert.deepEqual(
  [...finished.result.stepsDone].sort(),
  ["auth", "db", "notion", "plan", "storage"],
  "alle vijf de stappen moeten gelopen hebben",
);

// --- controleren dat er NIETS meer is ---------------------------------------

const leftovers: Array<[string, number]> = [
  ["medical.documents", await count("select count(*)::text as n from medical.documents where intake_id = any($1)", [intakeIds])],
  ["medical.document_pages", await count("select count(*)::text as n from medical.document_pages where document_id = any($1)", [documentIds])],
  ["medical.field_proposals", await count("select count(*)::text as n from medical.field_proposals where intake_id = any($1)", [intakeIds])],
  ["medical.dossier_fields", await count("select count(*)::text as n from medical.dossier_fields where intake_id = any($1)", [intakeIds])],
  // Twee wegen naar injury_events: athlete_id cascadeert, intake_id is set null.
  ["medical.injury_events", await count("select count(*)::text as n from medical.injury_events where athlete_id = $1 or intake_id = any($2)", [athleteId, intakeIds])],
  ["medical.test_sessions", await count("select count(*)::text as n from medical.test_sessions where athlete_id = $1 or intake_id = any($2)", [athleteId, intakeIds])],
  ["medical.test_measurements", await count("select count(*)::text as n from medical.test_measurements where test_session_id = $1", [sessionId])],
  ["medical.intake_reports", await count("select count(*)::text as n from medical.intake_reports where intake_id = any($1)", [intakeIds])],
  ["public.intakes", await count("select count(*)::text as n from public.intakes where athlete_id = $1", [athleteId])],
  ["public.athletes", await count("select count(*)::text as n from public.athletes where id = $1", [athleteId])],
];

for (const [table, n] of leftovers) {
  assert.equal(n, 0, `${table} heeft nog ${n} rijen van de verwijderde atleet`);
}

// Deze drie zijn voor de directe verbinding niet leesbaar, dus via PostgREST.
for (const [table, filter] of [
  ["consents", db.from("consents").select("id").eq("athlete_id", athleteId)],
  ["chat_messages", db.from("chat_messages").select("id").in("intake_id", intakeIds)],
  ["profiles", db.from("profiles").select("id").eq("id", userId)],
] as const) {
  const { data, error } = await filter;
  if (error) throw new Error(`${table} opvragen mislukt: ${error.message}`);
  assert.equal(data?.length ?? 0, 0, `public.${table} heeft nog rijen`);
}

// Het inlogaccount.
const { data: goneUser } = await admin.auth.admin.getUserById(userId);
assert.equal(goneUser?.user ?? null, null, "het inlogaccount bestaat nog");

// Storage, inclusief het weesbestand dat in geen enkele tabel stond.
for (const intakeId of intakeIds) {
  const { data, error } = await storage().from(DOCUMENTS_BUCKET).list(intakeId);
  if (error) throw new Error(`storage opvragen mislukt: ${error.message}`);
  assert.equal(data?.length ?? 0, 0, `er staan nog bestanden onder ${intakeId}`);
}
const { data: orphanCheck } = await storage()
  .from(DOCUMENTS_BUCKET)
  .list(submittedIntake, { search: orphanPath.split("/")[1] });
assert.equal(orphanCheck?.length ?? 0, 0, "het niet-geregistreerde bestand staat er nog");

// En het spoor: één samenvattende regel erbij, en het oude spoor intact.
const purgeRows = await query<{ counts: Record<string, number> }>(
  `select detail -> 'counts' as counts
     from public.audit_log where action = 'purge' and entity_id = $1`,
  [athleteId],
);
assert.equal(purgeRows.length, 1, "er hoort precies één purge-regel te zijn");
assert.equal(
  Number(purgeRows[0].counts.field_proposals),
  before.proposals,
  "de purge-regel moet de werkelijke aantallen dragen",
);

const auditAfter = await count(
  "select count(*)::text as n from public.audit_log where entity_id = any($1)",
  [[...intakeIds, ...documentIds]],
);
assert.equal(
  auditAfter,
  auditBefore,
  "het bestaande audit-spoor mag niet mee verdwijnen: bewijzen dat er niets " +
    "achterblijft mag niet betekenen dat het spoor gewist is",
);

console.log(
  `purge: ${before.proposals} voorstellen, ${before.dossier} dossiervelden, 3 bestanden ` +
    `(1 niet-geregistreerd), account en spoor gecontroleerd`,
);
process.exit(0);
