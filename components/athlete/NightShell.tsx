import { LocaleToggle } from "@/components/LocaleToggle";
import { BrandMark, LockIcon } from "@/components/athlete/icons";
import { PRACTICE_NAME } from "@/lib/report/branding";

/**
 * De omhulling van de twee donkere atleetschermen: aanmelden en de
 * toestemmingspoort.
 *
 * Dezelfde redenering als components/auth/AuthShell.tsx, met de nachttokens.
 * Beide schermen waren een kolom van max-w-sm die op een telefoon het hele
 * scherm vult en op een laptop een strook van 384 pixels werd met aan
 * weerszijden zwart.
 *
 * Vanaf lg twee panelen over de volle hoogte. Links de merknaam, de kop en de
 * introzin; rechts het formulier. De privacyregel staat links onderaan, waar
 * hij hoort: hij gaat over waar je bent, niet over het veld waar je in typt.
 *
 * De taalknop blijft in het linkerpaneel en dus boven de consenttekst. Dat was
 * een bewuste keuze en die verandert hier niet: de tekst waar iemand mee
 * instemt hoort in de taal te staan die hij gekozen heeft voordat hij hem las.
 *
 * Onder lg: één kolom, kop boven, formulier eronder, privacyregel onderaan.
 * Precies wat het was.
 */
export function NightShell({
  headline,
  intro,
  footer,
  children,
}: {
  headline: React.ReactNode;
  intro: React.ReactNode;
  /** De privacyregel naast het slotje. */
  footer: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col bg-night text-night-ink lg:grid lg:grid-cols-[26rem_minmax(0,1fr)] lg:items-stretch">
      <div className="flex flex-col px-6 pt-10 lg:justify-between lg:border-r lg:border-night-line lg:px-10 lg:py-12">
        <div className="mx-auto flex w-full max-w-sm items-center justify-between gap-2 lg:max-w-none">
          <div className="flex items-center gap-2">
            <BrandMark className="size-5 text-brand-500" />
            <span className="text-base font-semibold tracking-tight">
              {PRACTICE_NAME}
            </span>
          </div>
          <LocaleToggle className="ring-night-line" />
        </div>

        <div className="mx-auto mt-8 w-full max-w-sm lg:mt-12 lg:max-w-[24rem]">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight lg:text-[2rem]">
            {headline}
          </h1>
          <div className="mt-2.5 text-sm text-night-muted lg:mt-4 lg:text-base lg:leading-relaxed">
            {intro}
          </div>
        </div>

        <footer className="mx-auto mt-auto hidden w-full max-w-[24rem] items-center gap-1.5 pt-12 text-xs text-night-muted lg:flex">
          <LockIcon className="size-3.5 shrink-0" />
          <span>{footer}</span>
        </footer>
      </div>

      <div className="flex flex-1 flex-col px-6 pt-8 pb-10 lg:justify-center lg:px-10 lg:py-12">
        <div className="mx-auto flex w-full max-w-sm flex-col">
          {children}

          <footer className="mt-auto flex items-center justify-center gap-1.5 pt-10 text-xs text-night-muted lg:hidden">
            <LockIcon className="size-3.5 shrink-0" />
            <span>{footer}</span>
          </footer>
        </div>
      </div>
    </main>
  );
}
