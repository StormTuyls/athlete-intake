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
/** Hoe ver je moet slepen voor het loslaten de opname weggooit. */
const CANCEL_DISTANCE = 56;

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

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
   * Wat er stond toen de opname begon.
   *
   * De dicteerknop levert tijdens het spreken telkens de HELE zin tot nu toe
   * opnieuw, niet het stukje dat erbij kwam. Daarom wordt de tekst achter deze
   * basis gezet en niet achter de huidige waarde: aanvullen zou van elke
   * tussenstand een laag maken ("Ik heb Ik heb al Ik heb al twee weken").
   *
   * De basis schuift alleen mee als er NIET opgenomen wordt. Wie tijdens het
   * opnemen ook nog begint te typen, ziet dat door de volgende tussenstand
   * overschreven worden; praten en typen tegelijk is geen geval waar iets
   * zinnigs voor te verzinnen valt.
   */
  const base = useRef(value);

  /** Waar de vinger neerkwam, voor de sleep-om-te-annuleren. */
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const [willCancel, setWillCancel] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const dictation = useDictation(
    useCallback(
      (text: string) => {
        const start = base.current.trimEnd();
        onChange(start ? `${start} ${text}` : text);
        textarea.current?.focus();
      },
      [onChange],
    ),
  );

  useEffect(() => {
    if (dictation.state !== "recording") base.current = value;
  }, [value, dictation.state]);

  // Een lopende teller, zoals bij een spraakbericht: zonder dat weet je niet of
  // hij nog luistert of al gestopt is. Op nul zetten gebeurt bij het indrukken en
  // niet hier: setState in een effectbody levert een cascade aan renders op, en
  // de teller staat toch alleen in beeld zolang er opgenomen wordt.
  useEffect(() => {
    if (dictation.state !== "recording") return;
    const id = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [dictation.state]);

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

  // Niet tijdens het opnemen. Versturen terwijl de herkenner nog luistert, zette
  // de zin meteen opnieuw in het veld: het bericht stond dan twee keer, een keer
  // verstuurd en een keer in de balk. Eerst loslaten, dan nalezen, dan sturen.
  const canSend = value.trim().length > 0 && !disabled && dictation.state === "idle";

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
            (dictation.state === "recording"
              ? willCancel
                ? t("releaseToCancel")
                : `${t("recording")} · ${formatSeconds(seconds)} · ${t("slideToCancel")}`
              : t("transcribing"))}
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
            disabled={disabled || dictation.state === "transcribing"}
            aria-label={dictation.state === "recording" ? t("dictateStop") : t("dictate")}
            aria-pressed={dictation.state === "recording"}
            onPointerDown={(event) => {
              if (disabled || dictation.state !== "idle") return;
              // De knop vangt de pointer, anders stopt een sleep buiten de knop
              // de gebeurtenissen en blijft de opname hangen.
              event.currentTarget.setPointerCapture(event.pointerId);
              pressedAt.current = { x: event.clientX, y: event.clientY };
              setWillCancel(false);
              setSeconds(0);
              dictation.press();
            }}
            onPointerMove={(event) => {
              const from = pressedAt.current;
              if (!from) return;
              const far =
                Math.hypot(event.clientX - from.x, event.clientY - from.y) >
                CANCEL_DISTANCE;
              setWillCancel(far);
            }}
            onPointerUp={() => {
              if (!pressedAt.current) return;
              pressedAt.current = null;
              dictation.release(willCancel);
              // Annuleren betekent: terug naar wat er stond voordat de vinger op
              // de knop ging. De hook gooit zijn eigen tekst weg maar weet niet
              // wat hier in het veld stond; dat weet alleen deze basis.
              if (willCancel) onChange(base.current);
              setWillCancel(false);
            }}
            onPointerCancel={() => {
              // Het toestel neemt de pointer over (een inkomend gesprek, een
              // systeemgebaar). Weggooien, want niemand heeft losgelaten.
              if (!pressedAt.current) return;
              pressedAt.current = null;
              dictation.release(true);
              onChange(base.current);
              setWillCancel(false);
            }}
            onKeyDown={(event) => {
              // Vasthouden is met een toetsenbord geen gebaar. Daarom hier wel een
              // aan-uitknop: zonder dit is dicteren niet te bedienen zonder muis.
              if (event.key !== " " && event.key !== "Enter") return;
              event.preventDefault();
              if (dictation.state === "recording") {
                dictation.release(false);
              } else {
                setSeconds(0);
                dictation.press();
              }
            }}
            className={cn(
              "flex size-10 shrink-0 touch-none select-none items-center justify-center rounded-chip ring-1 ring-inset transition-colors disabled:opacity-40",
              dictation.state === "recording"
                ? willCancel
                  ? "bg-ink-faint/20 text-ink-muted ring-hairline"
                  : "bg-danger-soft text-danger ring-danger/30"
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
