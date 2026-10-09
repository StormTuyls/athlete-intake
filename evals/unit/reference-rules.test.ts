import assert from "node:assert/strict";
import { checkVersion } from "../../lib/db/referenceRules";

/**
 * De controle op een nieuwe referentieregel.
 *
 * Dit is wat er tussen de praktijk en een drempel staat die atleten indeelt.
 * De databank houdt daarna nog twee sloten vast, maar daar komt een
 * constraintnaam uit die niemand kan lezen; hier komt een zin uit.
 */

const ok = {
  metricKey: "x.y",
  bands: [
    { status: "poor", score: 0, lt: 10 },
    { status: "good", score: 1, gte: 10 },
  ],
  coverage: "total" as const,
  classificationEnabled: true,
  evidence: "source_sheet" as const,
  sourceCitation: null,
  sourceNote: null,
};

assert.deepEqual(checkVersion(ok), [], "een sluitende reeks is geldig");

// Overlap: 'de eerste die past' levert dan stil de verkeerde band.
assert.ok(
  checkVersion({ ...ok, bands: [{ status: "a", lt: 20 }, { status: "b", gte: 10 }] })
    .some((e) => /overlappen/.test(e)),
);

// Een gat terwijl de regel 'sluitend' beweert.
assert.ok(
  checkVersion({ ...ok, bands: [{ status: "a", lt: 10 }, { status: "b", gte: 20 }] })
    .some((e) => /gat tussen/.test(e)),
);

// Hetzelfde gat, maar eerlijk aangegeven: dan mag het, zolang hij niet indeelt.
assert.deepEqual(
  checkVersion({
    ...ok,
    bands: [{ status: "a", lt: 10 }, { status: "b", gte: 20 }],
    coverage: "gapped",
    classificationEnabled: false,
  }),
  [],
);

// Maar een gegapte regel die WEL wil indelen is de fout uit spec §6 bij ASH:
// een waarde in het gat zou dan een buurband krijgen.
assert.ok(
  checkVersion({
    ...ok,
    bands: [{ status: "a", lt: 10 }, { status: "b", gte: 20 }],
    coverage: "gapped",
    classificationEnabled: true,
  }).some((e) => /cannot classify/.test(e)),
);

// Spec §10: een gepubliceerde waarde zonder herkomst is niet genoeg voor een
// medisch dossier. Witruimte telt niet als bron.
assert.ok(
  checkVersion({ ...ok, evidence: "published", sourceCitation: "   " })
    .some((e) => /citation/.test(e)),
);
assert.deepEqual(
  checkVersion({ ...ok, evidence: "published", sourceCitation: "Smith et al. 2024" }),
  [],
);

console.log("reference-rules: overlap, gaten, gegapt mag niet indelen, bron verplicht");
