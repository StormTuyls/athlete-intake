"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useTranslations } from "next-intl";
import type {
  CaptureCard,
  Collecting,
  Completeness,
  DocumentKind,
  Progress,
  TranscriptItem,
  TranscriptResponse,
} from "@/lib/intake/transcriptTypes";
import type { IntakeTitle } from "@/lib/intake/title";

/**
 * Alles wat het chatscherm doet, los van hoe het eruitziet.
 *
 * De transcriptie is een afgeleide van de databank (zie lib/intake/transcript.ts)
 * en wordt hier alleen aangevuld met wat er lokaal net gebeurd is. Bij twijfel
 * wint de server: elke actie eindigt met opnieuw ophalen, zodat het scherm nooit
 * een eigen waarheid opbouwt die naast het dossier gaat staan.
 */

interface FieldActionResponse {
  card: CaptureCard;
  collecting: Collecting | null;
  progress: Progress;
  completeness: Completeness;
}

interface ChatTurnResponse {
  reply: string;
  title: IntakeTitle;
  captured: CaptureCard[];
  collecting: Collecting | null;
  progress: Progress;
  done: boolean;
  completeness: Completeness;
  openGaps: number;
}

/** Wat POST /api/intake/documents teruggeeft. */
interface UploadResult {
  documentId: string;
  kind: DocumentKind;
  pageCount: number;
  fieldsProposed: number;
  quotesVerified: number;
  injuriesFound: number;
  duplicate: boolean;
  cards: CaptureCard[];
  collecting: Collecting | null;
  progress: Progress;
  completeness: Completeness;
}

/**
 * De stand voordat de server hem heeft gestuurd.
 *
 * Alles op nul, en niet een geraden noemer. Hier stond 7, het aantal secties in
 * de taxonomie, en dat was twee keer fout: de ring telt maar vijf secties, en
 * een verkeerde noemer flitst zichtbaar voorbij op de eerste render.
 */
const EMPTY_PROGRESS: Progress = {
  sectionsDone: 0,
  sectionsTotal: 0,
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
  // Geen standaardmelding hier: dit is een hulpfunctie op moduleniveau en die
  // kan geen hook gebruiken. De aanroepplekken vullen de terugvaltekst in, en
  // die zitten in het component waar de taal wel bekend is.
  if (!response.ok) throw new Error(payload.error ?? "");
  return payload as T;
}

