import { loadEnv } from "./env";
loadEnv();

import { createClient } from "@supabase/supabase-js";

/**
 * Maakt een behandelaar aan.
 *
 * Er is geen zelfregistratie, en dat is de bedoeling: wie het dossier van een
 * atleet mag lezen, wordt door de praktijk aangewezen en niet door wie het
 * formulier vindt. Daarom is dit een script en geen pagina.
 *
 * Twee stappen, want er hangt geen trigger aan auth.users: de gebruiker in
 * auth, en daarna de rij in public.profiles met de rol. Zonder die tweede stap
 * kan iemand inloggen en ziet hij niets, want requireCoach() leest de rol uit
 * profiles en niet uit het token.
 *
 * Gebruik: npm run coach:create -- naam@praktijk.be "Volledige Naam"
 */
async function main() {
  const [email, fullName] = process.argv.slice(2);
  if (!email) {
    throw new Error('gebruik: npm run coach:create -- e-mail "Volledige Naam"');
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Geen wachtwoord: inloggen gaat via een magic link. Wel meteen bevestigd,
  // anders moet er eerst een uitnodigingsmail langs voordat de eerste link
  // werkt, en dat is voor een lokale opzet alleen maar in de weg.
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  let userId = created.data.user?.id;

  if (created.error) {
    // Bestaat hij al, dan is dit script bedoeld om de rol goed te zetten.
    const existing = await admin.auth.admin.listUsers();
    const match = existing.data.users.find((user) => user.email === email);
    if (!match) throw new Error(`gebruiker aanmaken mislukt: ${created.error.message}`);
    userId = match.id;
    console.log("gebruiker bestond al, rol wordt bijgewerkt");
  }

  if (!userId) throw new Error("geen gebruiker-id");

  const { error } = await admin
    .from("profiles")
    .upsert({ id: userId, role: "coach", full_name: fullName ?? null, locale: "nl" });

  if (error) throw new Error(`profiel opslaan mislukt: ${error.message}`);

  console.log(`coach klaar: ${email} (${userId})`);
  console.log("inloggen via /coach/login; de link komt lokaal in Mailpit op http://127.0.0.1:54324");
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
