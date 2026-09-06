import { cn } from "@/lib/cn";

/**
 * De voortgangsring in de chatheader.
 *
 * Toont secties, niet velden. Het ontwerp zegt "2/9", maar de taxonomie heeft
 * zeven secties en 41 velden; er zijn geen negen van iets. Secties lezen als
 * hoofdstukken en dat past bij de "Collecting: ..."-ondertitel eronder.
 *
 * Het getal dat er juridisch toe doet is een ander: requiredFilled van
 * requiredTotal poort readyToSubmit. Dat staat daarom in het aria-label en de
 * title, zodat het bereikbaar blijft zonder de header vol te zetten.
 *
 * Twee cirkels en een dashoffset, geen chartbibliotheek.
 */
export function ProgressRing({
  done,
  total,
  label,
  size = 44,
  className,
}: {
  done: number;
  total: number;
  /** Volledige omschrijving voor schermlezers, inclusief de verplichte velden. */
  label: string;
  size?: number;
  className?: string;
}) {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.min(Math.max(done / safeTotal, 0), 1);

  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      title={label}
    >
      <svg width={size} height={size} role="img" aria-label={label}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-brand-600)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          // Vanaf twaalf uur met de klok mee, anders begint hij rechts.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500"
        />
      </svg>
      <span
        className="absolute text-[0.625rem] font-semibold tabular-nums text-ink-muted"
        aria-hidden
      >
        {done}/{total}
      </span>
    </span>
  );
}
