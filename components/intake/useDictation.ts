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

  /**
   * Alles wat vaststaat sinds de vinger op de knop ging.
   *
   * Over INSTANTIES heen, niet per instantie. De herkenner stopt uit zichzelf en
   * wordt dan opnieuw gestart; elke nieuwe instantie begint met een lege
   * `results`, dus wat de vorige had vastgesteld moet hier blijven staan.
   */
  const settled = useRef("");

  /**
   * Of de vinger nog op de knop staat.
   *
   * Dit is de waarheid over "neemt hij op", niet de staat van de herkenner. Dat
   * onderscheid is de hele reden dat deze hook herschreven is; zie de kop.
   */
  const held = useRef(false);
  const heard = useRef<string[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const releaseStream = useCallback(() => {
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
      releaseStream();
    },
    [releaseStream],
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
      releaseStream();
      if (audio.size > 0) void send(audio);
      else setState("idle");
    };

    recorder.current = instance;
    instance.start();
    setState("recording");

    timer.current = setTimeout(() => instance.stop(), MAX_RECORDING_MS);
  }, [releaseStream, send, t]);

  /**
   * De gratis weg: de browser luistert en geeft tekst.
   *
   * Geen opname, geen upload, geen route. De audio gaat buiten ons om naar de
   * spraakdienst van de browser.
   *
   * ------------------------------------------------------------------------
   * Waarom dit indrukken-en-vasthouden is
   * ------------------------------------------------------------------------
   *
   * Dit was eerst een aan-uitknop, en dat werkte niet. `onend` vuurt namelijk
   * ook als de herkenner UIT ZICHZELF stopt, en dat doet hij na een pauze;
   * Chrome op Android negeert `continuous` grotendeels en sluit na één zin af.
   * Het gevolg: je begon te praten, dacht even na, de knop sprong terug op
   * "Inspreken", en alles wat je daarna zei was weg. Zonder melding.
   *
   * Nu is de VINGER de waarheid en niet de staat van de herkenner. Stopt die uit
   * zichzelf terwijl de knop nog ingedrukt is, dan komt er meteen een nieuwe. Wat
   * de vorige vaststelde blijft in `settled` staan, want elke nieuwe instantie
   * begint met een lege `results`.
   *
   * interimResults staat aan zodat je ziet wat er van je woorden gemaakt wordt.
   * Dat mag alleen omdat de aanroeper de tekst VERVANGT en niet aanvult: elke
   * beurt levert de hele zin tot nu toe.
   */
  const respawn = useRef<() => void>(() => {});

  const spawnRecognition = useCallback(() => {
    const Recognition = speechRecognition();
    if (!Recognition) return;

    const instance = new Recognition();
    instance.lang = BROWSER_LANG[locale] ?? "nl-NL";
    instance.continuous = true;
    instance.interimResults = true;

    instance.onresult = (event) => {
      // Cumulatief binnen DEZE instantie; eerdere instanties staan in settled.
      let done = "";
      let pending = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) done += result[0].transcript;
        else pending += result[0].transcript;
      }

      heard.current = [done];
      const shown = `${settled.current} ${done} ${pending}`.replace(/\s+/g, " ").trim();
      if (shown) onText(shown);
    };

    instance.onerror = (event) => {
      // 'no-speech' is een stilte en 'aborted' is onze eigen stopknop. Allebei
      // een melding geven is een waarschuwing over niets. Bij een echte fout gaat
      // de vinger eraf, anders start onend meteen een nieuwe die weer faalt.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        held.current = false;
        setError(t("micDenied"));
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        held.current = false;
        setError(t("dictateFailed"));
      }
    };

    instance.onend = () => {
      const done = heard.current.join("").trim();
      if (done) settled.current = `${settled.current} ${done}`.trim();
      heard.current = [];
      recognition.current = null;

      // De bugfix. Zolang de knop ingedrukt is, gaat het luisteren door.
      //
      // Via een ref en niet rechtstreeks: een useCallback die zichzelf aanroept
      // verwijst naar een const die op dat moment nog niet bestaat, en de
      // react-hooks-lintregel weigert dat terecht.
      if (held.current) {
        respawn.current();
        return;
      }

      setState("idle");
      const text = settled.current.trim();
      settled.current = "";
      if (text) onText(text);
    };

    recognition.current = instance;
    instance.start();
  }, [locale, onText, t]);

  useEffect(() => {
    respawn.current = spawnRecognition;
  }, [spawnRecognition]);

  /** Vinger op de knop. */
  const beginHold = useCallback(() => {
    if (!speechRecognition() || held.current) return;
    setError(null);
    held.current = true;
    settled.current = "";
    heard.current = [];
    setState("recording");
    spawnRecognition();
  }, [spawnRecognition]);

  /**
   * Vinger van de knop.
   *
   * `discard` is de sleepbeweging weg van de knop, zoals in WhatsApp: dan telt de
   * opname niet. abort() en niet stop(), want stop() levert nog een laatste
   * resultaat af en dat is precies wat weg moet.
   */
  const endHold = useCallback((discard: boolean) => {
    if (!held.current) return;
    held.current = false;

    if (discard) {
      settled.current = "";
      heard.current = [];
      const instance = recognition.current;
      recognition.current = null;
      setState("idle");
      instance?.abort();
      return;
    }

    recognition.current?.stop();
  }, []);

  return {
    available: engine !== null,
    /** Waar als de browser luistert in plaats van onze server. De UI zegt dat. */
    viaBrowser: engine === "browser",
    state,
    error,
    clearError: useCallback(() => setError(null), []),

    /** Indrukken. Bij de servermotor begint hier de opname. */
    press: useCallback(() => {
      if (state !== "idle") return;
      if (engine === "browser") beginHold();
      else if (engine === "server") void start();
    }, [beginHold, engine, start, state]),

    /** Loslaten. `discard` gooit weg wat er herkend is in plaats van af te ronden. */
    release: useCallback(
      (discard = false) => {
        if (engine === "browser") endHold(discard);
        else if (state === "recording") stop();
      },
      [endHold, engine, state, stop],
    ),
  };
}
