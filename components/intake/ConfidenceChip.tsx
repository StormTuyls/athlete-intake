"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { Confidence, ProposedBy } from "@/lib/types";

/**
 * Het chipje dat zegt hoe hard een waarde is.
 *
 * Drie dingen wijken bewust af van het ontwerp.
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
 *
 * Ten derde zegt het chipje eerst waar een waarde vandaan komt en pas daarna hoe
 * hard hij is. Het ontwerp kent alleen gradaties, en dan krijgt een antwoord dat
 * de atleet zelf intypte het label "citaat niet teruggevonden" terwijl er geen
 * document is om in te zoeken.
 */

export type ChipVariant =
  | "confirmed"
  | "you-confirmed"
  | "self-reported"
  | "high"
  | "unverified"
  | "inferred"
  | "needs-review"
  | "not-stated";

const VARIANTS: Record<ChipVariant, { className: string; dot: string }> = {
  confirmed: {
    className: "bg-brand-600 text-white",
    dot: "bg-white",
  },
  "you-confirmed": {
    className: "bg-brand-50 text-brand-700 ring-1 ring-brand-100 ring-inset",
    dot: "bg-brand-600",
  },
  "self-reported": {
    className: "bg-brand-50 text-brand-700 ring-1 ring-brand-100 ring-inset",
    dot: "bg-brand-500",
  },
  high: {
    className: "bg-brand-50 text-brand-700 ring-1 ring-brand-100 ring-inset",
    dot: "bg-brand-600",
  },
  unverified: {
    className: "bg-unverified-soft text-unverified ring-1 ring-hairline ring-inset",
    dot: "bg-unverified",
  },
  inferred: {
    className: "bg-warn-soft text-warn ring-1 ring-warn/20 ring-inset",
    dot: "bg-warn",
  },
  "needs-review": {
    className: "bg-warn-soft text-warn ring-1 ring-warn/20 ring-inset",
    dot: "bg-warn",
  },
  "not-stated": {
    className: "bg-canvas text-ink-faint ring-1 ring-hairline ring-inset",
    dot: "bg-ink-faint",
  },
};

/**
 * Welk chipje bij een veld hoort.
 *
 * Confidence alleen is niet genoeg, want het zegt hoe hard een waarde is en niet
 * waar hij vandaan komt. Die twee door elkaar halen levert precies één fout op,
 * en die is erg: een antwoord dat de atleet zelf intypte kreeg "Quote not
 * found", terwijl er geen document is waarin een citaat gezocht kon worden. Dat
 * zet iemand aan het zoeken naar een origineel dat niet bestaat, en dat is
 * slechter dan helemaal geen label.
 *
 * Dus eerst de herkomst, dan de hardheid.
 */
export function confidenceVariant(
  confidence: Confidence,
  proposedBy?: ProposedBy | null,
): ChipVariant {
  if (proposedBy === "coach") return "confirmed";

  // De atleet kan op twee manieren de bron zijn, en dat verschil is zichtbaar in
  // de data: bevestigt hij een waarde uit een document, dan is de herkomst van
  // dat voorstel meegekopieerd en blijft het citaat geverifieerd, dus high.
  // Typt hij zelf een antwoord, dan is er geen citaat om te verifieren en is het
  // medium. "You confirmed" en "You told us" zijn dus twee verschillende feiten.
  if (proposedBy === "athlete") {
    return confidence === "high" ? "you-confirmed" : "self-reported";
  }
  if (confidence === "high") return "high";
  if (confidence === "medium") return "unverified";
  return "inferred";
}

/**
 * Van variant naar berichtsleutel.
 *
 * De varianten houden hun streepjes, want die staan in de data en in de
 * confidenceVariant-regels; berichtsleutels met een streepje leest next-intl als
 * nesting. Vandaar één map in plaats van de sleutels omdopen.
 */
const MESSAGE_KEY: Record<ChipVariant, string> = {
  confirmed: "confirmed",
  "you-confirmed": "youConfirmed",
  "self-reported": "selfReported",
  high: "high",
  unverified: "unverified",
  inferred: "inferred",
  "needs-review": "needsReview",
  "not-stated": "notStated",
};

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
  const t = useTranslations("confidence");

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-chip px-2 py-0.5 text-label uppercase",
        spec.className,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-chip", spec.dot)} aria-hidden />
      {label ?? t(MESSAGE_KEY[variant] as never)}
    </span>
  );
}
