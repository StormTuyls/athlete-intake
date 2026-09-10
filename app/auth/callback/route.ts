import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * De landing van een magic link.
 *
 * Twee vormen worden ondersteund, want welke er komt hangt af van de
 * e-mailtemplate in het Supabase-project:
 *
 *   ?code=...                   PKCE, uitwisselen voor een sessie
 *   ?token_hash=...&type=...    de servervariant, verifyOtp
 *
 * Beide afhandelen scheelt een projectinstelling die stil kan afwijken tussen
 * lokaal en productie, en dat is precies het soort verschil dat je pas merkt
 * wanneer een coach niet binnen kan.
 *
 * `next` wordt gecontroleerd op vorm. Een open redirect vanuit een
 * authenticatieroute is hoe iemand een inlogmail gebruikt om een bezoeker naar
 * zijn eigen pagina te sturen.
 */
function safeNext(value: string | null): string {
  if (!value) return "/coach";
  // Alleen paden binnen deze app. Geen protocol, geen host, geen
  // protocol-relatieve //evil.example.
  if (!value.startsWith("/") || value.startsWith("//")) return "/coach";
  return value;
}

/**
 * Waar iemand heen gaat als de link niet meer werkt.
 *
 * Dit was altijd /coach/login, en dat klopte zolang alleen behandelaars een
 * link kregen. Met een herstelmail komt ook een atleet hier, en die heeft niets
 * te zoeken op het inlogscherm van de praktijk.
 *
 * Bij herstel gaat hij naar het herstelscherm zelf: dat ziet dat er geen sessie
 * is en zegt dat de link verlopen is, met een knop om een nieuwe aan te vragen.
 * Dat is een antwoord; een leeg inlogformulier is dat niet.
 *
 * Nog steeds geen reden in de URL. Waarom een link niet werkt (verlopen, al
 * gebruikt, onbekend adres) is informatie over wie hier een account heeft.
 */
function failureTarget(next: string): string {
  if (next.startsWith("/auth/reset")) return "/auth/reset";
  if (next.startsWith("/coach")) return "/coach/login?error=link";
  return "/start?error=link";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  const supabase = await createServerSupabase();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    console.error("[auth]", error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "email" | "magiclink" | "recovery" | "invite",
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    console.error("[auth]", error.message);
  }

  return NextResponse.redirect(new URL(failureTarget(next), url.origin));
}
