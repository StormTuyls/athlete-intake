"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useTranslations } from "next-intl";
import { ACCEPT_ATTRIBUTE } from "@/lib/intake/uploads";
import { ArrowUpIcon, MicIcon, PlusIcon, StopIcon } from "@/components/intake/icons";
import { useDictation } from "@/components/intake/useDictation";

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
  const t = useTranslations("chat");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [rowsHeight, setRowsHeight] = useState<number>();

  /**
   * De laatste waarde, voor de dicteerknop.
   *
   * De callback die de transcriptie ontvangt wordt eenmalig aan de recorder
   * gehangen. Zou hij `value` uit de sluiting lezen, dan plakt hij de tekst
   * achter de waarde van het moment dat de opname begon, en verdwijnt alles wat
   * er tijdens het opnemen bijgetypt is.
   */
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  const dictation = useDictation(
    useCallback(
      (text: string) => {
        const current = latest.current.trimEnd();
        onChange(current ? `${current} ${text}` : text);
        textarea.current?.focus();
      },
      [onChange],
    ),
  );

  // Hoogte volgt de inhoud. Eerst terug naar auto, anders groeit hij alleen.
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    // Was 140px, ongeveer vier regels. Dat paste bij een gesprek van korte
    // antwoorden op losse vragen. De openingsbeurt vraagt nu om een heel
    // verhaal, en wie dat intypt of inspreekt hoort te kunnen nalezen wat hij
    // zegt in plaats van door een kiertje van vier regels te scrollen. Boven
    // deze hoogte scrollt het veld alsnog, zodat de invoerbalk het toetsenbord
    // op een telefoon niet van het scherm duwt.
    setRowsHeight(Math.min(element.scrollHeight, 220));
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
      {/* Opnemen is een toestand die je moet kunnen zien, niet alleen aan een
          knop die van kleur verandert. Aria-live omdat een rode knop niets zegt
          tegen iemand met een schermlezer. */}
      {(dictation.state !== "idle" || dictation.error) && (
        <p
          aria-live="polite"
          className={cn(
            "mb-1.5 flex items-center gap-1.5 px-1 text-xs",
            dictation.error ? "text-danger" : "text-ink-muted",
          )}
        >
          {dictation.state === "recording" && (
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" />
          )}
          {dictation.error ??
            (dictation.state === "recording" ? t("recording") : t("transcribing"))}
        </p>
      )}

      {/* Wie de stem hoort. Bij de browsermotor gaat de audio buiten ons om naar
          Google of Apple, en dat hoort de atleet te weten voordat hij zijn
          klachten inspreekt. Zie de kop van useDictation.ts. */}
      {dictation.viaBrowser && dictation.state === "recording" && (
        <p className="mb-1.5 px-1 text-xs text-ink-faint">{t("dictateBrowserNote")}</p>
      )}

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
          aria-label={t("addFile")}
          className="flex size-10 shrink-0 items-center justify-center rounded-chip ring-1 ring-hairline ring-inset text-ink-muted transition-colors hover:bg-canvas disabled:opacity-40"
        >
          <PlusIcon className="size-5" />
        </button>

        {dictation.available && (
          <button
            type="button"
            onClick={dictation.toggle}
            disabled={disabled || dictation.state === "transcribing"}
            aria-label={dictation.state === "recording" ? t("dictateStop") : t("dictate")}
            aria-pressed={dictation.state === "recording"}
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-chip ring-1 ring-inset transition-colors disabled:opacity-40",
              dictation.state === "recording"
                ? "bg-danger-soft text-danger ring-danger/30"
                : "text-ink-muted ring-hairline hover:bg-canvas",
            )}
          >
            {dictation.state === "recording" ? (
              <StopIcon className="size-5" />
            ) : (
              <MicIcon className="size-5" />
            )}
          </button>
        )}

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
          placeholder={t("placeholder")}
          disabled={disabled}
          enterKeyHint="send"
          style={{ height: rowsHeight }}
          className="min-h-10 flex-1 resize-none rounded-bubble bg-canvas px-4 py-2.5 text-base leading-tight text-ink ring-1 ring-hairline ring-inset outline-none placeholder:text-ink-faint focus-visible:ring-brand-500 disabled:opacity-60"
        />

        <button
          type="submit"
          disabled={!canSend}
          aria-label={t("send")}
          className="flex size-10 shrink-0 items-center justify-center rounded-chip bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:bg-ink-faint disabled:opacity-40"
        >
          <ArrowUpIcon className="size-5" />
        </button>
      </form>
    </div>
  );
}
