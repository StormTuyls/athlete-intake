import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side client met service role. De enige weg naar het `medical`-schema.
 *
 * Regel: elke aanroep hiervan gebeurt pas na (1) sessiecheck, (2) autorisatie op
 * rol, en (3) een audit-log entry. Zie lib/dossier/access.ts (M6). Importeer dit
 * nooit in een client component.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt");

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "medical" },
  });
}
