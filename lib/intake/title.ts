/**
 * Waar een intake over gaat, in een paar woorden.
 *
 * Het ontwerp zet bij een eerdere intake "Shoulder — right", en dat stond hier
 * eerst bewust niet: een lichaamsdeel op een overzichtspagina is
 * gezondheidsinformatie, en het thuisscherm staat open op een telefoon in een
 * kleedkamer. Dat bezwaar is echt, maar het weegt niet op tegen drie regels
 * "Intake" onder elkaar waarin niemand de juiste terugvindt. Het is bovendien
 * je eigen dossier op je eigen scherm achter je eigen login.
 *
 * Waar het NIET komt: de atletenlijst op /coach. Dat is een lijst van mensen en
 * niet van dossiers, een atleet heeft er meerdere, en het is de pagina die je
 * open laat staan terwijl er iemand naast je zit.
 *
 * De titel wordt bij het lezen afgeleid en nergens opgeslagen. Een kolom op
 * public.intakes zou hetzelfde opleveren met een migratie erbij, maar dan staat
 * er gezondheidsinformatie in het schema dat de browser via PostgREST kan
 * bereiken. Het hele ontwerp van deze repo staat erop dat dat niet gebeurt.
 *
 * Dit bestand bevat alleen de types en de opmaak, en dus geen enkele import die
 * naar de databank leidt: het thuisscherm en de chatkop zijn clientcomponenten.
 * De query staat in lib/db/intakeTitle.ts, om dezelfde reden dat
 * transcriptTypes.ts los staat van transcript.ts.
 *
 * Eén afleiding voor alle schermen, en dat is de reden dat deze functies hier
 * staan en niet naast de query die ze toevallig als eerste nodig had. De
 * coachlijst had zijn eigen versie in lib/db/review.ts, met een andere volgorde
 * en een ongelokaliseerd woord voor de zijde. Twee schermen die hetzelfde
 * dossier anders noemen is geen schoonheidsfout: dan verwijst een coach in een
 * gesprek naar een titel die de atleet niet ziet staan.
 */

export type BodySide = "left" | "right" | "bilateral" | "unknown";

export type IntakeTitle =
  | { kind: "injury"; bodyRegion: string; side: BodySide; diagnosis: string | null }
  /** Uit de pijnlocatie of de eerste zin van de huidige klachten. */
  | { kind: "text"; text: string }
  | { kind: "none" };

/**
 * De vertaalde woorden die de opmaak nodig heeft.
 *
 * Meegegeven en niet hier opgehaald, zodat formatIntakeTitle een pure functie
 * blijft: de coach leest zijn eigen taal en de atleet de zijne, en de tekst
 * hangt dus aan het scherm en niet aan het dossier.
 */
export interface IntakeTitleLabels {
  left: string;
  right: string;
  bilateral: string;
  /** Als er nog niets bekend is. Meestal gewoon "Intake". */
  fallback: string;
}

/** Maximale lengte van een afgeleide titel. Daarboven wordt het een zin. */
const MAX_LENGTH = 44;

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Inkorten op een woordgrens.
 *
 * Midden in een woord afkappen leest als een defect, en bij "Lumbale wervelkol…"
 * weet je nog steeds niet waar het over gaat. Bij het laatste hele woord wel.
 */
function shorten(text: string): string {
  const single = text.replace(/\s+/g, " ").trim();
  // Eerste zin, want het klachtenveld is vrije tekst en soms een alinea.
  const sentence = single.split(/(?<=[.!?])\s/)[0] ?? single;
  if (sentence.length <= MAX_LENGTH) return sentence.replace(/[.]$/, "");

  const cut = sentence.slice(0, MAX_LENGTH);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 20 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/**
 * De titel als tekst.
 *
 * Scheidingsteken is een punt en geen kastlijntje. Het ontwerp tekent er een,
 * maar de rest van de interface scheidt met een punt ("Volledig · naar je coach
 * gestuurd") en twee scheidingstekens naast elkaar op een scherm leest als
 * slordigheid.
 */
export function formatIntakeTitle(
  title: IntakeTitle,
  labels: IntakeTitleLabels,
): string {
  if (title.kind === "none") return labels.fallback;
  if (title.kind === "text") return capitalise(shorten(title.text));

  const region = capitalise(shorten(title.bodyRegion));

  // 'unknown' krijgt geen woord. "Schouder · onbekend" zegt minder dan
  // "Schouder", en het suggereert dat er iets mis is met het dossier.
  const side = title.side === "unknown" ? "" : ` · ${labels[title.side]}`;

  // De diagnose alleen als hij kort genoeg is om een titel te blijven. Een
  // lijstregel die over twee regels valt is geen titel meer.
  const diagnosis =
    title.diagnosis && title.diagnosis.trim().length <= 60
      ? ` · ${title.diagnosis.trim()}`
      : "";

  return `${region}${side}${diagnosis}`;
}

/**
 * Zoals formatIntakeTitle, maar null als er niets bekend is.
 *
 * Voor de plekken die zelf al een terugval hebben en het verschil tussen "heet
 * zo" en "we weten het nog niet" willen kunnen zien.
 */
export function formatIntakeTitleOrNull(
  title: IntakeTitle,
  labels: Omit<IntakeTitleLabels, "fallback">,
): string | null {
  if (title.kind === "none") return null;
  return formatIntakeTitle(title, { ...labels, fallback: "" });
}

/**
 * Eén rij naar een titel: de terugvalketen.
 *
 * Los van de query zodat hij zonder databank te testen is. De volgorde is de
 * hele beslissing: een blessure-entry is het meest specifiek, de pijnlocatie
 * daarna, en de vrije tekst van de huidige klachten pas als laatste omdat die
 * een alinea kan zijn.
 */
export function titleFromRow(row: {
  bodyRegion: string | null;
  side: BodySide | null;
  diagnosis?: string | null;
  painLocation: string | null;
  complaints?: string | null;
}): IntakeTitle {
  if (row.bodyRegion?.trim()) {
    return {
      kind: "injury",
      bodyRegion: row.bodyRegion.trim(),
      side: row.side ?? "unknown",
      diagnosis: row.diagnosis?.trim() || null,
    };
  }
  if (row.painLocation?.trim()) return { kind: "text", text: row.painLocation.trim() };
  if (row.complaints?.trim()) return { kind: "text", text: row.complaints.trim() };
  return { kind: "none" };
}
