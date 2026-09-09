import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { handleError } from "@/lib/http";
import { appDb } from "@/lib/supabase/service";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  toLocale,
} from "@/lib/i18n/locale";

/**
 * Het taalcookie vullen uit het profiel, na het inloggen.
 *
 * De derde laag uit lib/i18n/locale.ts. Nodig omdat een cookie aan een browser
 * hangt en een voorkeur aan een persoon: wie op een nieuw toestel inlogt heeft
 * geen cookie, en zou dan de standaardtaal krijgen terwijl zijn keuze in de
 * databank staat.
 *
 * Waarom een aparte aanroep en niet in proxy.ts: dat bestand doet met opzet bijna
 * niets en draait bij elke aanvraag. Een query per pageview om een cookie te
 * vullen dat na één keer al goed staat, is werk op de verkeerde plek. Dit loopt
 * één keer per aanmelding.
 *
 * Server components kunnen geen cookies zetten, dus het moet een route zijn.
 */
export async function POST() {
  try {
    const supabase = await createServerSupabase();
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      return NextResponse.json({ error: "geen sessie" }, { status: 401 });
    }

    const { data: profile } = await appDb()
      .from("profiles")
      .select("locale")
      .eq("id", auth.user.id)
      .maybeSingle();

    const locale = toLocale(profile?.locale ?? DEFAULT_LOCALE);
    const store = await cookies();

    store.set(LOCALE_COOKIE, locale, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
    });

    return NextResponse.json({ locale });
  } catch (error) {
    return handleError(error);
  }
}
