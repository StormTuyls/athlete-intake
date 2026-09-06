import { ReviewScreen } from "@/components/ReviewScreen";

export const metadata = {
  title: "Dossier",
  robots: { index: false, follow: false },
};

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ intakeId: string }>;
}) {
  const { intakeId } = await params;
  return <ReviewScreen intakeId={intakeId} />;
}
