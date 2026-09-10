import assert from "node:assert/strict";
import { formatAddress, parseProfileInput } from "../../lib/intake/profile";

/**
 * Wat er van een ingestuurd profiel in de kolommen belandt.
 *
 * Geen databank nodig: dit is de laag ertussen, en juist die laag draagt twee
 * afspraken die de databank niet kan controleren. De eerste is dat leeg en
 * weggelaten allebei null worden, want een lege string in een naamveld komt
 * straks als een lege regel in een rapport terug. De tweede is dat de gekozen
 * behandelaar in de lijst moet staan die de atleet te zien kreeg: een foreign
 * key kan niet naar een gefilterde verzameling wijzen, dus dit is de enige
 * plek waar dat gebeurt.
 */

const PHYSIO = "6d1f1e26-0b4a-4a5c-9b3f-4c2e1a7d9f01";
const COACH = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
const known = new Set([PHYSIO, COACH]);

// ── Leeg is null, niet een lege string ────────────────────────────────────────

const emptied = parseProfileInput(
  { fullName: "", street: "  ", postalCode: "", city: "", country: "", practitionerId: "" },
  known,
);

assert.ok(emptied.ok, "een leeg formulier hoort geldig te zijn");
assert.deepEqual(emptied.values, {
  fullName: null,
  street: null,
  postalCode: null,
  city: null,
  country: null,
  practitionerId: null,
});

// Weggelaten velden geven hetzelfde resultaat als leeggemaakte velden. Dat is
// een keuze: dit endpoint slaat het hele formulier op, dus een ontbrekend veld
// betekent hier "niet ingevuld" en niet "laat staan wat er stond".
const omitted = parseProfileInput({}, known);
assert.ok(omitted.ok);
assert.deepEqual(omitted.values, emptied.values);

// ── Spaties eraf, land naar hoofdletters ──────────────────────────────────────

const trimmed = parseProfileInput(
  {
    fullName: "  Lotte Vermeulen ",
    street: " Kerkstraat 12 ",
    postalCode: " 9000 ",
    city: " Gent ",
    country: "be",
    practitionerId: PHYSIO,
  },
  known,
);

assert.ok(trimmed.ok, "een normaal ingevuld formulier hoort geldig te zijn");
assert.deepEqual(trimmed.values, {
  fullName: "Lotte Vermeulen",
  street: "Kerkstraat 12",
  postalCode: "9000",
  city: "Gent",
  country: "BE",
  practitionerId: PHYSIO,
});

// ── Het land is een landcode ──────────────────────────────────────────────────

for (const country of ["Belgie", "B", "BEL", "12"]) {
  const result = parseProfileInput({ country }, known);
  assert.equal(result.ok, false, `'${country}' hoort geweigerd te worden als landcode`);
}

// ── De behandelaar moet bestaan ───────────────────────────────────────────────

const stranger = parseProfileInput(
  { practitionerId: "99999999-9999-4999-8999-999999999999" },
  known,
);
assert.equal(stranger.ok, false, "een behandelaar buiten de lijst hoort geweigerd te worden");
assert.equal(stranger.ok === false && stranger.error, "unknown practitioner");

// Iemand die niet in de lijst staat omdat er helemaal geen lijst is: ook nee.
const noneAvailable = parseProfileInput({ practitionerId: COACH }, new Set<string>());
assert.equal(noneAvailable.ok, false);

// Niemand kiezen mag altijd, ook als er wel behandelaars zijn.
const cleared = parseProfileInput({ practitionerId: null }, known);
assert.ok(cleared.ok);
assert.equal(cleared.values.practitionerId, null);

// Onzin in plaats van een uuid is een 400 en geen crash.
assert.equal(parseProfileInput({ practitionerId: "physio-1" }, known).ok, false);
assert.equal(parseProfileInput({ fullName: 42 }, known).ok, false);
assert.equal(parseProfileInput({ fullName: "x".repeat(121) }, known).ok, false);

// ── Het adres als één regel ───────────────────────────────────────────────────

assert.equal(
  formatAddress({ street: "Kerkstraat 12", postalCode: "9000", city: "Gent", country: "BE" }),
  "Kerkstraat 12, 9000 Gent, BE",
);

// Half ingevuld is de regel en niet de uitzondering: geen zwevende komma's.
assert.equal(
  formatAddress({ street: null, postalCode: null, city: "Gent", country: null }),
  "Gent",
);
assert.equal(
  formatAddress({ street: "Kerkstraat 12", postalCode: "9000", city: null, country: null }),
  "Kerkstraat 12, 9000",
);
assert.equal(
  formatAddress({ street: null, postalCode: null, city: null, country: null }),
  null,
);

console.log("profile-input: ok");
