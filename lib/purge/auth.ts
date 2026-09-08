import { createClient } from "@supabase/supabase-js";

/**
 * Het inlogaccount van de atleet verwijderen.
 *
 * Als laatste stap, en met het profiel-id uit het manifest. De richting doet
 * ertoe: `athletes.profile_id` is `on delete set null` en `profiles.id` is
 * `on delete cascade` naar auth.users. Wie eerst de gebruiker verwijdert,
 * verliest de koppeling naar de atleet die daarna nog opgeruimd moet worden.
 *
 * Blijft dit achterwege, dan houdt iemand een inlog die naar een leeg huis
 * leidt: hij kan aanmelden, en er is geen dossier, geen intake en geen
 * toestemming meer. Dat is geen verwijdering maar een half verwijderde persoon.
 */

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase-omgeving ontbreekt voor auth-beheer");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function purgeAuthUser(profileId: string | null): Promise<{
  userDeleted: boolean;
}> {
  // Een dossier zonder account: er is niets in te trekken.
  if (!profileId) return { userDeleted: false };

  const { error } = await adminClient().auth.admin.deleteUser(profileId);

  if (error) {
    // Al weg is het doel, geen fout. Elke andere fout wel: dan blijft er een
    // inlog bestaan voor iemand die verwijderd is.
    const status = (error as { status?: number }).status;
    if (status === 404) return { userDeleted: false };
    throw new Error(`inlogaccount verwijderen mislukt: ${error.message}`);
  }

  return { userDeleted: true };
}
