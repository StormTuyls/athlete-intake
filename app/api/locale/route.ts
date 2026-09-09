import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { handleError } from "@/lib/http";
import { appDb } from "@/lib/supabase/service";
import { currentAthlete } from "@/lib/intake/athlete";
import { currentCoach } from "@/lib/review/access";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
  type Locale,
} from "@/lib/i18n/locale";

/**
 * De taalkeuze.
 *
 * Drie schrijfacties, en elke laag heeft een eigen reden:
 *
 * 1. Het cookie. Daar leest i18n/request.ts uit, bij elke render, zonder query.
 * 2. De kolom bij de persoon (athletes.locale, profiles.locale). Nodig omdat een
 *    cookie op een ander toestel niet bestaat; bij inloggen wordt het cookie
 *    daaruit gevuld.
 * 3. `intakes.locale` van een DRAFT, en alleen van een draft.
 *
 * Dat derde punt is de subtiele: `intake.locale` zit in de gehashte inhoud van
 * een rapportsnapshot (zie lib/report/collect.ts). De taal van een ingediende
 * intake herschrijven zou dus stil een nieuwe rapportversie minten, met een
 * modelcall erbij, terwijl er inhoudelijk niets veranderde. Bij een draft bestaat
 * er nog geen bevroren versie, dus daar valt niets te verschuiven.
 *
 * Een route handler en geen server action, omdat deze codebase nul server actions
 * heeft en zeventien route handlers. Consistentie weegt hier zwaarder dan de ene
 * router.refresh() die je ermee uitspaart.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { locale?: string };

    if (!isLocale(body.locale)) {
      return NextResponse.json({ error: "onbekende taal" }, { status: 400 });
    }

    const locale: Locale = body.locale;
    const store = await cookies();

    store.set(LOCALE_COOKIE, locale, {
      // Niets in de browser hoeft dit te lezen: de knop stuurt een POST en
      // vraagt daarna een verse render op.
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
    });

    const db = appDb();
    const athlete = await currentAthlete();

    if (athlete) {
      await db.from("athletes").update({ locale }).eq("id", athlete.athleteId);
      await db.from("profiles").update({ locale }).eq("id", athlete.userId);
      // Alleen de lopende intake, zie de toelichting hierboven.
      await db
        .from("intakes")
        .update({ locale })
        .eq("athlete_id", athlete.athleteId)
        .eq("status", "draft");
    } else {
      const coach = await currentCoach();
      if (coach) {
        await db.from("profiles").update({ locale }).eq("id", coach.id);
      }
    }

    return NextResponse.json({ locale });
  } catch (error) {
    return handleError(error);
  }
}
