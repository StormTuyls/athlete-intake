import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { extractPages, looksScanned } from "../../lib/extract/pages";

/**
 * pdf.js detacht de meegegeven buffer. Dat kostte ons eerst een lege
 * byte_size en zou daarna een leeg document naar het model gestuurd hebben,
 * zonder foutmelding. Deze test staat er zodat die bug niet terugkomt.
 */
const bytes = new Uint8Array(readFileSync("evals/fixtures/synthetic/kine-verslag.pdf"));
const before = bytes.length;

const pages = await extractPages(bytes);

assert.equal(bytes.length, before, "extractPages mag de meegegeven buffer niet detachen");
assert.equal(pages.length, 1);
assert.ok(pages[0].text.includes("Jonas Peeters"));
assert.equal(looksScanned(pages), false, "een tekst-PDF mag niet als scan gelden");

console.log("pages: buffer blijft intact, tekstlaag herkend");
