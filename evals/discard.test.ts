import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { loadEnv } from "../scripts/env";

loadEnv();

import { appDb, storage, DOCUMENTS_BUCKET } from "../lib/supabase/service";
import { query } from "../lib/db/sql";
import { newToken } from "../lib/intake/session";
import { addProposals } from "../lib/db/dossier";
import { savePages, upsertDocument } from "../lib/db/medical";
import { discardIntake } from "../lib/intake/discard";

/**
 * Een concept weggooien laat niets achter, en raakt niets anders aan.
 *
 * Dit pad wist medische gegevens op verzoek van de atleet zelf, zonder dat er
 * een behandelaar aan te pas komt. Dat is precies het soort knop dat een keer
 * te veel wist als niemand het vastlegt, dus deze test bewaakt drie dingen
 * tegelijk:
 *
 * 1. Er blijft niets van dit concept staan. Niet in public, niet in medical,
 *    en niet in de bucket. Net als bij de atleetpurge staat er een bestand in
 *    Storage dat NIET in medical.documents geregistreerd is: een signed
 *    upload-URL wordt uitgegeven voordat de rij bestaat, dus dat is een echt
 *    scenario en een implementatie die alleen de administratie volgt laat
 *    precies dat medische document staan.
 * 2. Het auditspoor blijft. "Niets achtergebleven" mag nooit betekenen dat ook
 *    de regel verdween die zegt dat er iets weggegooid is.
 * 3. Een INGEDIENDE intake wordt geweigerd. Dat is de veiligheidsgrens van de
 *    hele functie: een dossier dat een behandelaar mogelijk al gelezen heeft
 *    verdwijnt niet omdat iemand op een knop in een chatscherm drukt. De
 *    tweede atleet in deze test bestaat alleen daarvoor.
 *
 * Zoals purge.test.ts: er wordt eerst gecontroleerd dat alles ER IS. Een test
 * die alleen nullen achteraf telt, slaagt ook als de opbouw stilletjes niets
 * deed.
 *
 * Draaien: npm run test:discard (vraagt een lokale stack).
 */

const db = appDb();

async function makeAthlete(basis: string): Promise<string> {
  const { data, error } = await db
    .from("athletes")
    .insert({ locale: "nl", retention_mode: "indefinite", retention_basis: basis })
    .select("id")
    .single();
  if (error || !data) throw new Error(`atleet aanmaken mislukt: ${error?.message}`);
  return data.id as string;
}

