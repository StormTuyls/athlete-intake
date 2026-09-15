import { useTranslations } from "next-intl";

/**
 * Een vraag die gesteld is en geen antwoord kreeg.
 *
 * Zonder dit verdwijnt de vraag gewoon uit het gesprek zodra de atleet "dat
 * weet ik niet" zegt. Hij ziet de assistent doorgaan naar het volgende en heeft
 * geen idee of er iets vastgelegd is of dat het zoekgeraakt is. Er IS iets
 * vastgelegd, namelijk dat hierover niets bekend is, en de behandelaar krijgt
 * dat straks ook te zien. Dan hoort de atleet het ook te zien.
 *
 * Bewust geen kaart met een rand zoals een capture. Dit is geen gegeven dat aan
 * het dossier is toegevoegd maar een aantekening over het gesprek, en het hoort
 * rustiger te zijn dan wat er wel gelukt is.
 */
export function SkipNote({
  label,
  reason,
}: {
  label: string;
  reason: "unknown" | "declined";
}) {
  const t = useTranslations("chat.skip");

  return (
    <p className="px-1 text-xs leading-relaxed text-ink-faint">
      {reason === "declined" ? t("declined", { field: label }) : t("unknown", { field: label })}
    </p>
  );
}
