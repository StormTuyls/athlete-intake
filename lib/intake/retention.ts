import { z } from "zod";

/**
 * De bewaartermijn, op één plek.
 *
 * Stond eerder op twee plekken met eigen standaardwaarden: hier voor de
 * consenttekst, en in lib/intake/consent.ts voor de datum die in de databank
 * belandt. Twee lezers van dezelfde variabelen die elk hun eigen `?? 60`
 * meenamen, dus een half ingevulde omgeving kon een tekst opleveren die iets
 * anders belooft dan de opgeslagen termijn. Bij consent is dat niet een
 * schoonheidsfoutje: een toestemming die iets anders zegt dan het systeem doet
 * is geen geldige toestemming.
 *
 * Met zod erlangs, zodat RETENTION_MONTHS=zestig hard stukloopt in plaats van
 * NaN maanden te worden. Een onbeperkte bewaring vraagt een benoemde grond, net
 * als de check-constraint op public.athletes: die eist het, dus het is beter dat
 * de applicatie het eerder en met een leesbare melding weigert.
 */

const schema = z
  .object({
    mode: z.enum(["indefinite", "until_date"]).default("indefinite"),
    months: z.coerce.number().int().positive().max(1200).default(60),
    basis: z.string().trim().min(1).optional(),
  })
  .refine((value) => value.mode !== "indefinite" || Boolean(value.basis), {
    message:
      "RETENTION_MODE=indefinite vraagt een RETENTION_BASIS: onbeperkt bewaren mag alleen met een benoemde grond",
  });

export type RetentionConfig = z.infer<typeof schema>;

/**
 * De grond die de praktijk aanvoert als er geen in de omgeving staat.
 *
 * Stond eerder in lib/intake/consent.ts. Hier hoort hij, naast de rest van de
 * termijn.
 */
export const DEFAULT_BASIS =
  "Zorgdossier van een begeleide atleet. Bewaard met expliciete toestemming; de atleet kan op elk moment verwijdering vragen.";

/** Zolang een aanmelding niet afgerond is, blijft er geen dossier hangen. */
export const PRE_CONSENT_DAYS = 30;

export function retentionConfig(): RetentionConfig {
  const parsed = schema.safeParse({
    mode: process.env.RETENTION_MODE,
    months: process.env.RETENTION_MONTHS,
    basis: process.env.RETENTION_BASIS ?? DEFAULT_BASIS,
  });

  if (!parsed.success) {
    throw new Error(
      `bewaartermijn niet geldig ingesteld: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  return parsed.data;
}

/** De einddatum die bij deze instelling hoort, of null bij onbeperkt. */
export function retentionUntil(from: Date = new Date()): string | null {
  const config = retentionConfig();
  if (config.mode === "indefinite") return null;

  const until = new Date(from);
  until.setMonth(until.getMonth() + config.months);
  return until.toISOString().slice(0, 10);
}

/** De korte termijn tussen aanmaken en het geven van toestemming. */
export function preConsentUntil(from: Date = new Date()): string {
  const until = new Date(from.getTime() + PRE_CONSENT_DAYS * 86_400_000);
  return until.toISOString().slice(0, 10);
}

/**
 * De bewaartermijn in woorden, voor de consenttekst.
 *
 * Het ontwerp zet er "retained for 24 months" bij. Dat mag alleen op het scherm
 * staan als het waar is: bij RETENTION_MODE=indefinite is 24 maanden een
 * onjuiste mededeling in precies de tekst waar iemand toestemming voor geeft.
 */
export function retentionSentence(): string {
  const config = retentionConfig();

  if (config.mode === "indefinite") {
    return "Your record is kept for as long as your care continues, and can be deleted on request.";
  }

  return `Your record is retained for ${config.months} months and can be deleted on request.`;
}
