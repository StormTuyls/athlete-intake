/**
 * Mergen van voorgestelde veldwaarden in het dossier. M3.
 *
 * Regels:
 * - Niets wordt overschreven. Een nieuwe waarde krijgt een nieuwe rij en de
 *   oude rij krijgt `superseded_by`. De historie is onderdeel van het audit-spoor.
 * - Twee bronnen met verschillende waarden voor hetzelfde veld leveren
 *   `conflicting` op. Het systeem kiest niet stil, de coach beslist.
 * - Een waarde van de coach verslaat altijd een waarde van het model.
 */
export function mergeProposals(): never {
  throw new Error("niet geïmplementeerd: M3");
}
