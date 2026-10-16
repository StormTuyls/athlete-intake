/**
 * Welke referentieregel bij welke atleet hoort.
 *
 * Spec §5 laag 3 vergelijkt met de wetenschap, en een gepubliceerde drempel
 * geldt voor een populatie: een geslacht, een sport, een onderdeel, een niveau,
 * een leeftijdsband. `public.reference_rules` heeft die kolommen sinds de eerste
 * screeningsmigratie, met in het commentaar erbij "Populatie. Null is 'elke'."
 *
 * Ze werden alleen nooit gebruikt. getLibrary() joinde de regels zonder enige
 * filter, dus kreeg iedereen dezelfde drempel: een vrouw van zeventien in de
 * atletiek werd tegen dezelfde waarde gelegd als een man van achtentwintig in
 * het roeien. Zie docs/screening-app.md.
 *
 * ---------------------------------------------------------------------------
 * Waarom hier en niet in SQL
 * ---------------------------------------------------------------------------
 *
 * Dit is een keuze tussen kandidaten, geen filter. Zodra er regels per populatie
 * bestaan zijn er meerdere actieve regels per metriek (de unieke sleutel staat
 * op rule_key plus version, niet op de metriek), en dan moet er één gekozen
 * worden. In SQL wordt dat een lateral join met een sorteeruitdrukking die
 * niemand meer naleest; hier is het een pure functie met een test ernaast en
 * geen databank nodig.
 *
 * ---------------------------------------------------------------------------
 * De regel die het gevaarlijkst zou zijn om fout te hebben
 * ---------------------------------------------------------------------------
 *
 * Onbekend is geen match. Weten we het geslacht van de atleet niet, dan geldt
 * een regel die op geslacht filtert NIET voor hem. Dat is strenger dan het
 * alternatief en met opzet: iemand indelen tegen een vrouwennorm omdat zijn
 * geslacht toevallig leeg staat, is erger dan hem niet indelen. `unspecified` is
 * de standaardwaarde van de kolom en telt daarom als onbekend.
 */

export interface Population {
  /** 'unspecified' telt als onbekend; dat is de standaardwaarde van de kolom. */
  sex: string | null;
  sport: string | null;
  /** `athletes.discipline`, want `reference_rules` noemt het `event`. */
  event: string | null;
  competitionLevel: string | null;
  /** Leeftijd op de dag van de meting, niet vandaag. */
  age: number | null;
}

export interface PopulationRule {
  sex: string | null;
  sport: string | null;
  event: string | null;
  competitionLevel: string | null;
  ageMin: number | null;
  ageMax: number | null;
  /** Bij gelijke specificiteit wint de hoogste versie, daarna het hoogste id. */
  version: number;
  id: number;
}

function known(value: string | null): boolean {
  return value !== null && value !== "" && value !== "unspecified";
}

/** Of deze regel op deze atleet van toepassing is. */
export function ruleApplies(rule: PopulationRule, population: Population): boolean {
  const dimensions: Array<[string | null, string | null]> = [
    [rule.sex, population.sex],
    [rule.sport, population.sport],
    [rule.event, population.event],
    [rule.competitionLevel, population.competitionLevel],
  ];

  for (const [constraint, value] of dimensions) {
    if (!known(constraint)) continue;
    if (!known(value) || value !== constraint) return false;
  }

  if (rule.ageMin !== null || rule.ageMax !== null) {
    if (population.age === null) return false;
    if (rule.ageMin !== null && population.age < rule.ageMin) return false;
    if (rule.ageMax !== null && population.age > rule.ageMax) return false;
  }

  return true;
}

/**
 * Hoeveel de regel vastlegt. Hoger is specifieker, en specifieker wint.
 *
 * De leeftijdsband telt als één, ook als hij van twee kolommen gebruikmaakt:
 * anders zou "16 tot 18" zwaarder wegen dan "vrouw", en dat is geen uitspraak
 * die iemand gedaan heeft.
 */
export function ruleSpecificity(rule: PopulationRule): number {
  let score = 0;
  if (known(rule.sex)) score += 1;
  if (known(rule.sport)) score += 1;
  if (known(rule.event)) score += 1;
  if (known(rule.competitionLevel)) score += 1;
  if (rule.ageMin !== null || rule.ageMax !== null) score += 1;
  return score;
}

/** Of de regel voor iedereen geldt. */
export function isGenericRule(rule: PopulationRule): boolean {
  return ruleSpecificity(rule) === 0;
}

/**
 * De regel die geldt, of null.
 *
 * Zonder populatie (het bibliotheekscherm, een seed, een test) worden alleen
 * regels zonder enige beperking teruggegeven. Niet "de eerste de beste": een
 * drempel voor vrouwen tonen op een scherm dat niet weet over wie het gaat, is
 * precies het soort stille fout waar spec §10 voor waarschuwt.
 */
export function pickRule<T extends PopulationRule>(
  rules: readonly T[],
  population: Population | null,
): T | null {
  const candidates = population
    ? rules.filter((rule) => ruleApplies(rule, population))
    : rules.filter(isGenericRule);

  if (candidates.length === 0) return null;

  return candidates.reduce((best, rule) => {
    const byScore = ruleSpecificity(rule) - ruleSpecificity(best);
    if (byScore !== 0) return byScore > 0 ? rule : best;
    if (rule.version !== best.version) return rule.version > best.version ? rule : best;
    return rule.id > best.id ? rule : best;
  });
}

/** Leeftijd op een bepaalde dag, uit een ISO-geboortedatum. */
export function ageOn(dateOfBirth: string | null, on: string): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`);
  const day = new Date(`${on.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(born.getTime()) || Number.isNaN(day.getTime())) return null;

  let age = day.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    day.getUTCMonth() < born.getUTCMonth() ||
    (day.getUTCMonth() === born.getUTCMonth() && day.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;

  return age < 0 ? null : age;
}
