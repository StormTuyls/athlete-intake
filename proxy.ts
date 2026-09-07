import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Sessies verlengen voordat er iets rendert.
 *
 * Heet proxy en niet middleware: dat is in Next 16 de nieuwe naam, en de
 * edge-runtime bestaat hier niet meer. Zie de upgradegids van versie 16.
 *
 * Dit bestand doet expres bijna niets: het haalt de gebruiker op, waardoor de
 * client een verlopen token vernieuwt, en schrijft de nieuwe cookies naar het
 * antwoord. Server components mogen geen cookies zetten, dus als dit hier niet
 * gebeurt gaat een verlengde sessie verloren en logt de coach willekeurig uit.
 *
 * Wat hier NIET gebeurt: autoriseren. Een proxy die beslist wie waar mag komen
 * is één configuratiefout van een open dossier af. Elke route en elke pagina
 * controleert zelf, met requireCoach(). Dit is alleen onderhoud aan de sessie.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Moet vroeg gebeuren: komt de verlenging binnen nadat het antwoord al
  // verstuurd is, dan kan de nieuwe sessie niet meer weggeschreven worden.
  await supabase.auth.getUser();

  // Een antwoord met een vernieuwde sessie mag nooit in een cache of CDN
  // belanden; dan krijgt de volgende bezoeker die cookies.
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}

export const config = {
  // Alleen waar een sessie iets betekent. De atleetintake staat er nu ook bij:
  // sinds er accounts zijn, hangt ook /intake aan een Supabase-sessie en niet
  // meer alleen aan het capability-token.
  matcher: [
    "/",
    "/home/:path*",
    "/start/:path*",
    "/intake/:path*",
    "/coach/:path*",
    "/review/:path*",
    "/api/intake/:path*",
    "/api/athlete/:path*",
    "/api/review/:path*",
  ],
};
