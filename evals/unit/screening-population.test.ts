import assert from "node:assert/strict";
import {
  ageOn,
  isGenericRule,
  pickRule,
  ruleApplies,
  ruleSpecificity,
  type Population,
  type PopulationRule,
} from "../../lib/screening/population";

/**
 * Welke referentieregel op welke atleet van toepassing is.
 *
 * Deze code beslist waartegen iemand ingedeeld wordt, en de gevaarlijke fout is
 * niet "geen regel gevonden" maar "de verkeerde regel toegepast". Een man die
 * tegen een vrouwennorm gelegd wordt krijgt een band die er geloofwaardig
 * uitziet en nergens op slaat, en niets in het scherm verraadt dat.
 *
 * Wat hier daarom vastligt:
 *
 * 1. Onbekend is geen match. Staat het geslacht op 'unspecified' (de
 *    standaardwaarde van de kolom), dan geldt een regel die op geslacht filtert
 *    NIET.
 * 2. Specifieker wint, en de leeftijdsband telt als een dimensie en niet als
 *    twee.
 * 3. Zonder populatie gelden alleen regels zonder beperking. Niet de eerste de
 *    beste.
 *
 * Geen databank en geen modelcall.
 */

function rule(over: Partial<PopulationRule> = {}): PopulationRule {
  return {
    sex: null,
    sport: null,
    event: null,
    competitionLevel: null,
    ageMin: null,
    ageMax: null,
    version: 1,
    id: 1,
    ...over,
  };
}

function athlete(over: Partial<Population> = {}): Population {
  return {
    sex: "female",
    sport: "athletics",
    event: "hurdles",
    competitionLevel: "national",
    age: 17,
    ...over,
  };
}

// ── 1. Onbekend is geen match ────────────────────────────────────────────────

const female = rule({ sex: "female", id: 2 });

assert.ok(ruleApplies(female, athlete()), "een passende regel hoort te gelden");
assert.ok(
  !ruleApplies(female, athlete({ sex: "male" })),
  "een vrouwennorm hoort niet op een man te gelden",
);
assert.ok(
  !ruleApplies(female, athlete({ sex: "unspecified" })),
  "'unspecified' is de standaardwaarde van de kolom en telt als onbekend",
);
assert.ok(
  !ruleApplies(female, athlete({ sex: null })),
  "zonder geslacht geldt een regel op geslacht niet",
);

// Hetzelfde voor de leeftijdsband: geen geboortedatum is geen indeling.
const youth = rule({ ageMin: 16, ageMax: 18 });
assert.ok(ruleApplies(youth, athlete({ age: 17 })));
assert.ok(ruleApplies(youth, athlete({ age: 16 })), "ondergrens hoort erbij");
assert.ok(ruleApplies(youth, athlete({ age: 18 })), "bovengrens hoort erbij");
assert.ok(!ruleApplies(youth, athlete({ age: 15 })));
assert.ok(!ruleApplies(youth, athlete({ age: 19 })));
assert.ok(!ruleApplies(youth, athlete({ age: null })), "zonder leeftijd geen leeftijdsband");

// Een open ondergrens of bovengrens.
assert.ok(ruleApplies(rule({ ageMin: 18 }), athlete({ age: 40 })));
assert.ok(!ruleApplies(rule({ ageMin: 18 }), athlete({ age: 17 })));
assert.ok(ruleApplies(rule({ ageMax: 18 }), athlete({ age: 12 })));

// ── 2. Specificiteit ─────────────────────────────────────────────────────────

assert.equal(ruleSpecificity(rule()), 0);
assert.ok(isGenericRule(rule()));
assert.equal(ruleSpecificity(rule({ sex: "female" })), 1);
assert.equal(
  ruleSpecificity(rule({ ageMin: 16, ageMax: 18 })),
  1,
  "een leeftijdsband is een dimensie, niet twee",
);
assert.equal(
  ruleSpecificity(rule({ sex: "female", sport: "athletics", ageMin: 16 })),
  3,
);

const generic = rule({ id: 1 });
const bySex = rule({ sex: "female", id: 2 });
const bySexAndSport = rule({ sex: "female", sport: "athletics", id: 3 });

assert.equal(
  pickRule([generic, bySex, bySexAndSport], athlete())?.id,
  3,
  "de specifiekste passende regel wint",
);
assert.equal(
  pickRule([generic, bySex, bySexAndSport], athlete({ sport: "rowing" }))?.id,
  2,
  "valt terug op de regel die nog wel past",
);
assert.equal(
  pickRule([generic, bySex, bySexAndSport], athlete({ sex: "male" }))?.id,
  1,
  "en uiteindelijk op de algemene regel",
);

// Volgorde in de lijst mag niet uitmaken.
assert.equal(pickRule([bySexAndSport, generic, bySex], athlete())?.id, 3);

// ── 3. Gelijkspel ────────────────────────────────────────────────────────────

assert.equal(
  pickRule(
    [rule({ sex: "female", version: 1, id: 10 }), rule({ sex: "female", version: 2, id: 5 })],
    athlete(),
  )?.id,
  5,
  "bij gelijke specificiteit wint de hoogste versie",
);

assert.equal(
  pickRule(
    [rule({ sex: "female", version: 1, id: 4 }), rule({ sex: "female", version: 1, id: 9 })],
    athlete(),
  )?.id,
  9,
  "en daarna het hoogste id",
);

// ── 4. Zonder populatie, en zonder passende regel ────────────────────────────

assert.equal(
  pickRule([generic, bySex, bySexAndSport], null)?.id,
  1,
  "zonder populatie gelden alleen regels zonder beperking",
);
assert.equal(
  pickRule([bySex, bySexAndSport], null),
  null,
  "zijn er alleen populatieregels, dan is er zonder populatie geen regel",
);
assert.equal(
  pickRule([bySex], athlete({ sex: "male" })),
  null,
  "geen passende regel is null en niet een willekeurige",
);
assert.equal(pickRule([], athlete()), null);

// ── 5. Leeftijd op de dag van de meting ──────────────────────────────────────

assert.equal(ageOn("2008-03-10", "2026-03-10"), 18, "op de verjaardag zelf");
assert.equal(ageOn("2008-03-10", "2026-03-09"), 17, "de dag ervoor nog niet");
assert.equal(ageOn("2008-03-10", "2026-12-31"), 18);
assert.equal(ageOn("2008-12-31", "2026-01-01"), 17);
assert.equal(ageOn(null, "2026-03-10"), null);
assert.equal(ageOn("onzin", "2026-03-10"), null);

// Timestamps met een tijd erachter mogen ook; de kolom is een date maar een
// aanroeper kan er een ISO-timestamp in stoppen.
assert.equal(ageOn("2008-03-10T00:00:00.000Z", "2026-03-10T14:30:00.000Z"), 18);

// Een meting van voor de geboorte is onzin en levert geen negatieve leeftijd op.
assert.equal(ageOn("2026-03-10", "2008-03-10"), null);

console.log(
  "screening-population: onbekend is geen match, specifieker wint, " +
    "zonder populatie alleen algemene regels",
);
process.exit(0);
