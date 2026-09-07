/**
 * De bewaartermijn in woorden, voor de consenttekst.
 *
 * Het ontwerp zet er "retained for 24 months" bij. Dat mag alleen op het scherm
 * staan als het waar is, en het is instelbaar: RETENTION_MODE is standaard
 * `indefinite` met een benoemde grond, en dan is 24 maanden een onjuiste
 * mededeling in de tekst waar iemand toestemming voor geeft. Consent die iets
 * anders belooft dan het systeem doet, is geen geldige consent.
 *
 * Vandaar dat de zin uit de configuratie komt en niet uit het ontwerp.
 */
export function retentionSentence(): string {
  const indefinite = (process.env.RETENTION_MODE ?? "indefinite") === "indefinite";

  if (indefinite) {
    return "Your record is kept for as long as your care continues, and can be deleted on request.";
  }

  const months = Number(process.env.RETENTION_MONTHS ?? 60);
  return `Your record is retained for ${months} months and can be deleted on request.`;
}
