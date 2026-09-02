import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase-clients.
 *
 * Let op wat hier NIET staat: een client voor het `medical`-schema. Dat schema
 * is niet via PostgREST bereikbaar en wordt aangesproken via een directe
 * Postgres-verbinding in lib/db/sql.ts. Zou hier een medicalDb() staan, dan zou
 * `medical` alsnog in de exposed schemas moeten en was de hele scheiding weg.
 *
 * Importeer dit nooit in een client component.
 */

function credentials(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL ontbreekt");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt");
  return { url, key };
}

const AUTH = { persistSession: false, autoRefreshToken: false } as const;

/** Identiteit, intakes, consent, chat, audit. Het `public`-schema. */
export function appDb() {
  const { url, key } = credentials();
  return createClient(url, key, { auth: AUTH, db: { schema: "public" } });
}

/**
 * Alleen voor de private bucket met ruwe documenten. De bucket heeft geen
 * policies, dus enkel de service role komt erbij; de browser krijgt per bestand
 * een kortlevende signed URL.
 */
export function storage() {
  const { url, key } = credentials();
  return createClient(url, key, { auth: AUTH }).storage;
}

export const DOCUMENTS_BUCKET = "intake-documents";
