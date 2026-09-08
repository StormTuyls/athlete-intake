import { Pool, types, type QueryResultRow } from "pg";

/**
 * Directe Postgres-verbinding voor het `medical`-schema.
 *
 * Waarom niet via PostgREST zoals de rest: dat schema staat met opzet niet in de
 * exposed schemas van Supabase. De HTTP-API die het internet aanspreekt heeft
 * dus geen route naar bijzondere categorie persoonsgegevens, ook niet als iemand
 * later per ongeluk een policy of een grant toevoegt. Dat is een sterkere
 * garantie dan "er staat geen policy op", en bij artikel 9-data is dat het
 * verschil tussen een uitleg en een incident.
 *
 * De verbinding gebruikt de rol intake_server, die alleen medical mag plus een
 * paar leesrechten in public. Geen superuser.
 */

/**
 * Een `date` blijft een tekst, en dat is geen smaakkwestie.
 *
 * node-pg maakt van een date-kolom standaard een JS Date op middernacht LOKALE
 * tijd. `toISOString()` rekent die daarna naar UTC, dus in de zomer in Belgie
 * ging elke datum er een dag vanaf: een blessure met onset 2026-02-10 kwam als
 * 2026-02-09 op het scherm en in het rapport. Gemeten, niet bedacht.
 *
 * Een kalenderdatum heeft geen tijdzone. Een geboortedatum, een onset en een
 * bewaartermijn zijn wat er staat, en die horen niet door een tijdzone heen te
 * gaan. Vandaar hier, aan de rand: elke date-kolom komt als "YYYY-MM-DD" binnen
 * en niemand hoeft er nog aan te denken.
 *
 * Timestamps (timestamptz) blijven wel een Date: dat zijn echte momenten.
 */
types.setTypeParser(types.builtins.DATE, (value) => value);

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL ontbreekt");

  pool = new Pool({
    connectionString,
    // Serverless: veel korte invocaties, dus een kleine pool per instantie en
    // verbindingen die niet blijven hangen.
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    ssl: connectionString.includes("127.0.0.1") || connectionString.includes("localhost")
      ? undefined
      : { rejectUnauthorized: true },
  });

  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, values);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

/**
 * Meerdere statements als één transactie. Nodig waar een halve schrijfactie een
 * dossier in een ongeldige toestand achterlaat, zoals een document zonder zijn
 * paginateksten.
 */
export async function transaction<T>(
  work: (run: <R extends QueryResultRow>(text: string, values?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await work(async <R extends QueryResultRow>(text: string, values: unknown[] = []) => {
      const queryResult = await client.query<R>(text, values);
      return queryResult.rows;
    });
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
