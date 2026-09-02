import assert from "node:assert/strict";
import { loadEnv } from "../scripts/env";

loadEnv();

import { appDb } from "../lib/supabase/service";
import { newToken } from "../lib/intake/session";
import { syncDossier } from "../lib/db/dossier";
import { runChatTurn } from "../lib/claude/chatTurn";

/**
 * Regressietest: de assistent moet ELK veld uit een antwoord oppikken, ook de
 * optionele.
 *
 * Bij de eerste UI-test leverde "182 cm, en ik weeg 77 kg. Ik sprint de 100 en
 * 200m bij AC Herentals, onder Atletiek Vlaanderen." maar drie velden op. De
 * oorzaak was niet het model: de prompt gaf alleen de eerste twaalf gaten mee,
 * en dat zijn allemaal verplichte velden. Club, discipline en federatie stonden
 * er dus niet in en konden niet opgepikt worden.
 *
 * De prompt heeft nu twee lijsten: waar hij naar vraagt, en wat hij mag oppikken.
 */

const ANSWER =
  "182 cm, en ik weeg 77 kg. Ik sprint de 100 en 200m bij AC Herentals, onder Atletiek Vlaanderen.";

const EXPECTED = [
  "biometrics.height_cm",
  "biometrics.body_mass_kg",
  "identity.sport",
  "identity.discipline",
  "identity.club",
  "identity.federation",
];

async function main() {
  const db = appDb();
  const draftUntil = new Date();
  draftUntil.setDate(draftUntil.getDate() + 30);

  const { data: athlete } = await db
    .from("athletes")
    .insert({
      locale: "nl",
      retention_mode: "until_date",
      retention_until: draftUntil.toISOString().slice(0, 10),
    })
    .select("id")
    .single();

  const { hash } = newToken();
  const { data: intake } = await db
    .from("intakes")
    .insert({
      athlete_id: athlete!.id,
      locale: "nl",
      access_token_hash: hash,
      consent_granted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  try {
    const state = await syncDossier(intake!.id as string);

    const turn = await runChatTurn({
      history: [
        { role: "assistant", content: "Hoe groot ben je, in centimeter?" },
        { role: "user", content: ANSWER },
      ],
      gaps: state.gaps,
      definitions: state.definitions,
      locale: "nl",
    });

    const captured = new Set(turn.captured.map((c) => c.fieldKey));
    console.log(`opgepikt: ${[...captured].join(", ")}`);

    const missing = EXPECTED.filter((key) => !captured.has(key));
    assert.deepEqual(
      missing,
      [],
      `deze velden stonden in het antwoord maar zijn niet opgepikt: ${missing.join(", ")}`,
    );

    // De assistent mag niets afleiden dat er niet stond.
    assert.equal(
      captured.has("identity.date_of_birth"),
      false,
      "geboortedatum stond niet in het antwoord en mag niet verzonnen worden",
    );

    // Elk opgepikt veld heeft het citaat van de atleet als herkomst.
    assert.ok(
      turn.captured.every((c) => c.quote && c.quote.trim() !== ""),
      "elk opgepikt veld moet meenemen wat de atleet letterlijk zei",
    );

    console.log("chat: alle velden uit een antwoord opgepikt, niets verzonnen");
  } finally {
    await db.from("athletes").delete().eq("id", athlete!.id);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
