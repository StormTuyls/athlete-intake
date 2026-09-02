import type { DocumentPage } from "@/lib/extract/pages";

/**
 * Verifieert of een door het model opgegeven citaat werkelijk in de bron staat.
 *
 * Dit is de kern van de eerlijke betrouwbaarheidsindicatie: geen percentage dat
 * het model over zichzelf rapporteert, maar een controleerbaar feit.
 *
 * De match moet ruim zijn, want de brontekst en het citaat lopen legitiem
 * uiteen: PDF-tekstextractie zet afbreekstreepjes en harde regeleindes in
 * woorden, gebruikt ligaturen en typografische aanhalingstekens, en OCR wisselt
 * witruimte. Te streng matchen zou correcte citaten als onbetrouwbaar
 * bestempelen, en dat maakt de indicatie waardeloos in de andere richting.
 */

function normalise(input: string): string {
  return input
    .normalize("NFKD")
    // Diakritische tekens weg: OCR haalt ze wisselend op.
    .replace(/[̀-ͯ]/g, "")
    // Zachte afbreekstreepjes en afbreking over een regeleinde.
    .replace(/­/g, "")
    .replace(/-\s*\n\s*/g, "")
    // Typografische varianten gelijktrekken.
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/ /g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Overlappende tekenreeksen van vaste lengte, voor gedeeltelijke overeenkomst. */
function shingles(input: string, size: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + size <= input.length; i++) {
    out.add(input.slice(i, i + size));
  }
  return out;
}

const SHINGLE_SIZE = 6;
const MIN_OVERLAP = 0.85;
/** Korter dan dit is geen citaat maar een woord, en dus niet te verifieren. */
const MIN_QUOTE_LENGTH = 12;

export interface QuoteVerification {
  verified: boolean;
  /** De pagina waar het citaat gevonden is, ook als het model een andere opgaf. */
  pageNumber: number | null;
  /** 1 bij een exacte match, anders de gemeten overlap. Voor diagnose. */
  overlap: number;
}

export function verifyQuote(
  quote: string,
  pages: DocumentPage[],
): QuoteVerification {
  const needle = normalise(quote);
  if (needle.length < MIN_QUOTE_LENGTH) {
    return { verified: false, pageNumber: null, overlap: 0 };
  }

  // Exacte match na normalisatie is het normale geval.
  for (const page of pages) {
    if (normalise(page.text).includes(needle)) {
      return { verified: true, pageNumber: page.pageNumber, overlap: 1 };
    }
  }

  // Anders: hoeveel van het citaat komt letterlijk terug op een pagina.
  const needleShingles = shingles(needle, SHINGLE_SIZE);
  if (needleShingles.size === 0) {
    return { verified: false, pageNumber: null, overlap: 0 };
  }

  let best: QuoteVerification = { verified: false, pageNumber: null, overlap: 0 };

  for (const page of pages) {
    const haystack = normalise(page.text);
    let hits = 0;
    for (const shingle of needleShingles) {
      if (haystack.includes(shingle)) hits++;
    }
    const overlap = hits / needleShingles.size;
    if (overlap > best.overlap) {
      best = {
        verified: overlap >= MIN_OVERLAP,
        pageNumber: overlap >= MIN_OVERLAP ? page.pageNumber : null,
        overlap,
      };
    }
  }

  return best;
}
