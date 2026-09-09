"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { SectionLabel } from "@/components/intake/SectionLabel";
import { AlertIcon, CheckIcon } from "@/components/intake/icons";
import type { DossierView } from "@/lib/intake/report";

/**
 * Het dossier naast het gesprek, op een breed scherm.
 *
 * Dit staat in geen enkele mockup: het ontwerp is drie telefoonschermen. Op een
 * laptop stond daar een kolom van 30rem met wit ernaast, en dat leest niet als
 * een keuze maar als een telefoon in een leeg veld. De ruimte die er wel is,
 * gaat naar het enige dat de atleet tijdens het gesprek niet kan zien: wat er
 * inmiddels in zijn dossier staat en wat er nog ontbreekt. In het gesprek moet
 * hij daarvoor terugscrollen langs alles wat hij al beantwoord heeft.
 *
 * Wordt onder lg niet gemonteerd, dus op een telefoon verandert er niets en
 * gaat er ook geen extra request uit. Dat is de reden dat het ophalen hier zit
 * en niet in useIntakeChat: die hook draait altijd.
 *
 * `refreshKey` en geen eigen abonnement op de voortgang. Het paneel weet niet
 * wanneer er iets gebeurt; het gesprek wel, en dat geeft een getal door dat
 * verandert zodra er iets te halen valt.
 */
export function DossierPanel({
  refreshKey,
  className,
}: {
  /** Verandert zodra er iets in het dossier kan zijn veranderd. */
  refreshKey: number;
  className?: string;
}) {
  const t = useTranslations("intake");
  const tChat = useTranslations("chat");
  const [view, setView] = useState<DossierView | null>(null);

  useEffect(() => {
    let ignore = false;

    fetch("/api/intake/dossier")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: DossierView | null) => {
        if (!ignore && data) setView(data);
      })
      // Stil falen is hier het juiste gedrag: dit paneel is een extra kijkje
      // naast het gesprek, en een foutmelding erin zou de aandacht weghalen van
      // de vraag die er staat. Het gesprek toont zijn eigen fouten wel.
      .catch(() => {});

    return () => {
      ignore = true;
    };
  }, [refreshKey]);

  if (!view) return <aside className={className} aria-hidden />;

  const conflicts = view.attention.filter((value) => value.reason === "conflicting");

  return (
    <aside className={cn("px-5 py-5", className)} aria-label={tChat("panelTitle")}>
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel>{tChat("panelTitle")}</SectionLabel>
        <span className="text-xs tabular-nums text-ink-muted">
          {t("requiredCount", {
            filled: view.requiredFilled,
            total: view.requiredTotal,
          })}
        </span>
      </div>

      {/* Alleen tegenstrijdigheden, niet alles wat nog ontbreekt.
          Dat laatste stond er eerst wel, en op een verse intake waren dat
          dertien amberkleurige regels boven een paneel waarin diezelfde velden
          eronder al als streepje staan. Amber dat altijd aanstaat leert mensen
          amber negeren, en dan mist het de ene keer dat het ergens over gaat.
          Hoeveel er nog ontbreekt staat als getal in de kop. */}
      {conflicts.length > 0 && (
        <div className="mt-3 rounded-card bg-warn-soft p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
            <AlertIcon className="size-3.5 shrink-0" />
            {tChat("panelConflicts", { count: conflicts.length })}
          </p>
          <ul className="mt-1.5 space-y-1">
            {conflicts.map((value) => (
              <li key={value.fieldKey} className="text-xs text-warn">
                {value.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.requiredFilled === 0 && conflicts.length === 0 && (
        <p className="mt-3 text-xs text-ink-faint">{tChat("panelEmpty")}</p>
      )}

      <div className="mt-4 space-y-5">
        {view.sections.map((section) => (
          <section key={section.key}>
            <div className="flex items-baseline justify-between gap-2">
              <SectionLabel>{section.label}</SectionLabel>
              <span className="text-[0.6875rem] tabular-nums text-ink-faint">
                {section.filled}/{section.total}
              </span>
            </div>

            <dl className="mt-1.5 divide-y divide-hairline border-t border-hairline">
              {section.values.map((value) => (
                <div key={value.fieldKey} className="flex gap-3 py-1.5 text-xs">
                  <dt className="w-32 shrink-0 text-ink-muted">{value.label}</dt>
                  <dd
                    className={cn(
                      "min-w-0 flex-1",
                      value.value ? "text-ink" : "text-ink-faint",
                    )}
                  >
                    {/* Een streepje en geen lege cel: leeg is niet van "staat er
                        wel maar past niet" te onderscheiden. */}
                    {value.value || "–"}
                  </dd>
                  {value.value && !value.needsAttention && (
                    <CheckIcon className="mt-0.5 size-3 shrink-0 text-ok" />
                  )}
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </aside>
  );
}
