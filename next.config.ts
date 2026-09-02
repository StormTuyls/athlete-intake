import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Medische data: geen bronmaps in productiebundels.
  productionBrowserSourceMaps: false,
};

export default nextConfig;
