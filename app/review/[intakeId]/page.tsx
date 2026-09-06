import { notFound } from "next/navigation";
import { ReviewScreen } from "@/components/ReviewScreen";
import { isIntakeId, reviewAccessAllowed } from "@/lib/review/access";

export const metadata = {
  title: "Dossier",
  robots: { index: false, follow: false },
};

/**
 * Het coachdossier. Staat dicht zolang er geen coach-login is.
 *
 * De poort staat ook op de pagina zelf en niet alleen op de endpoints. Een
 * pagina die laadt en daarna "kon dossier niet laden" toont, vertelt een
 * bezoeker dat er iets is om te vinden. notFound() vertelt niets.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ intakeId: string }>;
}) {
  const { intakeId } = await params;

  if (!reviewAccessAllowed() || !isIntakeId(intakeId)) notFound();

  return <ReviewScreen intakeId={intakeId} />;
}
