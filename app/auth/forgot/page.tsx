import { getTranslations } from "next-intl/server";
import { ForgotPassword } from "@/components/auth/ForgotPassword";

export async function generateMetadata() {
  const t = await getTranslations("titles");

  return {
    title: t("password"),
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/**
 * Een herstelmail aanvragen.
 *
 * `from` bepaalt alleen waar de terugknop heen gaat, en wordt op vorm
 * gecontroleerd: een pad binnen deze app, verder niets. Een authenticatiescherm
 * dat een willekeurige URL uit de adresbalk overneemt is hoe een link naar
 * "aanmelden" op een andere site uitkomt.
 */
export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const backTo = from === "coach" ? "/coach/login" : "/start";

  return <ForgotPassword backTo={backTo} />;
}
