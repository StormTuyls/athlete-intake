"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { toLocale } from "@/lib/i18n/locale";
import { dayKey, dividerLabel } from "@/lib/intake/format";
import { DateDivider } from "@/components/intake/DateDivider";
import { MessageBubble } from "@/components/intake/MessageBubble";
import { CaptureCardView } from "@/components/intake/CaptureCard";
import { ExtractionCard } from "@/components/intake/ExtractionCard";
import { FileBubble } from "@/components/intake/FileBubble";
import { TypingIndicator } from "@/components/intake/TypingIndicator";
import type { TranscriptItem } from "@/lib/intake/transcriptTypes";

/**
 * De berichtenlijst.
 *
 * role="log" met aria-live="polite" zodat een schermlezer nieuwe berichten
 * meekrijgt zonder de gebruiker te onderbreken; "assertive" zou elk antwoord
 * over de lopende voorleesbeurt heen duwen.
 */
export function Transcript({
  items,
  busy,
  intro,
  onConfirm,
  onEdit,
  onRead,
}: {
  items: TranscriptItem[];
  busy: boolean;
  /**
   * Staat boven het eerste bericht en scrollt gewoon mee weg. Meegegeven en
   * niet hier geimporteerd: de lijst rendert wat er in de transcriptie zit, en
   * de uitleg zit daar juist niet in.
   */
  intro?: ReactNode;
  onConfirm?: (fieldKey: string) => Promise<void>;
  onEdit?: (fieldKey: string, value: string) => Promise<void>;
  /** Een binnengehaald document alsnog laten lezen. */
  onRead?: (documentId: string) => void;
}) {
  const locale = toLocale(useLocale());
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Alleen meescrollen als de gebruiker al onderaan zat. Wie omhoog gescrold is
  // om iets terug te lezen, wordt anders bij elk nieuw bericht weggeduwd.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distance < 160) {
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [items, busy]);

  // De metaregel van een bestandsbubbel toont hoeveel citaten geverifieerd zijn.
  // Dat cijfer hoort bij het document, maar ontstaat pas bij de extractie, dus
  // het wordt hier weer bij elkaar gezocht.
  const extractionByDocument = new Map(
    items.flatMap((item) =>
      item.kind === "extraction" ? [[item.documentId, item] as const] : [],
    ),
  );

  // De datumscheiding wordt vooraf berekend en niet tijdens het renderen met een
  // meelopende variabele. Een waarde die in een map-callback wordt bijgewerkt
  // leunt op de volgorde waarin React rendert, en dat is geen afspraak waar je
  // op mag bouwen.
  const rows = items.map((item, index) => ({
    item,
    showDivider: index === 0 || dayKey(item.at) !== dayKey(items[index - 1].at),
  }));

  return (
    <div
      ref={scroller}
      role="log"
      aria-live="polite"
      className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
    >
      {intro}

      {rows.map(({ item, showDivider }) => {
        return (
          <div key={item.id} className="flex flex-col gap-3">
            {showDivider && <DateDivider label={dividerLabel(item.at, locale)} />}

            {item.kind === "assistant" && (
              <MessageBubble role="assistant">{item.text}</MessageBubble>
            )}

            {item.kind === "athlete" && (
              <MessageBubble role="athlete">{item.text}</MessageBubble>
            )}

            {item.kind === "capture" && (
              <CaptureCardView
                card={item.card}
                onConfirm={onConfirm}
                onEdit={onEdit}
              />
            )}

            {item.kind === "document" && (
              <FileBubble
                filename={item.filename}
                mimeType={item.mimeType}
                byteSize={item.byteSize}
                documentKind={item.documentKind}
                state={item.state}
                error={item.error}
                fieldsProposed={
                  item.documentId
                    ? extractionByDocument.get(item.documentId)?.fieldsProposed
                    : undefined
                }
                quotesVerified={
                  item.documentId
                    ? extractionByDocument.get(item.documentId)?.quotesVerified
                    : undefined
                }
                onRead={
                  // Geen id betekent dat de upload nog loopt en de server het
                  // bestand nog niet kent. Dan is er niets om te lezen.
                  item.documentId && onRead
                    ? () => onRead(item.documentId as string)
                    : undefined
                }
              />
            )}

            {item.kind === "extraction" && (
              <ExtractionCard
                filename={item.filename}
                cards={item.cards}
                fieldsProposed={item.fieldsProposed}
                onConfirm={onConfirm}
                onEdit={onEdit}
              />
            )}
          </div>
        );
      })}

      {busy && <TypingIndicator />}
      <div ref={bottom} />
    </div>
  );
}
