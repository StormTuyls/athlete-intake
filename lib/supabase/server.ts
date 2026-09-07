import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Supabase-client voor server components en route handlers.
 *
 * Ziet alleen `public`, achter RLS, als de ingelogde gebruiker. Het
 * `medical`-schema komt hier niet langs: dat loopt via de directe
 * Postgres-verbinding in lib/db/sql.ts, en staat niet in de exposed schemas van
 * PostgREST. Die scheiding blijft dus ook met een ingelogde coach staan.
 *
 * Per request een nieuwe client, nooit een gedeelde: een client hergebruiken
 * tussen requests betekent de sessie van de ene gebruiker aan de andere geven.
 */
export async function createServerSupabase() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(cookiesToSet) {
          // In een server component kan dit niet: Next staat daar geen
          // Set-Cookie toe. Dat is geen fout maar de normale gang van zaken,
          // want proxy.ts vernieuwt de sessie al voordat het renderen begint.
          // Zonder deze try/catch klapt elke pagina op het moment dat het
          // token toevallig verlengd moet worden.
          try {
            for (const { name, value, options } of cookiesToSet) {
              store.set(name, value, options);
            }
          } catch {
            // Bewust stil. Zie hierboven.
          }
        },
      },
    },
  );
}