export function useIntakeChat() {
  // Een hook en geen component, dus de teksten komen hier binnen via
  // useTranslations en niet als argument: dat houdt de aanroepplek in
  // ChatScreen leeg en er is maar één plek waar deze meldingen vandaan komen.
  const t = useTranslations("intake");
  const tError = useTranslations("errors");
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [collecting, setCollecting] = useState<Collecting | null>(null);
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS);
  const [completeness, setCompleteness] = useState<Completeness | null>(null);
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [title, setTitle] = useState<IntakeTitle>({ kind: "none" });

  const [draft, setDraft] = useState("");
  /** Korte terugkoppeling op een actie die geen bericht oplevert. */
  const [notice, setNotice] = useState<string | null>(null);
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
    setIntakeId(data.intakeId);
    setTitle(data.title);
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
      setError(caught instanceof Error && caught.message ? caught.message : tError("generic"));
      setLoading(false);
    }
  }, [apply, tError]);

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
        setError(caught instanceof Error && caught.message ? caught.message : tError("generic"));
        setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [apply, tError]);

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

        setTitle(turn.title);
        setCollecting(turn.collecting);
        setProgress(turn.progress);
        setCompleteness(turn.completeness);
      } catch (caught) {
        const message = caught instanceof Error && caught.message ? caught.message : tError("generic");

        // De beurt is mislukt, dus het scherm mag niet raden wat er wel is
        // opgeslagen. De server weet het; opnieuw ophalen dus.
        await load();

        // Pas hierna de melding zetten. `load` wist de foutmelding, want een
        // geslaagde ophaalactie hoort een oude fout op te ruimen. Zette we hem
        // ervoor, dan verdween precies de uitleg waarom de beurt niet lukte en
        // keek de atleet naar een leeg gesprek zonder reden.
        setError(message);
      } finally {
        setBusy(false);
        inFlight.current = false;
      }
    },
    [load, tError],
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

  /**
   * Een modelvoorstel bevestigen of corrigeren.
   *
   * De server beslist wat er precies wordt weggeschreven; hier gaat alleen de
   * veldsleutel heen, en bij een correctie de nieuwe waarde. De kaart wordt
   * daarna vervangen door wat de server teruggeeft, niet door wat wij denken dat
   * het geworden is: de merge-regel bepaalt de uitkomst, en die kent de client
   * niet.
   *
   * Gooit door bij een fout, zodat de kaart zelf de melding kan tonen naast het
   * veld waar het over gaat, in plaats van bovenaan het scherm.
   */
  const resolveField = useCallback(
    async (fieldKey: string, value?: string) => {
      inFlight.current = true;
      try {
        const result = await call<FieldActionResponse>("/api/intake/fields/confirm", {
          fieldKey,
          ...(value === undefined ? {} : { value }),
        });

        setItems((current) =>
          current.map((item) =>
            item.kind === "capture" && item.card.fieldKey === fieldKey
              ? { ...item, card: result.card }
              : item.kind === "extraction"
                ? {
                    ...item,
                    cards: item.cards.map((card) =>
                      card.fieldKey === fieldKey ? result.card : card,
                    ),
                  }
                : item,
          ),
        );

        setCollecting(result.collecting);
        setProgress(result.progress);
        setCompleteness(result.completeness);
      } finally {
        inFlight.current = false;
      }
    },
    [],
  );

  const confirmField = useCallback(
    (fieldKey: string) => resolveField(fieldKey),
    [resolveField],
  );

  const editField = useCallback(
    (fieldKey: string, value: string) => resolveField(fieldKey, value),
    [resolveField],
  );

  /**
   * Bestanden toevoegen vanuit het gesprek.
   *
   * De bubbel komt er meteen bij, voordat er iets geupload is. Dat is geen
   * optimisme over de uitkomst maar over de volgorde: het bestand gaat eerst
   * naar de opslag en pas daarna door het model, dus zelfs een mislukte
   * verwerking laat het origineel staan. De bubbel blijft dan ook staan, met de
   * melding erbij, in plaats van te verdwijnen alsof er niets gebeurd is.
   *
   * Sequentieel per bestand. De modelcall is de bottleneck, en drie functies van
   * vijf minuten naast elkaar maakt het geheel niet sneller maar wel fragieler.
   */
  const uploadFiles = useCallback(
    async (files: FileList) => {
      inFlight.current = true;
      setError(null);
      setNotice(null);

      for (const file of Array.from(files)) {
        const localId = `local-doc-${Date.now()}-${file.name}`;

        const patch = (changes: Partial<Extract<TranscriptItem, { kind: "document" }>>) =>
          setItems((current) =>
            current.map((item) =>
              item.id === localId && item.kind === "document"
                ? { ...item, ...changes }
                : item,
            ),
          );

        setItems((current) => [
          ...current,
          {
            kind: "document",
            id: localId,
            at: new Date().toISOString(),
            documentId: null,
            filename: file.name,
            mimeType: file.type || "text/plain",
            byteSize: file.size,
            documentKind: null,
            pageCount: null,
            state: "uploading",
            error: null,
          },
        ]);

        try {
          const signed = await call<{ path: string; token: string; bucket: string }>(
            "/api/intake/documents/upload-url",
            {
              filename: file.name,
              mimeType: file.type || "text/plain",
              byteSize: file.size,
            },
          );

          const supabase = createClient();
          const upload = await supabase.storage
            .from(signed.bucket)
            .uploadToSignedUrl(signed.path, signed.token, file);
          if (upload.error) throw new Error(upload.error.message);

          // Bytes staan er. Vanaf hier kan alleen het lezen nog mislukken.
          patch({ state: "processing" });

          const result = await call<UploadResult>("/api/intake/documents", {
            path: signed.path,
            filename: file.name,
            mimeType: file.type || "text/plain",
          });

          // Al eerder aangeleverd. Dan hoort er geen tweede bestandsbubbel en
          // geen tweede extractiekaart bij: het document staat er al een keer.
          // De optimistische bubbel gaat er weer af en de server bepaalt wat er
          // staat. Wel iets zeggen, want anders lijkt het alsof de upload niets
          // deed en probeert iemand het nog een keer.
          if (result.duplicate) {
            setItems((current) => current.filter((item) => item.id !== localId));
            await load();
            setNotice(t("duplicateDocument", { filename: file.name }));
            continue;
          }

          patch({
            state: "read",
            documentId: result.documentId,
            documentKind: result.kind,
            pageCount: result.pageCount,
          });

          setItems((current) => [
            ...current,
            {
              kind: "extraction",
              id: `local-ext-${result.documentId}-${Date.now()}`,
              at: new Date().toISOString(),
              documentId: result.documentId,
              filename: file.name,
              cards: result.cards,
              fieldsProposed: result.fieldsProposed,
              quotesVerified: result.quotesVerified,
            },
          ]);

          setCollecting(result.collecting);
          setProgress(result.progress);
          setCompleteness(result.completeness);

          inFlight.current = false;
          await runTurn({ nudge: "document_uploaded" });
          inFlight.current = true;
        } catch (caught) {
          patch({
            state: "failed",
            error: caught instanceof Error && caught.message ? caught.message : tError("generic"),
          });
        }
      }

      inFlight.current = false;
    },
    [runTurn, load, t, tError],
  );

  return {
    items,
    intakeId,
    title,
    collecting,
    progress,
    completeness,
    draft,
    setDraft,
    busy,
    loading,
    error,
    send,
    uploadFiles,
    confirmField,
    editField,
    notice,
    reload: load,
  };
}
