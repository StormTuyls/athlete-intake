"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Inspreken in plaats van typen.
 *
 * De opname gaat naar /api/intake/transcribe en de tekst komt terug in het
 * invoerveld. Niet rechtstreeks het gesprek in: de atleet leest na. Zie
 * lib/intake/transcribe.ts voor waarom de audio niet bij de browser blijft.
 *
 * Twee dingen die hier fout kunnen gaan en die je pas op een echt toestel merkt:
 *
 * 1. De microfoon blijft aan. getUserMedia levert een stream, en die stopt niet
 *    vanzelf als de recorder stopt. Zonder de tracks expliciet te stoppen blijft
 *    het opnamelampje van de telefoon branden nadat het gesprek al verder is.
 *    Vandaar dat de stream in een ref staat en in precies één functie opgeruimd
 *    wordt, die ook bij een fout en bij unmount loopt.
 * 2. De opname loopt door. Iemand drukt op opnemen, legt de telefoon neer en
 *    vergeet het. Er is dus een harde bovengrens, en die ligt onder de
 *    bytelimiet van de route zodat je een nette melding krijgt in plaats van een
 *    geweigerde upload na vijf minuten praten.
 */

/** Twee minuten. Ruim voor een antwoord, en opus blijft er ver onder de 10 MB. */
const MAX_RECORDING_MS = 120_000;

export type DictationState = "idle" | "recording" | "transcribing";

export function useDictation(onText: (text: string) => void) {
  const t = useTranslations("chat");
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
  }, []);

  /**
   * Of de knop er hoort te staan.
   *
   * Drie dingen moeten kloppen, en ze falen alle drie stil. De API's ontbreken
   * in een onveilige context (http op een ander toestel dan localhost), de
   * MediaRecorder ontbreekt in oudere browsers, en de server heeft geen
   * transcriptiesleutel. Een knop die bij een van de drie alsnog verschijnt is
   * een knop die niets doet.
   */
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      return;
    }

    let ignore = false;

    fetch("/api/intake/transcribe")
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { available?: boolean };
        if (!ignore && body.available === true) setAvailable(true);
      })
      .catch(() => {
        // Stil: dicteren is een extraatje. Dat de knop wegblijft is het
        // antwoord, een foutmelding over een feature die je niet gebruikte niet.
      });

    return () => {
      ignore = true;
    };
  }, []);

  // Bij het verlaten van het scherm midden in een opname: microfoon uit.
  useEffect(() => release, [release]);

  const send = useCallback(
    async (audio: Blob) => {
      setState("transcribing");
      try {
        const form = new FormData();
        form.append("audio", audio);

        const response = await fetch("/api/intake/transcribe", {
          method: "POST",
          body: form,
        });

        const body = (await response.json()) as { text?: string; error?: string };
        if (!response.ok) {
          setError(body.error ?? t("dictateFailed"));
          return;
        }

        const text = body.text?.trim();
        if (text) onText(text);
      } catch {
        setError(t("dictateFailed"));
      } finally {
        setState("idle");
      }
    },
    [onText, t],
  );

  const stop = useCallback(() => {
    // Stop zet de recorder niet meteen op inactive; onstop volgt asynchroon en
    // doet het opruimen. Hier alleen de timer, zodat twee keer stoppen niets
    // dubbel doet.
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    recorder.current?.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);

    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Geweigerd, of geen microfoon. Beide gevallen zijn voor de atleet
      // hetzelfde: hij moet iets in zijn browser aanzetten.
      setError(t("micDenied"));
      return;
    }

    stream.current = media;
    chunks.current = [];

    // Opus in webm is klein en wordt overal gelezen waar MediaRecorder bestaat,
    // behalve in Safari; daar valt dit terug op wat Safari zelf kiest (mp4).
    const preferred = "audio/webm;codecs=opus";
    const instance = new MediaRecorder(
      media,
      MediaRecorder.isTypeSupported(preferred) ? { mimeType: preferred } : undefined,
    );

    instance.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };

    instance.onstop = () => {
      const audio = new Blob(chunks.current, { type: instance.mimeType });
      chunks.current = [];
      release();
      if (audio.size > 0) void send(audio);
      else setState("idle");
    };

    recorder.current = instance;
    instance.start();
    setState("recording");

    timer.current = setTimeout(() => instance.stop(), MAX_RECORDING_MS);
  }, [release, send, t]);

  return {
    available,
    state,
    error,
    clearError: useCallback(() => setError(null), []),
    toggle: useCallback(() => {
      if (state === "recording") stop();
      else if (state === "idle") void start();
    }, [state, start, stop]),
  };
}
