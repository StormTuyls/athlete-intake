import { loadEnv } from "./env";
loadEnv();

import { randomBytes } from "node:crypto";
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
 * Het wachtwoord wordt hier gezet en één keer afgedrukt. Er is nog geen
 * herstelflow per e-mail, dus dit script is ook de manier om een wachtwoord
 * opnieuw te zetten. Voor een praktijk met een handvol behandelaars is dat een
 * werkbare afspraak; voor echt gebruik hoort er een herstelmail bij, en dat
 * staat als openstaand punt in de README.
 *
 * Gebruik: npm run coach:create -- naam@praktijk.be "Volledige Naam" [wachtwoord]
 */
function generatePassword(): string {
  // Leesbaar genoeg om over te typen, lang genoeg om niet te raden. Geen
  // tekens die in een terminal of een mail verminkt raken.
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function main() {
  const [email, fullName, given] = process.argv.slice(2);
  if (!email) {
    throw new Error('gebruik: npm run coach:create -- e-mail "Volledige Naam" [wachtwoord]');
  }

  const password = given ?? generatePassword();
  if (password.length < 12) {
    throw new Error("wachtwoord moet minstens 12 tekens zijn");
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Meteen bevestigd: er is geen uitnodigingsmail in deze opzet, en een account
  // dat niet kan inloggen tot iemand een mail opent is voor een praktijk die
  // zelf de accounts aanmaakt alleen maar in de weg.
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  let userId = created.data.user?.id;

  if (created.error) {
    // Bestaat hij al, dan is dit script bedoeld om de rol goed te zetten.
    const existing = await admin.auth.admin.listUsers();
    const match = existing.data.users.find((user) => user.email === email);
    if (!match) throw new Error(`gebruiker aanmaken mislukt: ${created.error.message}`);
    userId = match.id;
    // Bestond hij al, dan is dit script ook de manier om het wachtwoord opnieuw
    // te zetten, want er is nog geen herstelflow.
    const updated = await admin.auth.admin.updateUserById(match.id, { password });
    if (updated.error) throw new Error(`wachtwoord zetten mislukt: ${updated.error.message}`);
    console.log("gebruiker bestond al: rol en wachtwoord bijgewerkt");
  }

  if (!userId) throw new Error("geen gebruiker-id");

  const { error } = await admin
    .from("profiles")
    .upsert({ id: userId, role: "coach", full_name: fullName ?? null, locale: "nl" });

  if (error) throw new Error(`profiel opslaan mislukt: ${error.message}`);

  console.log(`coach klaar: ${email} (${userId})`);
  console.log(`wachtwoord: ${password}`);
  console.log("inloggen via /coach/login. Dit wachtwoord staat hier één keer.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
