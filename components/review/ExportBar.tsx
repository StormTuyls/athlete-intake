"use client";

import { PRACTICE_NAME } from "@/lib/report/branding";

/**
 * De drie manieren om het rapport mee te nemen.
 *
 * Alle drie zijn gewone links, geen fetch met een blob erachter. Dat is niet
 * luiheid: een link werkt zonder JavaScript, opent in een nieuw tabblad zoals de
 * gebruiker verwacht, en laat de browser het downloaden doen in plaats van dat
 * wij het nabouwen.
 *
 * PDF is de printroute en geen apart formaat. Zo bestaat het rapport één keer,
 * en is de PDF aantoonbaar hetzelfde document als op het scherm.
 */
export function ExportBar({ intakeId }: { intakeId: string }) {
  const base = `/api/review/${intakeId}/export`;

  return (
    <div className="no-print sticky bottom-0 mt-8 flex gap-2 border-t border-hairline bg-surface/95 py-3 backdrop-blur">
      <a
        href={`/review/${intakeId}/print`}
        target="_blank"
        rel="noopener"
        className="flex-1 rounded-md bg-brand-600 px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-brand-700"
      >
        PDF
      </a>
      <a
        href={`${base}?format=json`}
        className="rounded-md px-4 py-2 text-sm font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
      >
        JSON
      </a>
      <a
        href={`${base}?format=csv`}
        className="rounded-md px-4 py-2 text-sm font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
      >
        CSV
      </a>
      <span className="sr-only">Reports are exported from {PRACTICE_NAME}.</span>
    </div>
  );
}