async function makeIntake(
  athleteId: string,
  status: "draft" | "submitted",
): Promise<string> {
  const { hash } = newToken();
  const { data, error } = await db
    .from("intakes")
    .insert({
      athlete_id: athleteId,
      locale: "nl",
      access_token_hash: hash,
      status,
      consent_granted_at: new Date().toISOString(),
      submitted_at: status === "submitted" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`intake aanmaken mislukt: ${error?.message}`);
  return data.id as string;
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const rows = await query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/**
 * public.chat_messages is voor de directe verbinding niet leesbaar: rol
 * intake_server heeft rechten op medical plus een paar leesrechten in public,
 * en deze tabel hoort daar niet bij. Die gaat dus langs PostgREST, net als in
 * purge.test.ts.
 */
async function countChat(intakeId: string): Promise<number> {
  const { data, error } = await db.from("chat_messages").select("id").eq("intake_id", intakeId);
  if (error) throw new Error(`chatberichten tellen mislukt: ${error.message}`);
  return data?.length ?? 0;
}

async function main() {
  // ---------------------------------------------------------------- opbouw
  const athleteId = await makeAthlete("test: discard-pad");
  const intakeId = await makeIntake(athleteId, "draft");

  await db.from("chat_messages").insert([
    { intake_id: intakeId, role: "assistant", content: "Wat is je volledige naam?" },
    { intake_id: intakeId, role: "user", content: "Test Atleet" },
  ]);

  await addProposals(intakeId, [
    {
      fieldKey: "identity.full_name",
      value: "Test Atleet",
      proposedBy: "athlete",
      sourceQuote: "Test Atleet",
    },
  ]);

  // Een geregistreerd document, mét bestand in de bucket.
  const bytes = Buffer.from("Verslag onderzoek\nLengte: 176 cm\n", "utf8");
  const registeredPath = `${intakeId}/${randomUUID()}.txt`;
  const upload = await storage()
    .from(DOCUMENTS_BUCKET)
    .upload(registeredPath, bytes, { contentType: "text/plain" });
  if (upload.error) throw new Error(`upload mislukt: ${upload.error.message}`);

  const documentId = await upsertDocument({
    intakeId,
    storagePath: registeredPath,
    originalFilename: "verslag.txt",
    mimeType: "text/plain",
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    kind: "pdf_text",
    pageCount: 1,
  });
  await savePages(documentId, [{ pageNumber: 1, text: bytes.toString("utf8") }]);

  // En een wees: geupload, nooit geregistreerd. Zie de kop van dit bestand.
  const orphanPath = `${intakeId}/${randomUUID()}.txt`;
  const orphan = await storage()
    .from(DOCUMENTS_BUCKET)
    .upload(orphanPath, Buffer.from("gestrande upload", "utf8"), {
      contentType: "text/plain",
    });
  if (orphan.error) throw new Error(`wees-upload mislukt: ${orphan.error.message}`);

  // ------------------------------------------------- het staat er echt
  assert.equal(await countChat(intakeId), 2, "opbouw: de chatberichten staan er niet");
  assert.ok(
    (await count(`select count(*) as n from medical.field_proposals where intake_id = $1`, [intakeId])) > 0,
    "opbouw: er staan geen voorstellen",
  );
  assert.equal(
    await count(`select count(*) as n from medical.documents where intake_id = $1`, [intakeId]),
    1,
    "opbouw: het document staat er niet",
  );
  assert.equal(
    await count(`select count(*) as n from medical.document_pages where document_id = $1`, [documentId]),
    1,
    "opbouw: de paginatekst staat er niet",
  );

  const before = await storage().from(DOCUMENTS_BUCKET).list(intakeId, { limit: 100 });
  assert.equal(before.data?.length, 2, "opbouw: er staan geen twee bestanden in de bucket");

  // ------------------------------------------------------------ weggooien
  const result = await discardIntake({ intakeId, actorId: null, actorKind: "athlete" });

  assert.equal(result.discarded, true, "het concept is niet weggegooid");
  assert.equal(result.athleteId, athleteId, "de functie noemt een andere atleet");
  assert.equal(result.counts.chat_messages, 2, "de telling van de berichten klopt niet");
  assert.equal(result.counts.documents, 1, "de telling van de documenten klopt niet");
  assert.equal(result.filesRemoved, 2, "niet beide bestanden zijn opgeruimd");
  assert.equal(result.storageEmpty, true, "er ligt nog iets onder de intake-prefix");

  // -------------------------------------------------- er staat niets meer
  for (const [label, sql] of [
    ["intakes", `select count(*) as n from public.intakes where id = $1`],
    ["documents", `select count(*) as n from medical.documents where intake_id = $1`],
    ["field_proposals", `select count(*) as n from medical.field_proposals where intake_id = $1`],
    ["dossier_fields", `select count(*) as n from medical.dossier_fields where intake_id = $1`],
    ["injury_events", `select count(*) as n from medical.injury_events where intake_id = $1`],
  ] as const) {
    assert.equal(await count(sql, [intakeId]), 0, `${label} is niet leeg na het weggooien`);
  }

  assert.equal(await countChat(intakeId), 0, "de chatberichten staan er nog");
  assert.equal(
    await count(`select count(*) as n from medical.document_pages where document_id = $1`, [documentId]),
    0,
    "de paginatekst staat er nog",
  );

  const after = await storage().from(DOCUMENTS_BUCKET).list(intakeId, { limit: 100 });
  assert.equal(after.data?.length ?? 0, 0, "er staan nog bestanden in de bucket");

  // De atleet zelf blijft. Dit gooit een concept weg, geen persoon.
  assert.equal(
    await count(`select count(*) as n from public.athletes where id = $1`, [athleteId]),
    1,
    "de atleet is meeverdwenen, en dat hoort niet",
  );
  // ------------------------------------------------------- het spoor blijft
  assert.equal(
    await count(
      `select count(*) as n from public.audit_log
        where action = 'purge' and entity_table = 'intakes' and entity_id = $1`,
      [intakeId],
    ),
    1,
    "er staat geen auditregel voor het weggegooide concept",
  );

  // ------------------------------------------------ tweede keer is geen fout
  const again = await discardIntake({ intakeId, actorId: null, actorKind: "athlete" });
  assert.equal(again.discarded, false, "een tweede poging meldt dat er iets weg is");

  // --------------------------------------- een ingediende intake weigeren
  const otherAthlete = await makeAthlete("test: discard weigert ingediend");
  const submittedId = await makeIntake(otherAthlete, "submitted");

  await assert.rejects(
    () => discardIntake({ intakeId: submittedId, actorId: null, actorKind: "athlete" }),
    /geen concept meer/,
    "een ingediende intake werd niet geweigerd",
  );
  assert.equal(
    await count(`select count(*) as n from public.intakes where id = $1`, [submittedId]),
    1,
    "de ingediende intake is toch verdwenen",
  );

  // ------------------------------------------------------------- opruimen
  // Via de bestaande purgefunctie en niet met een losse delete: rol
  // intake_server mag niets wissen in public.athletes, en medical.purge_athlete
  // bestaat precies hiervoor.
  for (const id of [athleteId, otherAthlete]) {
    await query(`select medical.purge_athlete($1, null, 'system')`, [id]);
  }

  console.log(
    "discard: concept volledig weg (rijen, paginatekst, beide bestanden), atleet en auditspoor blijven, ingediende intake geweigerd",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
