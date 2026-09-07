import assert from "node:assert/strict";
import { resolveField } from "../../lib/dossier/merge";
import type { FieldDefinition, Proposal } from "../../lib/types";

/**
 * Een correctie van een mens mag niet verliezen van zijn eigen eerdere antwoord.
 *
 * resolveField koos bij niet-conflictgevoelige velden de LANGSTE waarde in de
 * toptier. Dat is juist voor twee documenten die dezelfde klacht beschrijven,
 * maar fout voor iemand die zichzelf corrigeert: schrappen maakt de tekst korter,
 * dus won de oude waarde en verdween de correctie geruisloos.
 *
 * Deze test legt beide kanten vast, want de oorspronkelijke reden mag niet
 * sneuvelen bij het repareren van de nieuwe.
 */

const longText: FieldDefinition = {
  key: "medical.current_complaints",
  section: "medical_history",
  sortOrder: 4,
  labelNl: "Huidige klachten",
  labelEn: "Current complaints",
  dataType: "long_text",
  required: true,
  isMedical: true,
  enumOptions: null,
  questionNl: null,
  questionEn: null,
};

function proposal(input: Partial<Proposal> & { id: number; value: unknown }): Proposal {
  return {
    fieldKey: longText.key,
    proposedBy: "athlete",
    sourceDocumentId: null,
    sourcePage: null,
    sourceQuote: null,
    quoteVerified: false,
    modelId: null,
    createdAt: new Date().toISOString(),
    ...input,
  };
}

// 1. De atleet corrigeert zichzelf, korter. Het nieuwste antwoord moet winnen.
const corrected = resolveField(longText, [
  proposal({ id: 1, value: "Lage rugpijn links, scherp bij flexie met uitstraling naar het been" }),
  proposal({ id: 2, value: "Lage rugpijn links" }),
]);

assert.equal(
  corrected.value,
  "Lage rugpijn links",
  "een kortere correctie van de atleet moet zijn eigen eerdere antwoord verslaan",
);
assert.equal(corrected.winningProposalId, 2);
assert.equal(corrected.status, "extracted");

// 2. Twee documenten die elkaar aanvullen: de volledigste beschrijving wint nog
//    steeds. Dit is de reden waarvoor mostInformative bestaat.
const merged = resolveField(longText, [
  proposal({
    id: 1,
    value: "Lage rugpijn links, scherp bij voorwaartse flexie",
    proposedBy: "model",
    sourceDocumentId: "11111111-1111-4111-8111-111111111111",
    sourceQuote: "lage rugpijn links, scherp bij voorwaartse flexie",
    modelId: "claude-opus-5",
  }),
  proposal({
    id: 2,
    value: "Lage rugpijn links",
    proposedBy: "model",
    sourceDocumentId: "22222222-2222-4222-8222-222222222222",
    sourceQuote: "lage rugpijn links",
    modelId: "claude-opus-5",
  }),
]);

assert.equal(
  merged.value,
  "Lage rugpijn links, scherp bij voorwaartse flexie",
  "tussen twee documenten wint de volledigste beschrijving",
);

// 3. De atleet verslaat het model, ook als het model uitgebreider was. Rangorde
//    gaat voor volledigheid.
const overrules = resolveField(longText, [
  proposal({
    id: 1,
    value: "Lage rugpijn links, scherp bij flexie met uitstraling naar het been",
    proposedBy: "model",
    sourceDocumentId: "11111111-1111-4111-8111-111111111111",
    sourceQuote: "lage rugpijn links, scherp bij flexie met uitstraling",
    modelId: "claude-opus-5",
  }),
  proposal({ id: 2, value: "Lage rugpijn links" }),
]);

assert.equal(overrules.value, "Lage rugpijn links");
assert.equal(overrules.proposedBy, "athlete");

console.log("merge-correction: kortere correctie wint, documenten vullen elkaar nog aan");
