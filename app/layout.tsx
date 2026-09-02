import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atleetintake",
  description: "Intake-assistent voor atletenbegeleiding",
  // Geen indexering: de intake is per definitie niet publiek vindbaar.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
