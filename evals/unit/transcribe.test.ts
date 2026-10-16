import assert from "node:assert/strict";
import {
  ACCEPTED_AUDIO_MIME_TYPES,
  MAX_AUDIO_BYTES,
  audioTypeAccepted,
  transcriptionConfigured,
} from "../../lib/intake/transcribe";

/**
 * De deur van het dicteer-endpoint.
 *
 * Eén regel hier is de reden dat dit bestand bestaat: MediaRecorder geeft geen
 * "audio/webm" maar "audio/webm;codecs=opus". Een vergelijking op de hele
 * string weigert dus precies wat elke Chrome oplevert, en dat is een fout die je
 * niet in een typecheck ziet en pas op een echt toestel merkt.
 *
 * Geen netwerk en geen databank.
 */

// Wat de browsers werkelijk sturen, inclusief de codec erachter.
for (const type of [
  "audio/webm;codecs=opus",
  "audio/webm; codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4", // Safari
  "AUDIO/WEBM", // het content-type is hoofdletterongevoelig
]) {
  assert.ok(audioTypeAccepted(type), `${type} hoort geaccepteerd te worden`);
}

// En wat er niet in hoort. video/webm is de valstrik: dezelfde container, en
// MediaRecorder schrijft hem zodra er per ongeluk een videotrack in de stream
// zit.
for (const type of [
  "video/webm;codecs=vp8",
  "application/pdf",
  "image/jpeg",
  "text/plain",
  "",
  "audio",
]) {
  assert.ok(!audioTypeAccepted(type), `${type} hoort geweigerd te worden`);
}

// De lijst en de controle mogen niet uiteenlopen.
for (const type of ACCEPTED_AUDIO_MIME_TYPES) {
  assert.ok(audioTypeAccepted(type), `${type} staat in de lijst maar valt buiten de controle`);
}

/**
 * De bovengrens van de route moet boven die van de recorder liggen.
 *
 * useDictation stopt na twee minuten. Opus op 32 kbit/s doet daar ongeveer
 * 0,5 MB over, dus 10 MB is ruim. Zou de route krapper staan dan wat de recorder
 * maximaal produceert, dan krijgt iemand na twee minuten praten een weigering in
 * plaats van tekst.
 */
assert.ok(MAX_AUDIO_BYTES >= 2 * 1024 * 1024, "de bytelimiet is krapper dan twee minuten opus");

/**
 * Zonder sleutel geen knop.
 *
 * De UI hangt hieraan: /api/intake/transcribe geeft `available` terug en de
 * Composer verbergt de microfoon als dat false is. Zou dit true geven zonder
 * sleutel, dan staat er een knop die bij elke poging een 503 oplevert.
 */
const original = process.env.TRANSCRIBE_API_KEY;
try {
  delete process.env.TRANSCRIBE_API_KEY;
  assert.equal(transcriptionConfigured(), false);

  process.env.TRANSCRIBE_API_KEY = "";
  assert.equal(transcriptionConfigured(), false, "een lege sleutel telt niet als geconfigureerd");

  process.env.TRANSCRIBE_API_KEY = "test";
  assert.equal(transcriptionConfigured(), true);
} finally {
  if (original === undefined) delete process.env.TRANSCRIBE_API_KEY;
  else process.env.TRANSCRIBE_API_KEY = original;
}

console.log("transcribe: codecs geaccepteerd, video geweigerd, geen sleutel geen knop");
process.exit(0);
