"use client";

import { useTranslations } from "next-intl";

/**
 * Wat er staat als een pagina omvalt.
 *
 * Deze app had geen enkele foutgrens: 46 routes, allemaal force-dynamic, en
 * elke onverwachte fout viel door naar het standaardscherm van Next. Dat is in
 * productie een lege pagina met "Application error: a server-side exception has
 * occurred", ongestileerd en in het Engels. De behandelaar weet dan niet of zijn
 * correctie bewaard is.
 *
 * In de wortel en niet per deel: hij vangt daarmee ook /review, /report en de
 * atleetschermen, die elk hun eigen schil hebben maar dezelfde behoefte.
 *
 * De fout zelf komt niet op het scherm. Een stacktrace of een pg-melding kan een
 * naam of een waarde bevatten, en dit is een app waar over de schouder wordt
 * meegekeken. reset() staat er wel: veel van deze fouten zijn een weggevallen
 * verbinding, en dan is opnieuw proberen het hele antwoord.
 */
export default function RootError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errors");

  return (
    <main className="mx-auto max-w-3xl px-6 py-10" role="alert">
      <h1 className="text-2xl font-semibold tracking-tight">{t("generic")}</h1>
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex min-h-11 items-center rounded-md px-3.5 text-sm ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
      >
        {t("retry")}
      </button>
    </main>
  );
}
