"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { chat } from "@/lib/intake/copy";
import { ACCEPT_ATTRIBUTE } from "@/lib/intake/uploads";
import { ArrowUpIcon, PlusIcon } from "@/components/intake/icons";

/**
 * De invoerbalk: bestand toevoegen, antwoord typen, versturen.
 *
 * Een textarea en geen input, want antwoorden op "beschrijf je klachten" lopen
 * over meer dan een regel. Enter verstuurt en Shift+Enter geeft een nieuwe
 * regel: dat is wat mensen van een chat verwachten. De hoogte groeit mee tot
 * een maximum, daarna scrollt het veld.
 *
 * De tekstgrootte is 16px en dat is geen smaak: onder 16px zoomt iOS Safari
 * automatisch in zodra het veld focus krijgt, en dan staat de layout scheef.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onFilesPicked,
  disabled = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFilesPicked: (files: FileList) => void;
  disabled?: boolean;
  className?: string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [rowsHeight, setRowsHeight] = useState<number>();

  // Hoogte volgt de inhoud. Eerst terug naar auto, anders groeit hij alleen.
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    setRowsHeight(Math.min(element.scrollHeight, 140));
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div
      className={cn(
        "sticky bottom-0 border-t border-hairline bg-surface/95 px-3 pt-2.5 backdrop-blur",
        "pb-[max(0.625rem,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) onSubmit();
        }}
        className="flex items-end gap-2"
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) onFilesPicked(event.target.files);
            // Leegmaken, anders vuurt hetzelfde bestand twee keer kiezen geen change.
            event.target.value = "";
          }}
        />

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={disabled}
          aria-label={chat.addFile}
          className="flex size-10 shrink-0 items-center justify-center rounded-chip ring-1 ring-hairline ring-inset text-ink-muted transition-colors hover:bg-canvas disabled:opacity-40"
        >
          <PlusIcon className="size-5" />
        </button>

        <textarea
          ref={textarea}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          placeholder={chat.placeholder}
          disabled={disabled}
          enterKeyHint="send"
          style={{ height: rowsHeight }}
          className="min-h-10 flex-1 resize-none rounded-bubble bg-canvas px-4 py-2.5 text-base leading-tight text-ink ring-1 ring-hairline ring-inset outline-none placeholder:text-ink-faint focus-visible:ring-brand-500 disabled:opacity-60"
        />

        <button
          type="submit"
          disabled={!canSend}
          aria-label={chat.send}
          className="flex size-10 shrink-0 items-center justify-center rounded-chip bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:bg-ink-faint disabled:opacity-40"
        >
          <ArrowUpIcon className="size-5" />
        </button>
      </form>
    </div>
  );
}
