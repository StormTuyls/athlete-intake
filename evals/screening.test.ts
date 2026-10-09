import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../scripts/env";

loadEnv();

import { appDb } from "../lib/supabase/service";
import { query } from "../lib/db/sql";
import {
  createSession,
  getHistory,
  getLibrary,
  getSession,
  listSessions,
  toSpecs,
} from "../lib/db/screening";
import { evaluate } from "../lib/screening/evaluate";

/**
 * De screeningspijplijn tegen een echte databank.
 *
 * Waarom deze test bestaat, en waarom hij geen browsertest is: elke fout die de
 * bouw van dit pad opleverde zat in SQL die prima typecheckt.
 *
 *   select d.side      -> de zijde staat op test_items, niet op derived_results
 *   select d.kind      -> die kolom bestaat niet; derived_key zegt het
 *   insert ... inputs  -> kolom kwam uit een eerder ontwerp
 *   unieke index       -> een deltarij verdrong de ruwe waarde
 *   historie per metriek zonder zijde -> links vergeleek met de vorige RECHTS
 *
 * Geen van die vijf raakt een React-component. Alle vijf worden hier gevangen,
 * want deze test doet precies wat het scherm doet: opslaan via createSession en
 * teruglezen via getSession.
 *
 * De laatste is de ergste: -16,7% in plaats van -10,3%, allebei geloofwaardig,
 * en niets dat klaagt. Die staat hieronder apart.
 */

// Via de service-rol en niet via de directe verbinding: intake_server heeft met
// opzet alleen select op public.athletes. Dezelfde reden als in purge.test.ts.
const db = appDb();
const { data: athleteRow, error: athleteError } = await db
  .from("athletes")
  .insert({
    full_name: "Screening Testatleet",
    email: `screening-${randomUUID()}@example.invalid`,
    sport: "sprint",
    sex: "female",
    retention_basis: "screening-test",
  })
  .select("id")
  .single();
if (athleteError) throw new Error(`atleet maken mislukt: ${athleteError.message}`);
const athleteId = athleteRow!.id as string;
const actor = { id: null };

