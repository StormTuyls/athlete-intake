import { storage, DOCUMENTS_BUCKET } from "@/lib/supabase/service";

/**
 * De bestanden van een atleet uit Storage halen.
 *
 * Twee bronnen, en dat is nodig. `medical.documents.storage_path` is de
 * administratie, maar een object kan in de bak staan zonder rij: de signed
 * upload-URL wordt uitgegeven voordat het document geregistreerd is (zie
 * app/api/intake/documents/upload-url/route.ts), dus een upload die halverwege
 * strandde laat een bestand achter dat nergens genoemd wordt. Alleen de
 * administratie volgen laat precies die bestanden staan, en dat zijn medische
 * documenten.
 *
 * Daarom: de paden uit het manifest EN alles wat onder de intake-prefix ligt, en
 * daarna opnieuw kijken of de prefix echt leeg is. Dat laatste is het verschil
 * tussen "we hebben een delete gestuurd" en "er staat niets meer".
 */

export interface StoragePurgeResult {
  removed: number;
  /** Waar als na het verwijderen geen enkel object meer onder de prefixen ligt. */
  verifiedEmpty: boolean;
}

const PAGE = 100;

/** Alles onder een prefix, ook als het meer dan één pagina is. */
async function listPrefix(prefix: string): Promise<string[]> {
  const found: string[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage()
      .from(DOCUMENTS_BUCKET)
      .list(prefix, { limit: PAGE, offset });

    if (error) throw new Error(`storage opvragen mislukt: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const object of data) found.push(`${prefix}/${object.name}`);
    if (data.length < PAGE) break;
  }

  return found;
}

export async function purgeStorage(input: {
  intakeIds: string[];
  knownPaths: string[];
}): Promise<StoragePurgeResult> {
  const paths = new Set(input.knownPaths);

  for (const intakeId of input.intakeIds) {
    for (const path of await listPrefix(intakeId)) paths.add(path);
  }

  if (paths.size === 0) return { removed: 0, verifiedEmpty: true };

  const { error } = await storage()
    .from(DOCUMENTS_BUCKET)
    .remove([...paths]);

  // Een pad dat al weg is levert geen fout op, dus een fout hier betekent echt
  // dat er iets niet lukte. Stil doorgaan zou een purge geslaagd noemen terwijl
  // de bestanden er nog staan.
  if (error) throw new Error(`storage opruimen mislukt: ${error.message}`);

  let verifiedEmpty = true;
  for (const intakeId of input.intakeIds) {
    if ((await listPrefix(intakeId)).length > 0) verifiedEmpty = false;
  }

  return { removed: paths.size, verifiedEmpty };
}
