import { queryOne } from "@/lib/db/sql";
import { purgeStorage } from "@/lib/purge/storage";

/**
 * Een concept weggooien.
 *
 * Waarom dit bestaat: een intake had maar één uitgang, en dat was hem afmaken.
 * De assistent stopt pas met vragen als er geen enkel gat meer open staat, en
 * na de vijftien verplichte velden staan er nog vijfentwintig optionele; een
 * gat sluit alleen met een waarde, dus "dat weet ik niet" sluit niets. Wie
 * vastloopt op een vraag had geen knop. Dit is die knop.
 *
 * Twee helften, in deze volgorde, en de volgorde is niet willekeurig. Eerst de
 * databank, want die transactie is atomair en levert de opslagpaden op die
 * daarna nodig zijn. Klapt de bucketopruiming daarna, dan staan er bestanden
 * zonder rij, en dat is de minst erge van de twee mogelijke halve toestanden:
 * de omgekeerde volgorde laat een dossier achter dat naar bestanden wijst die
 * niet meer bestaan, en dat is een dossier dat liegt.
 *
 * Dezelfde volgorde en dezelfde reden als in lib/purge/purge.ts, waar een hele
 * atleet gewist wordt.
 */

export interface DiscardResult {
  discarded: boolean;
  /** Null als de intake al weg was. */
  athleteId: string | null;
  counts: Record<string, number>;
  filesRemoved: number;
  /** Waar als er na afloop niets meer onder de intake-prefix ligt. */
  storageEmpty: boolean;
}

interface FunctionResult {
  discarded: boolean;
  reason?: string;
  athlete_id?: string;
  counts?: Record<string, number>;
  storage_paths?: string[];
}

/**
 * Gooit de intake weg. Weigert alles wat geen concept meer is; die controle
 * staat in de databankfunctie, zodat geen enkele aanroeper hem kan overslaan.
 */
export async function discardIntake(input: {
  intakeId: string;
  /** Wie het deed, voor het auditspoor dat de functie zelf wegschrijft. */
  actorId: string | null;
  actorKind: "athlete" | "coach" | "admin" | "system";
}): Promise<DiscardResult> {
  const row = await queryOne<{ result: FunctionResult }>(
    `select medical.discard_intake($1, $2, $3) as result`,
    [input.intakeId, input.actorId, input.actorKind],
  );

  const result = row?.result;
  if (!result || !result.discarded) {
    return {
      discarded: false,
      athleteId: null,
      counts: {},
      filesRemoved: 0,
      storageEmpty: true,
    };
  }

  // De paden komen uit de functie omdat de documentrijen na de delete niet meer
  // bestaan. purgeStorage kijkt daarnaast zelf onder de intake-prefix, en dat
  // is nodig: een upload die strandde tussen de signed URL en de registratie
  // laat een bestand achter dat in geen enkele rij genoemd wordt.
  const storage = await purgeStorage({
    intakeIds: [input.intakeId],
    knownPaths: result.storage_paths ?? [],
  });

  return {
    discarded: true,
    athleteId: result.athlete_id ?? null,
    counts: result.counts ?? {},
    filesRemoved: storage.removed,
    storageEmpty: storage.verifiedEmpty,
  };
}
