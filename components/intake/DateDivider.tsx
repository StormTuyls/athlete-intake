import { SectionLabel } from "@/components/intake/SectionLabel";

/**
 * Het scheidingslijntje met datum en tijd tussen berichten van een andere dag.
 *
 * De tekst wordt door de aanroeper geformatteerd, en die formattering gebeurt
 * client-side. De transcriptie wordt na mount opgehaald, dus er is geen
 * server-rendering die op een andere tijdzone kan uitkomen dan de browser.
 */
export function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-hairline" aria-hidden />
      <SectionLabel>{label}</SectionLabel>
      <span className="h-px flex-1 bg-hairline" aria-hidden />
    </div>
  );
}
