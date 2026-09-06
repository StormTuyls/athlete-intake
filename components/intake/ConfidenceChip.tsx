import { cn } from "@/lib/cn";
import type { Confidence } from "@/lib/types";

/**
 * Het chipje dat zegt hoe hard een waarde is.
 *
 * Twee dingen wijken bewust af van het ontwerp.
 *
 * Ten eerste staat "medium" er niet als grade maar als wat het betekent: het
 * citaat van het model is niet teruggevonden in de paginatekst, meestal een scan
 * zonder tekstlaag. Voor wie een dossier nakijkt is dat het belangrijkste
 * signaal op de pagina, en "Medium" zegt daar niets over.
 *
 * Ten tweede krijgt die staat een eigen kleur. In het ontwerp zijn High en
 * Medium allebei teal, en dan ziet een onverifieerde waarde eruit als een
 * geverifieerde. Dat is precies de vergissing die de confidence-regels moeten
 * voorkomen.
 */

export type ChipVariant =
  | "confirmed"
  | "high"
  | "unverified"
  | "inferred"
  | "needs-review"
  | "not-stated";

const VARIANTS: Record<ChipVariant, { label: string; className: string; dot: string }> = {
  confirmed: {
    label: "Confirmed",
    className: "bg-brand-600 text-white",
    dot: "bg-white",
  },
  high: {
    label: "High",
    className: "bg-brand-50 text-brand-700 ring-1 ring-brand-100 ring-inset",
    dot: "bg-brand-600",
  },
  unverified: {
    label: "Quote not found",
    className: "bg-unverified-soft text-unverified ring-1 ring-hairline ring-inset",
    dot: "bg-unverified",
  },
  inferred: {
    label: "Inferred",
    className: "bg-warn-soft text-warn ring-1 ring-warn/20 ring-inset",
    dot: "bg-warn",
  },
  "needs-review": {
    label: "Needs review",
    className: "bg-warn-soft text-warn ring-1 ring-warn/20 ring-inset",
    dot: "bg-warn",
  },
  "not-stated": {
    label: "Not stated",
    className: "bg-canvas text-ink-faint ring-1 ring-hairline ring-inset",
    dot: "bg-ink-faint",
  },
};

/**
 * Confidence is afgeleid, nooit door het model zelf opgegeven (zie
 * lib/dossier/completeness.ts). Deze mapping voegt niets toe, hij vertaalt.
 */
export function confidenceVariant(confidence: Confidence): ChipVariant {
  if (confidence === "high") return "high";
  if (confidence === "medium") return "unverified";
  return "inferred";
}

export function ConfidenceChip({
  variant,
  label,
  className,
}: {
  variant: ChipVariant;
  /** Overschrijft de standaardtekst, bijvoorbeeld "Medium confidence · from OCR". */
  label?: string;
  className?: string;
}) {
  const spec = VARIANTS[variant];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-chip px-2 py-0.5 text-label uppercase",
        spec.className,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-chip", spec.dot)} aria-hidden />
      {label ?? spec.label}
    </span>
  );
}
