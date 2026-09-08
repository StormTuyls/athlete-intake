import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { storage, DOCUMENTS_BUCKET } from "@/lib/supabase/service";
import { requireEditableIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/intake/uploads";

/**
 * Signed upload URL voor één bestand.
 *
 * Het bestand gaat rechtstreeks van browser naar opslag, dus nooit door een
 * function. Geen bodylimiet om omheen te werken, en de bytes staan in de opslag
 * voordat er ook maar iets geanalyseerd is. Dat is de goede volgorde: het ruwe
 * bestand blijft bewaard, ook als de verwerking daarna klapt.
 */

/**
 * Eén lijst, gedeeld met de bestandskiezer in de browser.
 *
 * Stond hier eerder los, met `image/heic` erin terwijl processDocument het niet
 * kan lezen. Een iPhonefoto kwam dus wel binnen, wachtte op de verwerking en
 * werd daarna geweigerd. Nu weigert de deur meteen, en het accept-attribuut van
 * de kiezer komt uit dezelfde lijst zodat het toestel het al filtert.
 */
const ALLOWED = new Set<string>(ACCEPTED_MIME_TYPES);

const MAX_BYTES = MAX_UPLOAD_BYTES;

export async function POST(request: Request) {
  try {
    const session = await requireEditableIntake();

    if (!session.consentGrantedAt) {
      return badRequest("Please give consent before we process your data.");
    }

    const body = (await request.json()) as {
      filename?: string;
      mimeType?: string;
      byteSize?: number;
    };

    if (!body.filename || !body.mimeType) {
      return badRequest("A filename and a file type are required.");
    }
    if (!ALLOWED.has(body.mimeType)) {
      return badRequest(
        `We cannot read ${body.mimeType} files. Please send a PDF, JPEG, PNG, text or CSV file.`,
      );
    }
    if ((body.byteSize ?? 0) > MAX_BYTES) {
      return badRequest("That file is larger than 50 MB.");
    }

    // Pad per intake, met een eigen id per bestand. De originele naam gaat naar
    // de databank, niet naar het pad: bestandsnamen bevatten regelmatig de naam
    // van de atleet en soms de diagnose.
    const extension = body.filename.split(".").pop()?.toLowerCase() ?? "bin";
    const path = `${session.intakeId}/${randomUUID()}.${extension}`;

    const { data, error } = await storage()
      .from(DOCUMENTS_BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data) {
      throw new Error(`upload-URL aanmaken mislukt: ${error?.message}`);
    }

    return NextResponse.json({
      path: data.path,
      token: data.token,
      bucket: DOCUMENTS_BUCKET,
    });
  } catch (error) {
    return handleError(error);
  }
}
