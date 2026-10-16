import { NextResponse } from "next/server";
import { apiMessages, requestLocale } from "@/lib/i18n/server";
import { requireEditableIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { logAudit } from "@/lib/audit";
import {
  MAX_AUDIO_BYTES,
  TranscriptionUnavailableError,
  audioTypeAccepted,
  transcribeAudio,
  transcriptionConfigured,
} from "@/lib/intake/transcribe";

/**
 * Een opname omzetten naar tekst voor het invoerveld.
 *
 * Niet "een antwoord inspreken": de tekst komt terug naar de client en landt in
 * het invoerveld, waar de atleet hem naleest. Deze route schrijft niets in het
 * dossier. Zie lib/intake/transcribe.ts voor waarom dat zo is en waarom de
 * audio niet bij de browser blijft.
 */

// Een minuut audio duurt bij de dienst een paar seconden, maar de upload van een
// trage mobiele verbinding telt mee in de duur van de function.
export const maxDuration = 60;

/**
 * Of dicteren aanstaat. De Composer verbergt de microfoonknop als dit false is.
 *
 * Een GET op de route zelf en geen vlag in /api/intake/state of een prop door
 * drie componenten heen: het is één vraag die hoort bij precies dit endpoint, en
 * zo staat het antwoord op dezelfde plek als de reden ervoor.
 */
export async function GET() {
  try {
    await requireEditableIntake();
    return NextResponse.json({ available: transcriptionConfigured() });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const t = await apiMessages();
    const session = await requireEditableIntake();

    // Dezelfde poort als bij uploaden. Een ingesproken klacht is een medisch
    // gegeven, dus hij komt er niet in voordat de toestemming vastligt.
    if (!session.consentGrantedAt) {
      return badRequest(t("consentFirst"));
    }

    const form = await request.formData();
    const audio = form.get("audio");

    if (!(audio instanceof Blob)) {
      return badRequest(t("noRecording"));
    }

    if (!audioTypeAccepted(audio.type)) {
      return badRequest(t("unsupportedAudio"));
    }

    // Na het type en niet ervoor: een te groot bestand van het juiste type is een
    // andere melding dan een formaat dat we niet lezen.
    if (audio.size > MAX_AUDIO_BYTES) {
      return badRequest(t("recordingTooLong"));
    }

    // Een opname van niets is geen fout van de server. Gebeurt als iemand de
    // knop aantikt en meteen loslaat.
    if (audio.size === 0) {
      return badRequest(t("noRecording"));
    }

    const text = await transcribeAudio(audio, await requestLocale());

    // Wel vastleggen dat er gedicteerd is, niet wat er gezegd is. Het audit-spoor
    // mag geen dossierinhoud bevatten (zie lib/audit.ts), en de tekst zelf komt
    // straks als gewoon antwoord binnen via de chatroute.
    await logAudit({
      action: "insert",
      actorKind: "athlete",
      entitySchema: "medical",
      entityTable: "transcriptions",
      entityId: session.intakeId,
      detail: { bytes: audio.size, characters: text.length },
    });

    return NextResponse.json({ text });
  } catch (error) {
    if (error instanceof TranscriptionUnavailableError) {
      const t = await apiMessages();
      return NextResponse.json({ error: t("dictationOff") }, { status: 503 });
    }
    return handleError(error);
  }
}
