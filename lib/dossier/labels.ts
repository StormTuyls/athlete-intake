/**
 * Nederlandse labels voor enum-waarden.
 *
 * De taxonomie bewaart sleutels ('specific_prep'), want die zijn stabiel en
 * taalonafhankelijk. Maar een samenvatting die "seizoensfase specific prep"
 * schrijft leest als een databankdump. Labels horen bij de weergave, niet bij de
 * opslag.
 */
export const ENUM_LABELS: Record<string, string> = {
  // identity.sport
  sprint: "sprint",
  hurdles: "horden",
  rowing: "roeien",
  speed_skating: "snelschaatsen",
  inline_skating: "skeeleren",
  football: "voetbal",
  other: "andere",

  // biometrics.dominant_side
  left: "links",
  right: "rechts",
  ambidextrous: "beide",

  // training.season_phase
  off_season: "overgangsperiode",
  general_prep: "algemene voorbereiding",
  specific_prep: "specifieke voorbereiding",
  competition: "wedstrijdperiode",
  transition: "transitie",

  // status.training_availability
  full: "volledig trainbaar",
  modified: "aangepast trainbaar",
  none: "niet trainbaar",
};

export function label(value: unknown): string {
  if (value === null || value === undefined) return "-";
  const key = String(value);
  return ENUM_LABELS[key] ?? key;
}
