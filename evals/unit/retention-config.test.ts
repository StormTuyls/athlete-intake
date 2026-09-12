import assert from "node:assert/strict";
import {
  DEFAULT_BASIS,
  preConsentUntil,
  retentionConfig,
  retentionSentence,
  retentionUntil,
} from "../../lib/intake/retention";

/**
 * De bewaartermijn stond op twee plekken met elk hun eigen standaardwaarde, dus
 * een half ingevulde omgeving kon een consenttekst opleveren die iets anders
 * belooft dan er wordt opgeslagen. Bij toestemming is dat geen
 * schoonheidsfoutje: een consent die iets anders zegt dan het systeem doet, is
 * geen geldige consent. Deze test houdt de plekken op één antwoord.
 *
 * En op één taal. retentionSentence() had `locale = DEFAULT_LOCALE`, en het
 * aanmeldscherm gaf niets mee: een Nederlandstalige bezoeker las een
 * Nederlandse consentzin met een Engelse bewaartermijn erachter. De parameter
 * is nu verplicht, dus dat is een compilefout geworden; wat hier getest wordt
 * is dat beide talen ook echt een eigen zin opleveren.
 */

function withEnv(vars: Record<string, string | undefined>, run: () => void): void {
  const before = { ...process.env };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    process.env = before;
  }
}

// 1. Standaard: onbeperkt, met de grond van de praktijk, en geen einddatum.
withEnv(
  { RETENTION_MODE: undefined, RETENTION_MONTHS: undefined, RETENTION_BASIS: undefined },
  () => {
    const config = retentionConfig();
    assert.equal(config.mode, "indefinite");
    assert.equal(config.basis, DEFAULT_BASIS);
    assert.equal(retentionUntil(), null, "onbeperkt bewaren heeft geen einddatum");
    assert.match(retentionSentence("en"), /as long as your care continues/);
    assert.match(retentionSentence("nl"), /zolang je begeleiding loopt/);
  },
);

// 2. Een termijn in maanden: de datum en de tekst moeten hetzelfde zeggen.
withEnv({ RETENTION_MODE: "until_date", RETENTION_MONTHS: "24" }, () => {
  assert.equal(retentionConfig().months, 24);
  assert.equal(
    retentionUntil(new Date("2026-03-14T00:00:00Z")),
    "2028-03-14",
    "24 maanden na maart 2026 is maart 2028",
  );
  assert.match(retentionSentence("en"), /24 months/);
  assert.match(retentionSentence("nl"), /24 maanden/);
});

// 2b. Elke taal een eigen zin, en geen van beide een terugval op de andere.
//     Dit is de regressie: de twee mogen niet gelijk zijn, want dan staat er
//     Engels op een Nederlands scherm zonder dat iets stukloopt.
withEnv({ RETENTION_MODE: "until_date", RETENTION_MONTHS: "24" }, () => {
  assert.notEqual(
    retentionSentence("nl"),
    retentionSentence("en"),
    "de bewaartermijn hoort in beide talen anders te klinken",
  );
});

withEnv(
  { RETENTION_MODE: undefined, RETENTION_MONTHS: undefined, RETENTION_BASIS: undefined },
  () => {
    assert.notEqual(retentionSentence("nl"), retentionSentence("en"));
  },
);

// 3. Onzin hoort hard stuk te lopen. Zonder deze controle werd
//    Number("zestig") stil NaN en kwam er een lege datum in de databank.
withEnv({ RETENTION_MODE: "until_date", RETENTION_MONTHS: "zestig" }, () => {
  assert.throws(() => retentionConfig(), /niet geldig ingesteld/);
});

// 4. Onbeperkt zonder grond mag niet. De check-constraint op public.athletes
//    eist het ook, maar een leesbare melding vooraf is beter dan een pg-fout.
withEnv({ RETENTION_MODE: "indefinite", RETENTION_BASIS: "   " }, () => {
  assert.throws(() => retentionConfig(), /RETENTION_BASIS/);
});

// 5. De voorlopige termijn tussen aanmaken en toestemming.
const soon = preConsentUntil(new Date("2026-09-08T00:00:00Z"));
assert.equal(soon, "2026-10-08", "dertig dagen na 8 september is 8 oktober");

console.log(
  "retention-config: één antwoord voor tekst en datum, per taal een eigen zin, onzin loopt stuk",
);
process.exit(0);
