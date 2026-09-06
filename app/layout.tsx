import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "unbound intake",
  description: "AI-guided intake assistant for athlete support",
  // Geen indexering: de intake is per definitie niet publiek vindbaar.
  robots: { index: false, follow: false },
};

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
