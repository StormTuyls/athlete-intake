import { getTranslations } from "next-intl/server";

/**
 * Wat er staat terwijl een coachscherm laadt.
 *
 * Alleen hier en niet in de wortel: de coachpagina's doen de zware vragen aan
 * de databank, terwijl een loading in de wortel ook over de donkere schil van
 * de atleet zou vallen en daar als een lichte flits leest.
 *
 * Met opzet geen skelet. Een grijze rij op de plek van een naam suggereert dat
 * er namen komen en hoeveel het er zijn. Een regel tekst zegt hetzelfde en
 * liegt niet.
 */
export default async function CoachLoading() {
  const t = await getTranslations("errors");

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:max-w-5xl">
      <p role="status" className="text-sm text-ink-faint">
        {t("loading")}
      </p>
    </main>
  );
}
