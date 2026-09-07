import assert from "node:assert/strict";
import { toCsv } from "../../lib/report/csv";
import type { ReportSnapshot, SnapshotField } from "../../lib/report/snapshot";

/**
 * De CSV gaat naar Excel, op de machine van een kinesist.
 *
 * Twee dingen moeten daarom vaststaan: de tekst blijft leesbaar, en een cel
 * wordt nooit een formule. Dat laatste is geen paranoia: de waarden komen uit
 * PDF's, WhatsApp-berichten en modeloutput, dus uit tekst die wij niet schrijven.
 */

function field(overrides: Partial<SnapshotField>): SnapshotField {
  return {
    key: "medical.current_complaints",
    section: "medical_history",
    sortOrder: 4,
    labelNl: "Huidige klachten",
    labelEn: "Current complaints",
    dataType: "long_text",
    required: true,
    isMedical: true,
    value: "x",
    displayValue: "x",
    status: "extracted",
    confidence: "medium",
    proposedBy: "model",
    provenance: null,
    conflicts: [],
    ...overrides,
  };
}

function snapshot(fields: SnapshotField[]): ReportSnapshot {
  return {
    schemaVersion: 1,
    contentHash: "abc",
    reason: "export",
    generatedAt: "2026-09-07T10:00:00.000Z",
    intake: { id: "i", status: "submitted", locale: "en", startedAt: null, submittedAt: null },
    athlete: { fullName: null, email: null, phone: null, club: null, federation: null },
    consent: { version: null, grantedAt: null, withdrawnAt: null, sharingAllowed: false },
    fields,
    injuries: [],
    documents: [],
    completeness: {
      total: 41, filled: 1, requiredTotal: 15, requiredFilled: 1,
      conflicts: 0, readyToSubmit: false,
    },
    openItems: [],
    summary: null,
  };
}

// 1. BOM en CRLF, want anders mangelt Excel de tekst en de regeleinden.
const basic = toCsv(snapshot([field({})]));
assert.ok(basic.startsWith("﻿"), "moet met een BOM beginnen");
assert.ok(basic.includes("\r\n"), "moet CRLF gebruiken");

// 2. Formule-injectie. Elk van deze mag niet als formule beginnen.
for (const payload of ["=1+1", "+1", "-2+3+cmd|' /c calc'!A0", "@SUM(A1)", "\tx", "\rx"]) {
  const line = toCsv(snapshot([field({ displayValue: payload })]))
    .split("\r\n")
    .find((row) => row.includes("current_complaints"))!;
  const value = line.split(",")[6].replace(/^"|"$/g, "");
  assert.ok(
    value.startsWith("'"),
    `waarde ${JSON.stringify(payload)} moet geneutraliseerd zijn, kreeg ${JSON.stringify(value)}`,
  );
}

// 3. Een gewone waarde blijft ongemoeid: het schild mag geen ruis toevoegen.
const plain = toCsv(snapshot([field({ displayValue: "Lage rugpijn links" })]));
assert.ok(plain.includes("Lage rugpijn links"), "gewone tekst mag niet veranderen");
assert.ok(!plain.includes("'Lage rugpijn"), "gewone tekst mag geen quote-prefix krijgen");

// 4. Komma's, aanhalingstekens en regeleindes in een citaat mogen de kolommen
//    niet laten verschuiven.
const nasty = toCsv(
  snapshot([
    field({
      displayValue: 'Pijn "scherp", links',
      provenance: {
        proposalId: 1,
        proposedBy: "model",
        modelId: "claude-opus-5",
        documentId: "d",
        documentFilename: "verslag.pdf",
        page: 2,
        quote: "regel een\nregel twee, met komma",
        quoteVerified: true,
      },
    }),
  ]),
);
assert.ok(nasty.includes('"Pijn ""scherp"", links"'), "aanhalingstekens moeten verdubbeld worden");
assert.ok(nasty.includes('"regel een\nregel twee, met komma"'), "een citaat met regeleinde moet gequoot zijn");

// 5. Kopregel: precies de verwachte kolommen, en de herkomst hoort erbij, want
//    dat is wat een export van een screenshot onderscheidt.
const header = basic.replace("﻿", "").split("\r\n")[0].split(",");
assert.equal(header.length, 15);
for (const column of ["field_key", "source_document", "source_quote", "quote_verified"]) {
  assert.ok(header.includes(column), `kolom ${column} moet bestaan`);
}

console.log("csv-export: BOM, quoting en formule-injectie afgedekt");
