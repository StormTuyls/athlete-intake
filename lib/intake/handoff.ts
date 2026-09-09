"use client";

/**
 * Bestanden die op het thuisscherm gekozen zijn en in het gesprek horen.
 *
 * Een variabele op moduleniveau en geen context of query-parameter. De reden is
 * de vorm van het probleem: een File bestaat alleen in het geheugen van deze
 * tab, is niet serialiseerbaar, en hoeft precies één navigatie te overleven.
 * Een context zou er een gedeelde toestandsboom voor optuigen die verder niets
 * doet, en een URL kan een bestand sowieso niet dragen.
 *
 * Dat de navigatie client-side is, is de voorwaarde: router.push houdt dezelfde
 * module in leven. Bij een harde herlaadactie ertussen is de lijst weg, en dan
 * is er niets geupload. Dat is de goede kant om te falen.
 */

let pending: File[] = [];

export function stashFiles(files: File[]): void {
  pending = files;
}

/** Eenmalig: een tweede aanroep geeft niets, ook onder StrictMode. */
export function takeFiles(): File[] {
  const files = pending;
  pending = [];
  return files;
}
