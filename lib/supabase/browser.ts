import { createBrowserClient } from "@supabase/ssr";

/**
 * Client voor de browser. Ziet alleen het `public`-schema, achter RLS.
 * Het `medical`-schema is niet via PostgREST bereikbaar, per constructie.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
