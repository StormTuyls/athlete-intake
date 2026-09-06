import { chat } from "@/lib/intake/copy";

/**
 * Drie puntjes terwijl de beurt loopt.
 *
 * Het gesprek streamt niet: runChatTurn vraagt gestructureerde JSON en die is
 * pas bruikbaar als hij compleet is. Een beurt duurt daardoor merkbaar lang, en
 * dit is wat de wachttijd draaglijk maakt.
 *
 * De tekst staat in de DOM voor schermlezers; de puntjes zijn de visuele kant
 * van hetzelfde. Bij prefers-reduced-motion staan ze stil.
 */
export function TypingIndicator() {
  return (
    <div className="mr-auto flex max-w-[85%] items-center gap-1.5 rounded-bubble bg-surface px-3.5 py-3 shadow-bubble ring-1 ring-hairline ring-inset">
      <span className="sr-only">{chat.thinking}</span>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          aria-hidden
          className="size-1.5 rounded-chip bg-ink-faint motion-safe:animate-bounce"
          style={{ animationDelay: `${index * 140}ms`, animationDuration: "1.1s" }}
        />
      ))}
    </div>
  );
}
