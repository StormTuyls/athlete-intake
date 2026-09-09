"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useTranslations } from "next-intl";
import { ConfidenceChip, confidenceVariant } from "@/components/intake/ConfidenceChip";
import { SectionLabel } from "@/components/intake/SectionLabel";
import { CheckIcon, PencilIcon, TagIcon } from "@/components/intake/icons";
import { EditValueForm } from "@/components/intake/EditValueForm";
import type { CaptureCard as CaptureCardData } from "@/lib/intake/transcriptTypes";

/**
 * Een veld dat de assistent zojuist heeft opgepikt.
 *
 * Bewust geen bubbel: dit is geen uitspraak van de assistent maar een gevolg
 * van wat de atleet zei of aanleverde. Als het eruitziet als een bericht, leest
 * het als een bewering, en dan gaat niemand er nog kritisch naar kijken.
 *
 * Confirm en Edit verschijnen alleen zolang het winnende voorstel van het model
 * komt. Die vlag is afgeleid en niet opgeslagen, dus na een bevestiging blijven
 * de knoppen ook na een reload weg.
 */
export function CaptureCardView({
  card,
  onConfirm,
  onEdit,
  className,
}: {
  card: CaptureCardData;
  onConfirm?: (fieldKey: string) => Promise<void> | void;
  onEdit?: (fieldKey: string, value: string) => Promise<void> | void;
  className?: string;
}) {
  const t = useTranslations("chat");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actionable = card.needsConfirmation && Boolean(onConfirm ?? onEdit);

  async function run(action: () => Promise<void> | void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not be saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-card bg-surface p-3 shadow-card ring-1 ring-hairline ring-inset",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>{t("fieldCaptured")}</SectionLabel>
        <ConfidenceChip variant={confidenceVariant(card.confidence, card.proposedBy)} />
      </div>

      <div className="mt-2 flex items-start gap-2.5">
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-chip bg-brand-50 text-brand-600"
          aria-hidden
        >
          <TagIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-muted">{card.label}</p>
          {!editing && <p className="text-sm break-words text-ink">{card.value}</p>}

          {editing && onEdit && (
            <EditValueForm
              card={card}
              busy={busy}
              error={error}
              onSave={(value) => void run(() => onEdit(card.fieldKey, value))}
              onCancel={() => {
                setEditing(false);
                setError(null);
              }}
            />
          )}
        </div>
      </div>

      {actionable && !editing && (
        <div className="mt-2.5 flex gap-2">
          {onConfirm && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => onConfirm(card.fieldKey))}
              aria-label={t("confirmField", { label: card.label.toLowerCase() })}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
            >
              <CheckIcon className="size-3.5" />
              {t("confirm")}
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
              aria-label={t("editField", { label: card.label.toLowerCase() })}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas disabled:opacity-40"
            >
              <PencilIcon className="size-3.5" />
              {t("edit")}
            </button>
          )}
        </div>
      )}

      {error && !editing && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
