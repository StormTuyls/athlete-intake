import { MessageBubble } from "@/components/intake/MessageBubble";
import { CaptureCardView } from "@/components/intake/CaptureCard";
import type { CaptureCard } from "@/lib/intake/transcriptTypes";

/**
 * Wat er uit een document kwam.
 *
 * De zin is een sjabloon, geen modeltekst. Een samenvatting laten schrijven zou
 * een extra modelcall kosten, een kolom op chat_messages vragen om hem te
 * bewaren, en kan iets beweren wat niet uit het document komt. Een sjabloon met
 * de echte aantallen erin rendert live en na een reload hetzelfde, en kan per
 * constructie niet hallucineren.
 */
export function ExtractionCard({
  filename,
  cards,
  fieldsProposed,
  onConfirm,
  onEdit,
}: {
  filename: string;
  cards: CaptureCard[];
  fieldsProposed: number;
  onConfirm?: (fieldKey: string) => Promise<void>;
  onEdit?: (fieldKey: string, value: string) => Promise<void>;
}) {
  const sentence =
    fieldsProposed === 0
      ? `I read ${filename}, but I could not find any details to add. You can tell me instead.`
      : `I read ${filename} and found ${fieldsProposed} ${
          fieldsProposed === 1 ? "detail" : "details"
        }. Please check ${fieldsProposed === 1 ? "it" : "them"}.`;

  return (
    <div className="flex flex-col gap-2">
      <MessageBubble role="assistant">{sentence}</MessageBubble>
      {cards.map((card) => (
        <CaptureCardView
          key={card.fieldKey}
          card={card}
          onConfirm={onConfirm}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
