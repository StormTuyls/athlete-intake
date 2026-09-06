"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errors } from "@/lib/intake/copy";
import type {
  CaptureCard,
  Collecting,
  Completeness,
  Progress,
  TranscriptItem,
  TranscriptResponse,
} from "@/lib/intake/transcriptTypes";

/**
 * Alles wat het chatscherm doet, los van hoe het eruitziet.
 *
 * De transcriptie is een afgeleide van de databank (zie lib/intake/transcript.ts)
 * en wordt hier alleen aangevuld met wat er lokaal net gebeurd is. Bij twijfel
 * wint de server: elke actie eindigt met opnieuw ophalen, zodat het scherm nooit
 * een eigen waarheid opbouwt die naast het dossier gaat staan.
 */

interface ChatTurnResponse {
  reply: string;
  captured: CaptureCard[];
  collecting: Collecting | null;
  progress: Progress;
  done: boolean;
  completeness: Completeness;
  openGaps: number;
}

const EMPTY_PROGRESS: Progress = {
  sectionsDone: 0,
  sectionsTotal: 7,
  requiredFilled: 0,
  requiredTotal: 0,
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? errors.generic);
  return payload as T;
}

export function useIntakeChat() {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [collecting, setCollecting] = useState<Collecting | null>(null);
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS);
  const [completeness, setCompleteness] = useState<Completeness | null>(null);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Voorkomt dat een achtergrondherstel over een lopende beurt heen valt. */
  const inFlight = useRef(false);

  /** De assistent opent hoogstens een keer, ook onder StrictMode. */
  const opened = useRef(false);

  /**
   * runTurn wordt pas verderop gedefinieerd en verandert van identiteit. Het
   * mount-effect mag daar niet van afhangen, anders draait het opnieuw en opent
   * de assistent een tweede keer. Vandaar een ref in plaats van een dependency.
   */
  const runTurnRef = useRef<(body: { message?: string; nudge?: string }) => Promise<void>>(
    async () => {},
  );

  /** Zet de opgehaalde stand op het scherm. Los van het ophalen zelf. */
  const apply = useCallback((data: TranscriptResponse) => {
    setItems(data.transcript);
    setCollecting(data.collecting);
    setProgress(data.progress);
    setCompleteness(data.completeness);
    setError(null);
    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await call<TranscriptResponse>("/api/intake/transcript"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : errors.generic);
      setLoading(false);
    }
  }, [apply]);

  /**
   * Ophalen bij mount, en alleen daarna beslissen of de assistent moet openen.
   *
   * Die beslissing hoort hier en niet in het scherm. Ergens anders kijken of
   * `items` leeg is, is een race: op de eerste renders is de lijst nog leeg
   * omdat het antwoord onderweg is, niet omdat er geen gesprek is. Dat kostte
   * een modelcall per keer laden en zou een tweede openingsvraag onder een
   * bestaand gesprek plakken. Het antwoord van de server weet het wel zeker.
   *
   * De ignore-vlag hoort bij het patroon uit de React-documentatie: het
   * resultaat landt in een callback, niet in de body van het effect.
   */
  useEffect(() => {
    let ignore = false;

    call<TranscriptResponse>("/api/intake/transcript")
      .then((data) => {
        if (ignore) return;
        apply(data);
        if (data.transcript.length === 0 && !opened.current) {
          opened.current = true;
          void runTurnRef.current({});
        }
      })
      .catch((caught: unknown) => {
        if (ignore) return;
        setError(caught instanceof Error ? caught.message : errors.generic);
        setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [apply]);

  /**
   * Terugkomen op het tabblad haalt de transcriptie opnieuw op.
   *
   * Dit is de herstelroute voor een documentverwerking die tot vijf minuten kan
   * lopen: klapt de tab dicht of valt de verbinding weg terwijl de server
   * doorwerkt, dan is het resultaat niet verloren, het staat alleen nog niet op
   * het scherm. Opnieuw ophalen is genoeg, juist omdat de transcriptie nergens
   * anders leeft dan in de databank.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && !inFlight.current) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const runTurn = useCallback(
    async (body: { message?: string; nudge?: string }) => {
      inFlight.current = true;
      setBusy(true);
      setError(null);

      // Het eigen antwoord meteen tonen. De server slaat het op voordat het
      // model erbij komt, dus dit loopt niet vooruit op iets dat kan mislukken.
      if (body.message) {
        setItems((current) => [
          ...current,
          {
            kind: "athlete",
            id: `local-${Date.now()}`,
            at: new Date().toISOString(),
            text: body.message as string,
          },
        ]);
      }

      try {
        const turn = await call<ChatTurnResponse>("/api/intake/chat", body);

        setItems((current) => [
          ...current,
          ...turn.captured.map((card, index) => ({
            kind: "capture" as const,
            id: `local-cap-${Date.now()}-${index}`,
            at: new Date().toISOString(),
            card,
          })),
          {
            kind: "assistant" as const,
            id: `local-reply-${Date.now()}`,
            at: new Date().toISOString(),
            text: turn.reply,
          },
        ]);

        setCollecting(turn.collecting);
        setProgress(turn.progress);
        setCompleteness(turn.completeness);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : errors.generic);
        // De beurt is mislukt, dus het scherm mag niet raden wat er wel is
        // opgeslagen. De server weet het; opnieuw ophalen dus.
        await load();
      } finally {
        setBusy(false);
        inFlight.current = false;
      }
    },
    [load],
  );

  useEffect(() => {
    runTurnRef.current = runTurn;
  }, [runTurn]);

  const send = useCallback(() => {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft("");
    void runTurn({ message });
  }, [draft, busy, runTurn]);

  return {
    items,
    collecting,
    progress,
    completeness,
    draft,
    setDraft,
    busy,
    loading,
    error,
    send,
    reload: load,
  };
}
