import { cn } from "@/lib/cn";
import { intake } from "@/lib/intake/copy";
import { formatBytes } from "@/lib/intake/uploads";
import { FileIcon } from "@/components/intake/icons";
import type { DocumentState } from "@/lib/intake/transcriptTypes";

/**
 * Het bestand dat de atleet toevoegde, met wat ermee gebeurd is.
 *
 * De metaregel zegt bewust niet "OCR ✓". Er is geen OCR-stap: een scan gaat als
 * document naar het model en zijn citaten zijn per definitie niet te verifieren
 * tegen een tekstlaag die er niet is. Een groen vinkje daarnaast zou precies de
 * zekerheid suggereren die de betrouwbaarheidsregels moeten voorkomen. Wat er
 * staat is wat waar is: hoe groot, welk soort, en hoeveel citaten geverifieerd
 * zijn.
 */

const STATE_TEXT: Record<DocumentState, string> = {
  uploading: "uploading",
  processing: "reading",
  read: "read",
  failed: "could not be read",
};

const KIND_TEXT: Record<string, string> = {
  pdf_text: "PDF",
  pdf_scanned: "scanned PDF",
  image: "image",
  whatsapp_export: "WhatsApp export",
  vald_csv: "test data",
};

export function FileBubble({
  filename,
  mimeType,
  byteSize,
  documentKind,
  state,
  error,
  quotesVerified,
  fieldsProposed,
  className,
}: {
  filename: string;
  mimeType: string;
  byteSize: number;
  documentKind: string | null;
  state: DocumentState;
  error: string | null;
  /** Alleen bekend zodra het document gelezen is. */
  quotesVerified?: number;
  fieldsProposed?: number;
  className?: string;
}) {
  const meta = [
    formatBytes(byteSize),
    documentKind ? (KIND_TEXT[documentKind] ?? documentKind) : null,
    state === "read" && fieldsProposed !== undefined && quotesVerified !== undefined
      ? `${quotesVerified} of ${fieldsProposed} quotes verified`
      : STATE_TEXT[state],
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "ml-auto flex max-w-[85%] items-start gap-2.5 rounded-bubble bg-surface p-3 shadow-bubble ring-1 ring-inset",
        state === "failed" ? "ring-danger/30" : "ring-hairline",
        className,
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-chip",
          state === "failed"
            ? "bg-danger-soft text-danger"
            : "bg-brand-50 text-brand-600",
        )}
        aria-hidden
      >
        <FileIcon mimeType={mimeType} className="size-4" />
      </span>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{filename}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{meta.join(" · ")}</p>
        {error && (
          <p className="mt-1 text-xs text-danger">
            {error} ({intake.documentKept})
          </p>
        )}
      </div>
    </div>
  );
}
