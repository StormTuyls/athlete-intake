import type { Confidence, FieldStatus, ProposedBy } from "@/lib/types";

/**
 * Het betrouwbaarheidsniveau is een regel, geen modeloutput. M3.
 *
 * Deze functie is met opzet puur en zonder IO, zodat de tabel uit het plan
 * één-op-één te testen is.
 */
export function deriveConfidence(input: {
  status: FieldStatus;
  proposedBy: ProposedBy;
  quoteVerified: boolean;
  typeValid: boolean;
}): Confidence {
  const { status, proposedBy, quoteVerified, typeValid } = input;

  if (status === "conflicting" || status === "inferred") return "low";
  if (proposedBy === "coach" || status === "confirmed") return "high";
  if (quoteVerified && typeValid) return "high";
  return "medium";
}
