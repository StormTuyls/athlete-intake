import { cn } from "@/lib/cn";
import { chat } from "@/lib/intake/copy";
import { ConfidenceChip, confidenceVariant } from "@/components/intake/ConfidenceChip";
import { SectionLabel } from "@/components/intake/SectionLabel";
import { TagIcon } from "@/components/intake/icons";
import type { CaptureCard as CaptureCardData } from "@/lib/intake/transcriptTypes";

/**
 * Een veld dat de assistent zojuist heeft opgepikt.
 *
 * Bewust geen bubbel: dit is geen uitspraak van de assistent maar een gevolg
 * van wat de atleet zei. Als het eruitziet als een bericht, leest het als een
 * bewering, en dan gaat niemand er nog kritisch naar kijken.
 */
export function CaptureCardView({
  card,
  className,
}: {
  card: CaptureCardData;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card bg-surface p-3 shadow-card ring-1 ring-hairline ring-inset",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>{chat.fieldCaptured}</SectionLabel>
        <ConfidenceChip variant={confidenceVariant(card.confidence)} />
      </div>

      <div className="mt-2 flex items-start gap-2.5">
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-chip bg-brand-50 text-brand-600"
          aria-hidden
        >
          <TagIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">{card.label}</p>
          <p className="text-sm break-words text-ink">{card.value}</p>
        </div>
      </div>
    </div>
  );
}
