import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { IntakeAuthError, IntakeLockedError } from "@/lib/intake/session";
import { CoachAuthError } from "@/lib/review/access";

/**
 * Foutafhandeling voor route handlers.
 *
 * Naar buiten gaat een korte, neutrale melding. De echte fout gaat naar de
 * serverlog. Bij medische data is een stack trace of een databankmelding in een
 * HTTP-respons een informatielek, niet een gebruiksgemak.
 */
export async function handleError(error: unknown): Promise<NextResponse> {
  const t = await apiMessages();

  // Geen geldige coachsessie is geen serverfout. 401 zodat de client naar de
  // login kan sturen in plaats van een onbegrijpelijke 500 te tonen.
  if (error instanceof CoachAuthError) {
    return NextResponse.json({ error: t("signIn") }, { status: 401 });
  }

  if (error instanceof IntakeAuthError) {
    return NextResponse.json({ error: t("sessionExpired") }, { status: 401 });
  }

  // Geen fout van de gebruiker en geen serverfout: de toestand is veranderd.
  // 409 zodat de client kan verversen in plaats van opnieuw te proberen.
  if (error instanceof IntakeLockedError) {
    return NextResponse.json(
      { error: t("locked") },
      { status: 409 },
    );
  }

  console.error("[intake]", error);
  return NextResponse.json({ error: t("generic") }, { status: 500 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}
