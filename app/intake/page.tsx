import { IntakeFlow } from "@/components/IntakeFlow";

export const metadata = {
  title: "Intake",
  robots: { index: false, follow: false },
};

export default function IntakePage() {
  return <IntakeFlow />;
}
