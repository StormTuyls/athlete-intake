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

  // Geen reden meegeven in de URL: waarom een link niet werkt (verlopen, al
  // gebruikt, onbekend adres) is informatie over wie een account heeft.
  return NextResponse.redirect(new URL("/coach/login?error=link", url.origin));
}
