import type { Locale } from "@/lib/i18n/locale";

/**
 * Gesproken antwoorden omzetten naar tekst.
 *
 * ---------------------------------------------------------------------------
 * Waarom niet de spraakherkenning van de browser
 * ---------------------------------------------------------------------------
 *
 * `webkitSpeechRecognition` is gratis, werkt zonder backend en was in een
 * halve dag klaar. Hij stuurt de audio alleen naar Google (Chrome) of Apple
 * (Safari), en dat zijn verwerkers die niet in de subverwerkerstabel van
 * docs/oplevering.md staan. Wat hier ingesproken wordt is een klacht, een
 * medicatielijst of een blessurehistoriek: bijzondere categorie
 * persoonsgegevens. Een partij daar stilletjes aan toevoegen omdat de browser
 * hem toevallig meelevert, is precies het soort ding dat een
 * verwerkingsregister onwaar maakt.
 *
 * Vandaar: opnemen in de browser, transcriberen op onze eigen server, bij een
 * partij die in dat register staat.
 *
 * ---------------------------------------------------------------------------
 * Welke partij
 * ---------------------------------------------------------------------------
 *
 * Standaard Mistral (Voxtral), omdat dat een EU-partij is en de rij in de tabel
 * daarmee kort blijft. De keuze is niet in beton: de API is OpenAI-compatibel
 * (multipart met `file` en `model`), dus basis-URL en modelnaam komen uit de
 * omgeving. Overstappen naar Azure Speech West-Europa of een andere
 * compatibele aanbieder is een configuratiewijziging, geen codewijziging.
 *
 * ---------------------------------------------------------------------------
 * Wat er NIET gebeurt
 * ---------------------------------------------------------------------------
 *
 * De opname wordt nergens opgeslagen. Niet in Storage, niet in
 * medical.documents, niet op schijf. Ze komt binnen, gaat door naar de dienst,
 * en verdwijnt met het verzoek. Dat scheelt een bewaartermijn, een verwijderpad
 * en een stap in lib/purge/, en het is de reden dat dit bestand geen enkele
 * databankimport heeft.
 *
 * De transcriptie gaat ook niet rechtstreeks het gesprek in. Ze landt in het
 * invoerveld, waar de atleet haar naleest en corrigeert voor hij verstuurt. Een
 * tekst die ongezien als antwoord het dossier in gaat, is een medisch gegeven
 * waarvan niemand weet of het klopt, en spraakherkenning verstaat
 * "tendinopathie" nu eenmaal graag als iets anders.
 */

const DEFAULT_BASE_URL = "https://api.mistral.ai/v1";
const DEFAULT_MODEL = "voxtral-mini-latest";

/**
 * Wat de browser oplevert.
 *
 * MediaRecorder kiest zelf zijn container en zet er een codec achter, dus de
 * waarde die binnenkomt is "audio/webm;codecs=opus" en niet "audio/webm". De
 * controle kijkt daarom naar het deel voor de puntkomma.
 *
 * Mp4 en mpeg staan erbij voor Safari, dat geen webm schrijft.
 */
export const ACCEPTED_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
] as const;

/**
 * Tien megabyte, en dat is ruim: opus op 32 kbit/s doet daar ruim veertig
 * minuten over. De limiet is er niet voor de gebruiker maar voor het endpoint,
 * dat anders een plek is om een uur audio in te duwen.
 */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export function audioTypeAccepted(mimeType: string): boolean {
  const base = mimeType.split(";")[0]!.trim().toLowerCase();
  return (ACCEPTED_AUDIO_MIME_TYPES as readonly string[]).includes(base);
}

/** Of er een sleutel staat. De UI verbergt de knop als dit false is. */
export function transcriptionConfigured(): boolean {
  return Boolean(process.env.TRANSCRIBE_API_KEY);
}

export class TranscriptionUnavailableError extends Error {
  constructor() {
    super("er is geen transcriptiedienst geconfigureerd");
    this.name = "TranscriptionUnavailableError";
  }
}

/**
 * Eén opname omzetten.
 *
 * `locale` gaat als taalhint mee. Dat is geen detail: zonder hint moet het model
 * de taal zelf raden, en bij een korte opname met een anatomische term erin
 * ("mijn kuit") komt het dan met enige regelmaat op Engels uit.
 */
export async function transcribeAudio(
  audio: Blob,
  locale: Locale,
): Promise<string> {
  const apiKey = process.env.TRANSCRIBE_API_KEY;
  if (!apiKey) throw new TranscriptionUnavailableError();

  const baseUrl = (process.env.TRANSCRIBE_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const model = process.env.TRANSCRIBE_MODEL ?? DEFAULT_MODEL;

  const form = new FormData();
  // De bestandsnaam doet er wel toe: sommige aanbieders leiden het formaat af
  // uit de extensie in plaats van uit het content-type van het onderdeel.
  form.append("file", audio, `opname.${extensionFor(audio.type)}`);
  form.append("model", model);
  form.append("language", locale);

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    // De tekst van de aanbieder gaat naar de log en niet naar de atleet; hij kan
    // de naam van het model of een sleutelfragment bevatten.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `transcriptie mislukt (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  const body = (await response.json()) as { text?: unknown };
  if (typeof body.text !== "string") {
    throw new Error("transcriptie gaf geen tekst terug");
  }

  return body.text.trim();
}

function extensionFor(mimeType: string): string {
  const base = mimeType.split(";")[0]!.trim().toLowerCase();
  switch (base) {
    case "audio/ogg":
      return "ogg";
    case "audio/mp4":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    default:
      return "webm";
  }
}
