import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Uitloggen. POST en niet GET, zodat een afbeelding of een prefetch iemand niet
 * ongevraagd uitlogt.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/coach/login", new URL(request.url).origin));
}
