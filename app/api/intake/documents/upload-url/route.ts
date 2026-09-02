import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { storage, DOCUMENTS_BUCKET } from "@/lib/supabase/service";
import { requireIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";

/**
 * Signed upload URL voor één bestand.
 *
 * Het bestand gaat rechtstreeks van browser naar opslag, dus nooit door een
 * function. Geen bodylimiet om omheen te werken, en de bytes staan in de opslag
 * voordat er ook maar iets geanalyseerd is. Dat is de goede volgorde: het ruwe
 * bestand blijft bewaard, ook als de verwerking daarna klapt.
 */

const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "text/plain",
  "text/csv",
]);

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const session = await requireIntake();

    if (!session.consentGrantedAt) {
      return badRequest("geef eerst toestemming voor het verwerken van je gegevens");
    }

    const body = (await request.json()) as {
      filename?: string;
      mimeType?: string;
      byteSize?: number;
    };

    if (!body.filename || !body.mimeType) {
      return badRequest("filename en mimeType zijn verplicht");
    }
    if (!ALLOWED.has(body.mimeType)) {
      return badRequest(`bestandstype ${body.mimeType} wordt niet geaccepteerd`);
    }
    if ((body.byteSize ?? 0) > MAX_BYTES) {
      return badRequest("bestand is groter dan 50 MB");
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
