import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db/sql";

export const dynamic = "force-dynamic";

/**
 * Of de app staat, en of hij bij de databank kan.
 *
 * Die tweede regel staat er omdat een app met een kapotte DATABASE_URL van
 * buiten gezond oogt: elk scherm dat Postgres aanspreekt zit achter een login,
 * dus zonder deze route is de praktijk de eerste die het merkt.
 *
 * Alleen waar of onwaar naar buiten. De foutmelding van pg noemt de host en de
 * rol, en die horen niet in een antwoord dat iedereen kan opvragen.
 */
export async function GET() {
  let db = false;
  try {
    await queryOne<{ ok: number }>("select 1 as ok");
    db = true;
  } catch {
    // Bewust stil. Zie hierboven.
  }

  return NextResponse.json(
    { status: db ? "ok" : "degraded", db, at: new Date().toISOString() },
    { status: db ? 200 : 503 },
  );
}
