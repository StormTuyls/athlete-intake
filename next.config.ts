import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Medische data: geen bronmaps in productiebundels.
  productionBrowserSourceMaps: false,

  // De dev-indicator is een overlay in een hoek, en op een scherm van 375 breed
  // zit in elke hoek een knop: linksonder document toevoegen, rechtsonder
  // versturen, boven de terugknop en de voortgangsring. Verplaatsen schuift het
  // probleem dus alleen op. Uit betekent niet blind: compile- en runtimefouten
  // komen nog steeds in de terminal en de console.
  devIndicators: false,
};

/**
 * next-intl zonder [locale]-segment.
 *
 * De plugin doet één ding dat we nodig hebben: hij legt de alias
 * `next-intl/config` naar ./i18n/request.ts, zodat getTranslations en
 * NextIntlClientProvider weten waar de berichten staan. Geen middleware, geen
 * routing: de taal is hier een kolom en geen URL. Zie lib/i18n/locale.ts.
 */
export default createNextIntlPlugin()(nextConfig);
