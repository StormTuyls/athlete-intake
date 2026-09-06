import { NextResponse } from "next/server";
import { IntakeAuthError } from "@/lib/intake/session";

/**
 * Foutafhandeling voor route handlers.
 *
 * Naar buiten gaat een korte, neutrale melding. De echte fout gaat naar de
 * serverlog. Bij medische data is een stack trace of een databankmelding in een
 * HTTP-respons een informatielek, niet een gebruiksgemak.
 */
export function handleError(error: unknown): NextResponse {
  if (error instanceof IntakeAuthError) {
    return NextResponse.json({ error: "Your session has expired. Start the intake again." }, { status: 401 });
  }

  console.error("[intake]", error);
  return NextResponse.json({ error: "Something went wrong. Nothing you sent was lost." }, { status: 500 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}
