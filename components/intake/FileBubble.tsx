"use client";

import { cn } from "@/lib/cn";
import { useTranslations } from "next-intl";
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

/** De toestand van een upload, als berichtsleutel. */
const STATE_KEY: Record<DocumentState, string> = {
  uploading: "uploading",
  processing: "processing",
  read: "read",
  failed: "failed",
};

/**
 * Wat voor document dit is, in woorden.
 *
 * `pdf_text` betekent in de databank "document met een tekstlaag", en dat is
 * niet altijd een PDF: een los .txt-bestand valt in dezelfde categorie. Dat
 * blind als "PDF" tonen liegt over het bestand dat de atleet net verstuurde,
 * dus het mimetype beslist en het kind vult alleen aan.
 */
/** Van documentsoort naar berichtsleutel; snake_case wordt camelCase. */
const KIND_KEY: Record<string, string> = {
  pdf_scanned: "pdfScanned",
  image: "image",
  whatsapp_export: "whatsappExport",
  vald_csv: "valdCsv",
};

function kindLabel(
  kind: string | null,
  mimeType: string,
  t: (key: string) => string,
): string | null {
  if (kind && KIND_KEY[kind]) return t(KIND_KEY[kind]);
  if (mimeType === "application/pdf") return t("pdf");
  if (mimeType === "text/csv") return t("csv");
  if (mimeType.startsWith("image/")) return t("image");
  if (mimeType === "text/plain") return t("text");
  return kind;
}

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
  const t = useTranslations("intake");
  const tFile = useTranslations("files");
  const meta = [
    formatBytes(byteSize),
    kindLabel(documentKind, mimeType, tFile as (key: string) => string),
    state === "read" && fieldsProposed !== undefined && quotesVerified !== undefined
      ? tFile("quotesVerified", { verified: quotesVerified, total: fieldsProposed })
      : tFile(STATE_KEY[state] as never),
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
            {error} ({t("documentKept")})
          </p>
        )}
      </div>
    </div>
  );
}
