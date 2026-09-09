import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");

  return {
    title: t("title"),
    description: t("description"),
    // Geen indexering: de intake is per definitie niet publiek vindbaar.
    robots: { index: false, follow: false },
  };
}

/**
 * De schermen zijn mobile-first, dus de viewport moet kloppen.
 *
 * Geen maximum-scale en geen user-scalable=no: dat sloopt pinch-zoom, en op een
 * scherm waar iemand een diagnose of een pijnschaal moet nalezen is inzoomen
 * geen luxe. interactiveWidget zorgt dat het toetsenbord de invoerbalk omhoog
 * duwt in plaats van eroverheen te schuiven.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

/**
 * De provider staat hier en niet per pagina, omdat clientcomponenten diep in de
 * boom zitten (het chatscherm, het coachdossier) en die allemaal bij dezelfde
 * berichten moeten kunnen. `lang` volgt dezelfde taal: een schermlezer die de
 * verkeerde taal aanneemt spreekt Nederlandse namen als Engelse woorden uit.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body className="antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
