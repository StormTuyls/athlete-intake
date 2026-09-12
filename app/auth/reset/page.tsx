import { getTranslations } from "next-intl/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { ResetPassword } from "@/components/auth/ResetPassword";

export async function generateMetadata() {
  const t = await getTranslations("titles");

  return {
    title: t("password"),
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/**
 * Een nieuw wachtwoord kiezen, na de link uit de herstelmail.
 *
 * De sessie wordt hier server-side gecontroleerd en niet in de browser: of de
 * link nog geldig was, is het enige dat bepaalt of dit scherm een formulier of
 * een melding toont, en dat hoort vast te staan voordat er iets rendert.
 *
 * getUser() en niet getSession(), zoals overal in deze codebase: de eerste laat
 * de authserver het token valideren.
 */
export default async function ResetPage() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();

  return <ResetPassword signedIn={!error && Boolean(data.user)} />;
}
