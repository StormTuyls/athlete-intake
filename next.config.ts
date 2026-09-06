import type { NextConfig } from "next";

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

export default nextConfig;