try {
  // --- de bibliotheek ------------------------------------------------------

  const library = await getLibrary();
  assert.ok(library.length >= 20, "de bibliotheek hoort geseed te zijn");

  const slr = library.find((t) => t.testKey === "mobility_ll.passive_slr");
  const thomas = library.find((t) => t.testKey === "mobility_ll.thomas");
  assert.ok(slr && thomas);

  // Wat de seed belooft, moet uit de databank terugkomen: de een classificeert,
  // de ander niet tot het protocol bevestigd is. Spec §10 en §18.
  assert.equal(slr.rule?.classificationEnabled, true);
  assert.equal(thomas.rule?.classificationEnabled, false);
  assert.ok(thomas.ruleNote, "een uitgezette regel legt uit waarom");

  const specs = toSpecs(library);

  // --- sessie 1 ------------------------------------------------------------
  //
  // Links en rechts met VERSCHILLENDE waarden. Met twee gelijke getallen
  // slaagt deze test ook tegen de zijde-bug.

  const first = [
    { metricKey: slr.metricKey, side: "left" as const, value: 78, protocolId: slr.protocolId },
    { metricKey: slr.metricKey, side: "right" as const, value: 84, protocolId: slr.protocolId },
    { metricKey: thomas.metricKey, side: "left" as const, value: 5, protocolId: thomas.protocolId },
  ];

  const firstId = await createSession(
    {
      athleteId,
      occurredOn: "2026-07-01",
      testerProfileId: null,
      bodyMassKg: 61,
      notes: null,
      entries: first,
    },
    evaluate(first, specs, await getHistory(athleteId, first.map((e) => e.metricKey)), "2026-07-01T09:00:00Z"),
    actor,
  );

  const one = await getSession(firstId, actor);
  assert.ok(one, "de sessie moet terug te lezen zijn");

  // Een eerste screening heeft geen vorige om tegen af te zetten.
  assert.equal(one.results.filter((r) => r.kind === "delta").length, 0);

  const slrLeft = one.results.find(
    (r) => r.kind === "absolute" && r.side === "left" && r.metricKey === slr.metricKey,
  );
  assert.equal(slrLeft?.value, 78);
  assert.equal(slrLeft?.bandStatus, "fair", "78 valt in de band 75-80");

  // Thomas is gemeten en wordt getoond, maar niet ingedeeld.
  const thomasRow = one.results.find((r) => r.metricKey === thomas.metricKey);
  assert.equal(thomasRow?.value, 5);
  assert.equal(thomasRow?.status, "computed");
  assert.equal(thomasRow?.bandStatus, null, "classificatie staat uit voor Thomas");

  // Asymmetrie hangt aan geen van beide zijden en draagt teller en noemer.
  const asym = one.results.find((r) => r.kind === "asymmetry");
  assert.ok(asym);
  assert.equal(asym.side, "bilateral");
  assert.equal(asym.inputs?.left, 78);
  assert.equal(asym.inputs?.right, 84);
  assert.equal(asym.bandStatus, null, "asymmetrie heeft geen bronafkapwaarde");

  // --- sessie 2 ------------------------------------------------------------

  const second = [
    { metricKey: slr.metricKey, side: "left" as const, value: 70, protocolId: slr.protocolId },
    { metricKey: slr.metricKey, side: "right" as const, value: 86, protocolId: slr.protocolId },
  ];

  const history = await getHistory(athleteId, second.map((e) => e.metricKey));
  const secondId = await createSession(
    {
      athleteId,
      occurredOn: "2026-10-09",
      testerProfileId: null,
      bodyMassKg: 62.4,
      notes: "derde week opbouw",
      entries: second,
    },
    evaluate(second, specs, history, "2026-10-09T09:00:00Z"),
    actor,
  );

  const two = await getSession(secondId, actor);
  assert.ok(two);

  // DE BELANGRIJKSTE CONTROLE.
  //
  // Links was 78 en is 70; rechts was 84 en is 86. Vergelijkt de historie niet
  // per zijde, dan pakt links de 84 van rechts en staat er -16,7% in plaats van
  // -10,3%. Geen van beide getallen ziet er verkeerd uit op een scherm.
  const deltaLeft = two.results.find((r) => r.kind === "delta" && r.side === "left");
  const deltaRight = two.results.find((r) => r.kind === "delta" && r.side === "right");
  assert.ok(deltaLeft && deltaRight, "beide zijden horen een verandering te hebben");

  assert.equal(deltaLeft.inputs?.previous, 78, "links vergelijkt met de vorige LINKS");
  assert.equal(deltaRight.inputs?.previous, 84, "rechts met de vorige RECHTS");
  assert.ok(Math.abs(deltaLeft.value! - ((70 - 78) / 78) * 100) < 1e-6);
  assert.ok(deltaRight.value! > 0, "86 na 84 is vooruit");

  // Laag 1 oordeelt niet: een verandering krijgt nooit een band.
  assert.equal(deltaLeft.bandStatus, null);

  // De ruwe waarde wordt wel gewoon geclassificeerd, en de deltarij heeft hem
  // niet verdrongen: dat is de unieke index over derived_key.
  const absoluteLeft = two.results.find((r) => r.kind === "absolute" && r.side === "left");
  assert.equal(absoluteLeft?.value, 70);
  assert.equal(absoluteLeft?.bandStatus, "poor");

  // --- de tijdlijn ---------------------------------------------------------

  const sessions = await listSessions(athleteId, actor);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].occurredOn, "2026-10-09", "nieuwste eerst");
  assert.equal(sessions[1].measurements, 3);

  // --- wat het scherm nodig heeft ------------------------------------------
  //
  // getSession levert alles opgelost aan, zodat de pagina niet terug hoeft te
  // joinen. Mist er een van deze velden, dan rendert het scherm leeg zonder
  // foutmelding.
  for (const row of two.results) {
    assert.ok(row.testLabel, "elke rij heeft een testnaam");
    assert.ok(row.block, "elke rij hoort bij een blok");
    assert.ok(row.unit, "elke rij heeft een eenheid");
    assert.equal(typeof row.decimals, "number");
    assert.equal(typeof row.protocolConfirmed, "boolean");
  }

  console.log(
    `screening: ${library.length} tests, 2 sessies, delta per zijde (links was 78, rechts was 84), ` +
      "band aan voor SLR en uit voor Thomas",
  );
} finally {
  // De cascade ruimt sessies, items, proeven, metingen en uitkomsten op.
  // Via de service-rol, want delete op public.athletes is bij authenticated
  // weggehaald en intake_server mag er sowieso niet schrijven.
  await db.from("athletes").delete().eq("id", athleteId);
}

process.exit(0);
