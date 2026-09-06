import { cn } from "@/lib/cn";

/**
 * Het kleine uppercase labeltje boven een kaart of veldrij.
 *
 * Eigen component omdat het op drie plekken terugkomt en de letterspacing
 * anders drie keer met de hand overgetypt wordt.
 */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("text-label uppercase text-ink-faint", className)}>
      {children}
    </span>
  );
}
