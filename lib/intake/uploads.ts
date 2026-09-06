/**
 * Welke bestandstypes de intake aanneemt, op een plek.
 *
 * Stond eerst alleen in de upload-url-route. Dat ging mis: die route liet
 * image/heic toe terwijl processDocument het niet aankan, dus een iPhonefoto
 * kwam wel binnen en klapte daarna. Zolang de lijst op twee plekken staat,
 * lopen ze uiteen. Nu is er een lijst, en die is ook het accept-attribuut van
 * de bestandskiezer, zodat het toestel het al aan de voorkant filtert.
 *
 * HEIC staat er bewust niet in: unpdf en de modelcall verwerken het niet, en
 * iemand een minuut laten wachten op een bestand dat sowieso geweigerd wordt is
 * erger dan het meteen niet aanbieden.
 */
export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
] as const;

export const ACCEPT_ATTRIBUTE = ACCEPTED_MIME_TYPES.join(",");

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Bestandsgrootte zoals een mens hem leest.
 *
 * Deelt door 1024 en niet door 1000, want dat is wat een besturingssysteem
 * naast hetzelfde bestand toont en een verschil van 5 procent met de Finder
 * levert onnodige vragen op.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
