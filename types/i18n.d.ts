// Deze import is niet decoratief: hij maakt van dit bestand een module.
//
// Een `declare module "x"` in een bestand ZONDER imports of exports is geen
// augmentatie maar een ambiente moduledeclaratie. TypeScript negeert die dan
// stilletjes voor een pakket dat zijn eigen types meelevert, en het gevolg is
// precies wat je niet wil: alles compileert, `t("titel")` inbegrepen, en je
// denkt dat je sleutels getypeerd zijn. Gemeten: zonder deze regel gaf een
// opzettelijke typefout nul fouten, met deze regel één.
import type nl from "../messages/nl.json";

/**
 * De sleutels van de berichten als type.
 *
 * Hiermee is `t("chat.tital")` een compilefout in plaats van een dotted pad op
 * het scherm van een atleet. Bij ruim tweehonderd sleutels over vier soorten
 * aanroepplekken is dat het verschil tussen een vertaling die af is en een
 * vertaling waarvan niemand weet of hij af is.
 *
 * Nederlands is de bron: dat bestand is de volledige lijst, en en.json wordt
 * ertegen gecontroleerd door evals/unit/i18n-keys.test.ts. Zou Engels de bron
 * zijn, dan is een sleutel die in het Nederlands mist geen fout maar stille
 * terugval.
 *
 * `use-intl` en niet `next-intl`: daar staat de interface (via use-intl/core).
 * Beide werken, maar next-intl en lib/i18n/translator.ts komen allebei op deze
 * ene interface uit, dus de bron augmenteren dekt beide paden.
 */
declare module "use-intl" {
  interface AppConfig {
    Locale: "nl" | "en";
    Messages: typeof nl;
  }
}
