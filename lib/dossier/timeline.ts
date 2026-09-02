/**
 * De blessuretijdlijn samenstellen uit ruwe entries.
 *
 * medical.injury_events is een log: elk document dat een blessure noemt levert
 * een rij op, met zijn eigen herkomst. Dat is bewust, want zo blijft
 * traceerbaar welk document wat zei.
 *
 * Maar twee documenten die dezelfde hamstring beschrijven zijn niet twee
 * blessures. Op de echte testset leverde dat vier entries op waar er twee waren:
 * het kine-verslag en de WhatsApp-export noemden dezelfde klacht, en het verslag
 * noemde hem twee keer op verschillend detailniveau. Een coach die vier
 * blessures ziet waar er twee zijn, vertrouwt de tijdlijn niet meer.
 *
 * Dus: ruw bewaren, tijdlijn berekenen. Zelfde principe als bij de velden.
 */

export interface InjuryEntry {
  id: string;
  bodyRegion: string;
  side: string;
  diagnosis: string | null;
  onsetDate: string | null;
  endDate: string | null;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  quoteVerified: boolean;
}

export interface TimelineEntry extends InjuryEntry {
  /** Hoeveel bronnen deze blessure noemen. Één is normaal, meer is bevestiging. */
  sourceCount: number;
  /** De overige vermeldingen, zodat de coach ze kan nakijken. */
  alsoFoundIn: Array<{
    diagnosis: string | null;
    sourceDocumentId: string | null;
    sourcePage: number | null;
    sourceQuote: string | null;
  }>;
}

/** Lichaamsdeel normaliseren: "Hamstrings" en "hamstring" zijn hetzelfde. */
function normaliseRegion(region: string): string {
  return region
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    // Meervoud en de gebruikelijke zij-aanduidingen eruit: die zitten in `side`.
    .replace(/\b(linker|rechter|links|rechts|left|right)\b/g, "")
    .replace(/s$/, "")
    .trim();
}

/** Twee vermeldingen zonder onverenigbare datums, dus mogelijk dezelfde blessure. */
const SAME_EPISODE_DAYS = 60;

function datesCompatible(a: string | null, b: string | null): boolean {
  // Eén zonder datum kan altijd dezelfde episode zijn: veel bronnen noemen geen
  // datum, en dan is het lichaamsdeel het enige dat we hebben.
  if (!a || !b) return true;
  const days = Math.abs(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  return days <= SAME_EPISODE_DAYS;
}

function sameInjury(a: InjuryEntry, b: InjuryEntry): boolean {
  if (normaliseRegion(a.bodyRegion) !== normaliseRegion(b.bodyRegion)) return false;
  // 'unknown' sluit niets uit: een bron die de zijde niet noemt kan dezelfde
  // blessure bedoelen.
  if (a.side !== b.side && a.side !== "unknown" && b.side !== "unknown") return false;
  return datesCompatible(a.onsetDate, b.onsetDate);
}

/** De meest informatieve vermelding van een groep wordt de hoofdvermelding. */
function pickPrimary(group: InjuryEntry[]): InjuryEntry {
  return group.reduce((best, entry) => {
    const score = (candidate: InjuryEntry) =>
      (candidate.diagnosis ? candidate.diagnosis.trim().length : 0) +
      (candidate.onsetDate ? 50 : 0) +
      (candidate.quoteVerified ? 25 : 0);
    return score(entry) > score(best) ? entry : best;
  });
}

export function resolveInjuryTimeline(entries: InjuryEntry[]): TimelineEntry[] {
  const groups: InjuryEntry[][] = [];

  for (const entry of entries) {
    const group = groups.find((candidate) =>
      candidate.some((member) => sameInjury(member, entry)),
    );
    if (group) group.push(entry);
    else groups.push([entry]);
  }

  return groups
    .map((group) => {
      const primary = pickPrimary(group);
      const others = group.filter((entry) => entry.id !== primary.id);

      return {
        ...primary,
        // De vroegst bekende start en de laatst bekende einddatum uit de groep:
        // samen geven de bronnen een completere episode dan elk apart.
        onsetDate:
          group
            .map((entry) => entry.onsetDate)
            .filter((date): date is string => date !== null)
            .sort()[0] ?? null,
        endDate:
          group
            .map((entry) => entry.endDate)
            .filter((date): date is string => date !== null)
            .sort()
            .at(-1) ?? null,
        quoteVerified: group.some((entry) => entry.quoteVerified),
        sourceCount: new Set(
          group.map((entry) => entry.sourceDocumentId).filter(Boolean),
        ).size,
        alsoFoundIn: others.map((entry) => ({
          diagnosis: entry.diagnosis,
          sourceDocumentId: entry.sourceDocumentId,
          sourcePage: entry.sourcePage,
          sourceQuote: entry.sourceQuote,
        })),
      };
    })
    .sort((a, b) => {
      // Zonder datum onderaan: die kan niet in de tijdlijn geplaatst worden.
      if (!a.onsetDate && !b.onsetDate) return 0;
      if (!a.onsetDate) return 1;
      if (!b.onsetDate) return -1;
      return a.onsetDate.localeCompare(b.onsetDate);
    });
}
