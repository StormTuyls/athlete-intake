import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { ReviewScreen } from "@/components/ReviewScreen";
import { checkCoach, isIntakeId } from "@/lib/review/access";

export async function generateMetadata() {
  const t = await getTranslations("titles");

  return {
    title: t("dossier"),
  robots: { index: false, follow: false },
  };
}

/**
 * Het coachdossier.
 *
 * De poort staat ook op de pagina zelf en niet alleen op de endpoints. Een
 * pagina die laadt en daarna "kon dossier niet laden" toont, vertelt een
 * bezoeker dat er iets is om te vinden.
 *
 * Wie niet ingelogd is gaat naar de login met een redirect terug, want dat is
 * een normale situatie. Wie wel ingelogd is maar geen coach, krijgt notFound():
 * die hoort niet te weten dat dit dossier bestaat.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ intakeId: string }>;
}) {
  const { intakeId } = await params;

  if (!isIntakeId(intakeId)) notFound();

  const access = await checkCoach();
  // Niet ingelogd hoort naar de login; ingelogd zonder coachrol hoort een 404 te
  // zien in plaats van een inlogformulier waar hij niets aan heeft.
  if (access.kind === "anonymous") redirect(`/coach/login?next=/review/${intakeId}`);
  if (access.kind !== "coach") notFound();

  return <ReviewScreen intakeId={intakeId} />;
}
