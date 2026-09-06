import { cn } from "@/lib/cn";

/**
 * Een bericht in het gesprek.
 *
 * De atleet rechts in teal, de assistent links op wit. Kleur alleen is geen
 * onderscheid, dus de uitlijning doet het werk mee, en de rol staat in de
 * DOM-volgorde die een schermlezer voorleest.
 *
 * whitespace-pre-line omdat antwoorden regeleindes kunnen bevatten en die
 * anders wegvallen.
 */
export function MessageBubble({
  role,
  children,
  className,
}: {
  role: "assistant" | "athlete";
  children: React.ReactNode;
  className?: string;
}) {
  const isAthlete = role === "athlete";

  return (
    <div
      className={cn(
        "max-w-[85%] rounded-bubble px-3.5 py-2.5 text-sm whitespace-pre-line",
        isAthlete
          ? "ml-auto bg-brand-600 text-white shadow-bubble"
          : "mr-auto bg-surface text-ink shadow-bubble ring-1 ring-hairline ring-inset",
        className,
      )}
    >
      {children}
    </div>
  );
}
