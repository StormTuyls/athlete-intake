/**
 * Welke dossiervelden uit het atleetprofiel komen, en uit welke kolom.
 *
 * Eén tabel, en die is de enige plek waar de koppeling tussen een veldsleutel
 * en een kolom op public.athletes staat. Stond ze op twee plekken, dan gaan ze
 * uiteen zodra er een veld bij komt, en het gevolg is stil: het veld verdwijnt
 * uit het gesprek (want from_profile staat aan) en wordt nergens uit het
 * profiel gevuld. Er komt dan gewoon niets, zonder foutmelding.
 *
 * De vlag `from_profile` in de taxonomie zegt DAT een veld uit het profiel
 * komt; deze tabel zegt WAARVANDAAN. Dat zijn twee dingen, en ze horen bij
 * elkaar te blijven: evals/unit/profile-fields.test.ts controleert dat elk veld
 * met de vlag hier een kolom heeft en omgekeerd.
 */

/** Veldsleutel in de taxonomie → kolom op public.athletes. */
export const PROFILE_FIELDS = {
  "identity.full_name": "full_name",
  "identity.date_of_birth": "date_of_birth",
  "identity.email": "email",
  "identity.phone": "phone",
  "identity.sport": "sport",
  "identity.discipline": "discipline",
  "identity.club": "club",
  "identity.federation": "federation",
  "identity.coach_name": "coach_name",
} as const satisfies Record<string, string>;

export type ProfileFieldKey = keyof typeof PROFILE_FIELDS;

export const PROFILE_COLUMNS = Object.values(PROFILE_FIELDS);

/**
 * Wat een profiel minstens moet bevatten voor er een intake mag starten.
 *
 * Afgeleid van `required` in de taxonomie en niet hier herhaald: zou de praktijk
 * morgen beslissen dat de federatie verplicht is, dan hoort deze poort mee te
 * bewegen zonder dat iemand aan deze lijst denkt. Zie profileIsComplete().
 */
export function missingRequiredProfileFields(
  definitions: Array<{ key: string; required: boolean; fromProfile: boolean }>,
  profile: Record<string, unknown>,
): ProfileFieldKey[] {
  return definitions
    .filter((definition) => definition.fromProfile && definition.required)
    .map((definition) => definition.key as ProfileFieldKey)
    .filter((key) => {
      const column = PROFILE_FIELDS[key];
      if (!column) return false;
      const value = profile[column];
      return value === null || value === undefined || String(value).trim() === "";
    });
}
