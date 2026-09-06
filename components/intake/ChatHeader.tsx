import { cn } from "@/lib/cn";
import { chat } from "@/lib/intake/copy";
import { ChevronLeftIcon } from "@/components/intake/icons";
import { ProgressRing } from "@/components/intake/ProgressRing";

/**
 * De vaste kop boven het gesprek.
 *
 * De ondertitel zegt waar de assistent nu naar vraagt. Die sectie komt van de
 * server, uit het eerste openstaande gat, niet uit het laatste bericht: na een
 * upload verspringt het onderwerp en dan zou de kop achterlopen.
 */
export function ChatHeader({
  collecting,
  sectionsDone,
  sectionsTotal,
  requiredFilled,
  requiredTotal,
  onBack,
  className,
}: {
  /** Naam van de sectie waar nu naar gevraagd wordt, of null als alles beantwoord is. */
  collecting: string | null;
  sectionsDone: number;
  sectionsTotal: number;
  requiredFilled: number;
  requiredTotal: number;
  onBack?: () => void;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex items-center gap-3 border-b border-hairline bg-surface/95 px-4 py-3 backdrop-blur",
        className,
      )}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={chat.back}
          className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-chip text-ink-muted hover:bg-canvas"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[0.9375rem] font-semibold text-ink">{chat.title}</h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="size-1.5 shrink-0 rounded-chip bg-brand-600" aria-hidden />
          <span className="truncate">
            {collecting ? chat.collecting(collecting) : chat.collectingIdle}
          </span>
        </p>
      </div>

      <ProgressRing
        done={sectionsDone}
        total={sectionsTotal}
        label={chat.progressLabel(
          sectionsDone,
          sectionsTotal,
          requiredFilled,
          requiredTotal,
        )}
      />
    </header>
  );
}
