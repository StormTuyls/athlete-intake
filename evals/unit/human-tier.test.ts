import assert from "node:assert/strict";
import { resolveField } from "../../lib/dossier/merge";
import type { FieldDefinition, Proposal } from "../../lib/types";

/**
 * Een mens die zich uitspreekt lost een conflict op, hij maakt er geen nieuw.
 *
 * resolveField zag elk afwijkend voorstel in de toptier als rivaal, ook het
 * eerdere voorstel van dezelfde soort actor. Gevolg: de coach corrigeert een
 * tegenstrijdige geboortedatum, en het veld blijft `conflicting` omdat zijn
 * eigen eerste poging nu de rivaal is. Dat maakt de correctieknop een knop die
 * het probleem verplaatst in plaats van oplost, en het blokkeert goedkeuren.
 *
 * Deze test legt beide kanten vast: tussen documenten blijft een conflict een
 * conflict, want dat signaal is de reden dat het mechanisme bestaat.
 */

const birthDate: FieldDefinition = {
  key: "identity.date_of_birth",
  section: "identity",
  sortOrder: 2,
  labelNl: "Geboortedatum",
  labelEn: "Date of birth",
  dataType: "date",
  required: true,
  isMedical: false,
  enumOptions: null,
  questionNl: "Wat is je geboortedatum?",
  questionEn: "What is your date of birth?",
};

function proposal(input: Partial<Proposal> & { id: number; value: unknown }): Proposal {
  return {
    fieldKey: birthDate.key,
    proposedBy: "model",
    sourceDocumentId: null,
    sourcePage: null,
    sourceQuote: null,
    quoteVerified: false,
    modelId: null,
    createdAt: new Date().toISOString(),
    ...input,
  };
}

const fromDocument = (id: number, value: string, document: string): Proposal =>
  proposal({
    id,
    value,
    proposedBy: "model",
    sourceDocumentId: document,
    sourcePage: 1,
    sourceQuote: value,
    quoteVerified: true,
    modelId: "claude-opus-5",
  });

const DOC_A = "11111111-1111-4111-8111-111111111111";
const DOC_B = "22222222-2222-4222-8222-222222222222";

// 1. Twee documenten, twee geboortedatums. Dit moet een conflict blijven: het
//    systeem mag hier niet stil kiezen.
const betweenDocuments = resolveField(birthDate, [
  fromDocument(1, "1992-03-14", DOC_A),
  fromDocument(2, "1992-03-04", DOC_B),
]);

assert.equal(
  betweenDocuments.status,
  "conflicting",
  "twee documenten met een andere geboortedatum blijven tegenstrijdig",
);
assert.equal(betweenDocuments.confidence, "low");
assert.equal(betweenDocuments.conflicts.length, 1);
assert.equal(
  betweenDocuments.conflicts[0].sourceDocumentId,
  DOC_A,
  "de rivaal houdt zijn herkomst, anders kan de coach hem niet nakijken",
);

// 2. De coach corrigeert. Daarmee is de tegenspraak beslecht, niet verdubbeld.
const afterCoach = resolveField(birthDate, [
  fromDocument(1, "1992-03-14", DOC_A),
  fromDocument(2, "1992-03-04", DOC_B),
  proposal({ id: 3, value: "1992-03-14", proposedBy: "coach" }),
]);

assert.equal(afterCoach.status, "confirmed", "een coachbeslissing lost het conflict op");
assert.equal(afterCoach.confidence, "high");
assert.deepEqual(afterCoach.conflicts, []);
assert.equal(afterCoach.winningProposalId, 3);

// 3. De coach corrigeert zich nog een keer, nu naar een andere waarde. Het
//    nieuwste voorstel wint en er is nog steeds geen conflict. Dit was het
//    defect: de eerste correctie werd de rivaal van de tweede.
const twiceCorrected = resolveField(birthDate, [
  fromDocument(1, "1992-03-14", DOC_A),
  proposal({ id: 2, value: "1992-03-04", proposedBy: "coach" }),
  proposal({ id: 3, value: "1992-03-14", proposedBy: "coach" }),
]);

assert.equal(
  twiceCorrected.status,
  "confirmed",
  "twee correcties op rij zijn een opeenvolging, geen tegenspraak",
);
assert.equal(twiceCorrected.confidence, "high");
assert.deepEqual(twiceCorrected.conflicts, []);
assert.equal(twiceCorrected.value, "1992-03-14");
assert.equal(twiceCorrected.winningProposalId, 3);

// 4. Hetzelfde geldt voor de atleet, die dit pad al had via het bevestigen en
//    corrigeren in het gesprek.
const athleteTwice = resolveField(birthDate, [
  proposal({ id: 1, value: "1992-03-04", proposedBy: "athlete" }),
  proposal({ id: 2, value: "1992-03-14", proposedBy: "athlete" }),
]);

assert.deepEqual(
  athleteTwice.conflicts,
  [],
  "een atleet die zijn eigen antwoord aanpast spreekt zichzelf niet tegen",
);
assert.equal(athleteTwice.value, "1992-03-14");
assert.equal(athleteTwice.status, "extracted");

console.log("human-tier: documenten blijven conflicteren, mensen beslissen");
