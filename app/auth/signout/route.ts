import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { checkCoach } from "@/lib/review/access";

/**
 * Uitloggen. POST en niet GET, zodat een afbeelding of een prefetch iemand niet
 * ongevraagd uitlogt.
 *
 * Waar je daarna belandt hangt af van wie je WAS. Dat stond hier hardgecodeerd op
 * /coach/login, en dat is precies de helft van de gevallen fout: een atleet die
 * zich afmeldt op zijn thuisscherm kwam op het inlogscherm van de praktijk
 * terecht, met "meld je aan om intakes na te kijken" boven een formulier waar hij
 * nooit in komt.
 *
 * De rol wordt opgehaald VOOR het uitloggen, want daarna is er niets meer om hem
 * uit af te leiden. Geen `next`-parameter uit het formulier: dat is een
 * open-redirect die je dan weer moet dichttimmeren, en de server weet dit zelf.
 */
export async function POST(request: Request) {
  const check = await checkCoach();

  const supabase = await createServerSupabase();
  await supabase.auth.signOut();

  const back = check.kind === "coach" ? "/coach/login" : "/start";
  return NextResponse.redirect(new URL(back, new URL(request.url).origin));
}
