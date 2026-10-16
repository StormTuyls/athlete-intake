"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

/**
 * Inspreken in plaats van typen.
 *
 * De opname gaat naar /api/intake/transcribe en de tekst komt terug in het
 * invoerveld. Niet rechtstreeks het gesprek in: de atleet leest na. Zie
 * lib/intake/transcribe.ts voor waarom de audio niet bij de browser blijft.
 *
 * ---------------------------------------------------------------------------
 * Twee motoren
 * ---------------------------------------------------------------------------
 *
 * `server`  opnemen en naar /api/intake/transcribe sturen. Eerste keus, want
 *           dan weten we welke partij de audio hoort en staat die in het
 *           verwerkingsregister.
 * `browser`  de spraakherkenning van de browser zelf (SpeechRecognition). Geen
 *           sleutel, geen kosten, en de audio gaat buiten ons om naar Google
 *           (Chrome) of Apple (Safari). Dat is een subverwerker die wij niet
 *           kiezen en niet kunnen beperken, dus de atleet krijgt het te ZIEN:
 *           browserNote staat in de statusregel zodra deze motor actief is.
 *           Transparantie naar de betrokkene is bij artikel 9-gegevens geen
 *           keuze. Zie de subverwerkerstabel in docs/oplevering.md.
 *
 * De serverkant wint altijd als hij geconfigureerd is. Een sleutel zetten is
 * daarmee genoeg om de browsermotor uit te schakelen.
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

/** De taalcode die SpeechRecognition wil, afgeleid van de schermtaal. */
const BROWSER_LANG: Record<string, string> = { nl: "nl-NL", en: "en-GB" };

/**
 * Het stukje SpeechRecognition dat we gebruiken.
 *
 * Met de hand getypeerd omdat lib.dom het niet in elke TypeScript-versie heeft,
 * en `any` zou de enige plek waar de browser ons tekst teruggeeft ongecontroleerd
 * laten.
 */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type DictationState = "idle" | "recording" | "transcribing";

/** Welke motor de knop gebruikt. Null betekent: geen knop. */
type Engine = "server" | "browser" | null;

export function useDictation(onText: (text: string) => void) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const [engine, setEngine] = useState<Engine>(null);
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const heard = useRef<string[]>([]);
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
   * Welke motor er is, als er een is.
   *
   * De server wint, want dan weten we welke partij de audio hoort. Pas als die
   * geen sleutel heeft valt het terug op de browser. Allebei de paden falen
   * stil als je ze niet controleert: de opname-API's ontbreken in een onveilige
   * context (http op een ander toestel dan localhost) en in oudere browsers, en
   * SpeechRecognition bestaat niet in Firefox. Een knop die dan toch verschijnt
   * is een knop die niets doet.
   */
  useEffect(() => {
    const canRecord =
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined";

    const browserEngine = speechRecognition() ? ("browser" as const) : null;

    let ignore = false;

    fetch("/api/intake/transcribe")
      .then(async (response) => {
        if (!response.ok) throw new Error("niet beschikbaar");
        const body = (await response.json()) as { available?: boolean };
        if (ignore) return;
        setEngine(body.available === true && canRecord ? "server" : browserEngine);
      })
      .catch(() => {
        // Geen antwoord van onze route is geen reden om niets aan te bieden:
        // de browsermotor heeft die route niet nodig.
        if (!ignore) setEngine(browserEngine);
      });

    return () => {
      ignore = true;
    };
  }, []);

  // Bij het verlaten van het scherm midden in een opname: microfoon uit, bij
  // allebei de motoren. abort() en niet stop(), want stop() levert nog een
  // onend met tekst voor een component die niet meer bestaat.
  useEffect(
    () => () => {
      recognition.current?.abort();
      recognition.current = null;
      release();
    },
    [release],
  );

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

  /**
   * De gratis weg: de browser luistert en geeft tekst.
   *
   * Geen opname, geen upload, geen route. De audio gaat buiten ons om naar de
   * spraakdienst van de browser. Daarom hoort hier geen enkele slimmigheid in:
   * hoe minder dit pad doet, hoe minder er te verklaren valt.
   *
   * continuous staat aan omdat een antwoord op "vertel wat er speelt" langer
   * duurt dan de stilte waarop de herkenner anders afsluit.
   *
   * interimResults staat ook aan, zodat de atleet ziet wat er van zijn woorden
   * gemaakt wordt terwijl hij praat. Dat mag alleen omdat de aanroeper de tekst
   * VERVANGT en niet aanvult: elke beurt levert de volledige zin tot nu toe, en
   * de Composer zet die achter wat er al stond toen de opname begon. Zou hij
   * aanvullen, dan stapelt elke tussenstand zich op tot "Ik heb Ik heb al Ik heb
   * al twee weken".
   */
  const startBrowser = useCallback(() => {
    const Recognition = speechRecognition();
    if (!Recognition) return;

    setError(null);
    heard.current = [];

    const instance = new Recognition();
    instance.lang = BROWSER_LANG[locale] ?? "nl-NL";
    instance.continuous = true;
    instance.interimResults = true;

    instance.onresult = (event) => {
      // event.results is cumulatief: het bevat alles sinds start(), dus de hele
      // zin wordt elke beurt opnieuw opgebouwd in plaats van bijgehouden.
      let settled = "";
      let pending = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) settled += result[0].transcript;
        else pending += result[0].transcript;
      }

      heard.current = [settled];
      const shown = `${settled} ${pending}`.replace(/\s+/g, " ").trim();
      if (shown) onText(shown);
    };

    instance.onerror = (event) => {
      // 'no-speech' is geen fout maar een stilte, en 'aborted' is onze eigen
      // stopknop. Allebei een melding geven is een waarschuwing over niets.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError(t("micDenied"));
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(t("dictateFailed"));
      }
    };

    instance.onend = () => {
      recognition.current = null;
      const text = heard.current.join(" ").trim();
      heard.current = [];
      // De tussenstand staat al in het veld. Hier alleen nog de definitieve
      // versie erover, zodat een half woord van de laatste tussenstand niet
      // blijft staan. setState pas daarna: zolang de staat 'recording' is, laat
      // de Composer de tekst vervangen in plaats van aanvullen.
      if (text) onText(text);
      setState("idle");
    };

    recognition.current = instance;
    instance.start();
    setState("recording");
  }, [locale, onText, t]);

  return {
    available: engine !== null,
    /** Waar als de browser luistert in plaats van onze server. De UI zegt dat. */
    viaBrowser: engine === "browser",
    state,
    error,
    clearError: useCallback(() => setError(null), []),
    toggle: useCallback(() => {
      if (state === "recording") {
        if (engine === "browser") recognition.current?.stop();
        else stop();
        return;
      }
      if (state !== "idle") return;
      if (engine === "browser") startBrowser();
      else if (engine === "server") void start();
    }, [engine, state, start, startBrowser, stop]),
  };
}
