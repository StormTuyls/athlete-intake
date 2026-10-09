import { LocaleToggle } from "@/components/LocaleToggle";
import { PRACTICE_NAME } from "@/lib/report/branding";

/**
 * De omhulling van de lichte authenticatieschermen: inloggen als behandelaar,
 * een herstelmail aanvragen, een nieuw wachtwoord kiezen.
 *
 * Alle drie waren een kolom van max-w-sm, verticaal gecentreerd. Op een
 * telefoon is dat het hele scherm en dus precies goed. Op een laptop was het
 * een formulier van 384 pixels in het midden van 1440, met aan weerszijden
 * niets.
 *
 * Er heeft hier een tussenversie gestaan met een kaart op een backdrop. Die is
 * weg, want dat lost het niet op: een telefoonkolom met een mat eromheen is nog
 * steeds een telefoonkolom. Vanaf lg staan er nu twee panelen die samen het
 * scherm vullen. Links waar je bent en waarom dit scherm er is, rechts het
 * formulier, verticaal gecentreerd in zijn eigen helft.
 *
 * De zinnen links zijn niet verzonnen om de ruimte te vullen: ze stonden al op
 * deze schermen, boven en onder het formulier geplakt, waar ze de invoervelden
 * uit elkaar duwden.
 *
 * Onder lg valt het terug op precies wat het was: één kolom, context boven,
 * formulier eronder, verticaal gecentreerd.
 */
export function AuthShell({
  title,
  intro,
  note,
  children,
}: {
  /** De kop links. Meestal de naam van de praktijk. */
  title?: string;
  /** Waarom dit scherm er is. Eén zin. */
  intro: string;
  /** De kleine regel eronder, als het scherm er een heeft. */
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col justify-center lg:grid lg:min-h-dvh lg:grid-cols-[24rem_minmax(0,1fr)] lg:justify-stretch">
      {/* Het contextpaneel. Onder lg is dit gewoon de kop boven het formulier.
          Vanaf lg is het de linkerhelft over de volle hoogte: bg-canvas tegen
          het witte formuliervlak, zodat de scheiding uit de kleur komt en niet
          uit een streep. */}
      <div className="flex flex-col px-6 pt-10 lg:justify-between lg:bg-canvas lg:border-r lg:border-hairline lg:px-10 lg:py-12">
        <div className="mx-auto flex w-full max-w-sm items-baseline justify-between gap-2 lg:max-w-none">
          <h1 className="text-xl font-semibold tracking-tight">
            {title ?? PRACTICE_NAME}
          </h1>
          <LocaleToggle />
        </div>

        {/* Op een laptop is dit de zin die het paneel draagt, dus daar mag hij
            groter. Op een telefoon is het een onderschrift bij de kop. */}
        <p className="mx-auto mt-1 w-full max-w-sm text-sm text-ink-muted lg:mt-10 lg:max-w-[22rem] lg:text-lg lg:leading-relaxed lg:text-ink">
          {intro}
        </p>

        {note && (
          <p className="mx-auto mt-auto hidden w-full max-w-[22rem] pt-10 text-xs text-ink-muted lg:block">
            {note}
          </p>
        )}
      </div>

      {/* Het formulierpaneel. */}
      <div className="flex flex-col px-6 pt-8 pb-10 lg:justify-center lg:px-10 lg:py-12">
        <div className="mx-auto flex w-full max-w-sm flex-col">
          {children}
          {note && <p className="mt-8 text-xs text-ink-muted lg:hidden">{note}</p>}
        </div>
      </div>
    </main>
  );
}
