import { NextResponse } from "next/server";
import { IntakeAuthError } from "@/lib/intake/session";
import { CoachAuthError } from "@/lib/review/access";

/**
 * Foutafhandeling voor route handlers.
 *
 * Naar buiten gaat een korte, neutrale melding. De echte fout gaat naar de
 * serverlog. Bij medische data is een stack trace of een databankmelding in een
 * HTTP-respons een informatielek, niet een gebruiksgemak.
 */
export function handleError(error: unknown): NextResponse {
  // Geen geldige coachsessie is geen serverfout. 401 zodat de client naar de
  // login kan sturen in plaats van een onbegrijpelijke 500 te tonen.
  if (error instanceof CoachAuthError) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  if (error instanceof IntakeAuthError) {
    return NextResponse.json({ error: "Your session has expired. Start the intake again." }, { status: 401 });
  }

  console.error("[intake]", error);
  return NextResponse.json({ error: "Something went wrong. Nothing you sent was lost." }, { status: 500 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}
