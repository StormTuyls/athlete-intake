import { useTranslations } from "next-intl";
import { CheckIcon } from "@/components/intake/icons";

/**
 * Wat dit gesprek is, voordat de eerste vraag komt.
 *
 * Vaste tekst en geen modeluitvoer, en dat is een inhoudelijke keuze. Dit is de
 * enige plek waar tegen de atleet gezegd wordt wat er met zijn antwoorden
 * gebeurt: dat een coach alles nakijkt, dat een document pas gelezen wordt als
 * hij het vraagt, en dat er niets in zijn dossier komt zonder bevestiging. Zou
 * het model dat formuleren, dan staat er elke sessie iets anders en heeft
 * niemand goedgekeurd wat er staat. Bij een uitleg over de verwerking van
 * gezondheidsgegevens is dat het verkeerde soort variatie.
 *
 * Het gaat om dezelfde reden NIET de transcriptie in. Die is een vastgelegd
 * gesprek tussen de atleet en de assistent, en de assistent heeft dit niet
 * gezegd. OPENING_NUDGE staat er om precies dezelfde reden buiten.
 */
export function IntroCard() {
  const t = useTranslations("chat.intro");

  return (
    <section className="rounded-card bg-surface p-4 shadow-bubble ring-1 ring-hairline ring-inset">
      <h2 className="text-sm font-semibold text-ink">{t("title")}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{t("body")}</p>

      <ul className="mt-3 space-y-2">
        {([t("point1"), t("point2"), t("point3")] as const).map((point) => (
          <li key={point} className="flex gap-2 text-xs leading-relaxed text-ink-muted">
            <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-brand-600" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
