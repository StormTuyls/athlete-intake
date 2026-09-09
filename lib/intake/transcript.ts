import { appDb } from "@/lib/supabase/service";
import { listDocuments } from "@/lib/db/medical";
import { getProposals, syncDossier } from "@/lib/db/dossier";
import { intakeTitle } from "@/lib/db/intakeTitle";
import { formatValue } from "@/lib/intake/format";
import { sectionLabel } from "@/lib/intake/sections";
import { documentError } from "@/lib/intake/format";
import type {
  CaptureCard,
  Collecting,
  Progress,
  TranscriptItem,
  TranscriptResponse,
} from "@/lib/intake/transcriptTypes";
import type { FieldDefinition, Proposal, ResolvedField } from "@/lib/types";

/**
 * Bouwt de hele transcriptie opnieuw op uit wat er al in de databank staat.
 *
 * Er is geen tabel met chatitems, en die komt er ook niet. Alle vijf de soorten
 * zijn af te leiden uit wat er al is:
 *
 *   bubbels          public.chat_messages
 *   capture-kaarten  athlete-voorstellen met een citaat
 *   bestandsbubbels  medical.documents
 *   extractiekaarten modelvoorstellen, gegroepeerd per document
 *
 * Dat scheelt een migratie, maar belangrijker: het maakt de transcriptie een
 * afgeleide van de feiten in plaats van een tweede administratie die uit de pas
 * kan lopen. Een reload toont daardoor per definitie hetzelfde als de databank.
 *
 * Dit is meteen de herstelroute. De documentverwerking loopt tot vijf minuten;
 * klapt de tab dicht terwijl de server doorwerkt, dan is het resultaat niet weg,
 * het staat er alleen nog niet. Opnieuw ophalen haalt het op.
 */

/**
 * Welke athlete-voorstellen een eigen kaart in het gesprek krijgen.
 *
 * Er zijn drie soorten, en alleen de eerste hoort hier:
 *
 *   chatantwoord  citaat (de eigen woorden), geen brondocument
 *   Confirm       citaat EN brondocument, overgenomen van het modelvoorstel
 *   consent       geen van beide
 *
 * Alleen op het citaat filteren was fout zodra Confirm bestond: die kopieert de
 * herkomst van het modelvoorstel, dus ook het citaat, en dan is een bevestiging
 * niet van een chatantwoord te onderscheiden. Het veld verscheen daardoor twee
 * keer, een keer in de extractiekaart van het document en een keer als losse
 * kaart. Zichtbaar geworden bij het teruglezen na een reload.
 *
 * Het brondocument is de sluitende scheidslijn: wat de atleet typt komt uit geen
 * enkel document, wat hij bevestigt komt er altijd uit een.
 */
function isChatCapture(proposal: Proposal): boolean {
  return (
    proposal.proposedBy === "athlete" &&
    Boolean(proposal.sourceQuote) &&
    proposal.sourceDocumentId === null
  );
}

/**
 * Komt het winnende voorstel van het model? Dan mag de atleet het bevestigen.
 *
 * Dit is de hele "moet dit nog bevestigd worden"-vraag, en hij is afleidbaar:
 * na een Confirm of een Edit is de atleet de winnaar en verdwijnen de knoppen,
 * ook na een reload. Daarom staat er geen kolom voor in de databank.
 */
export function winnerIsModel(
  resolved: ResolvedField | undefined,
  proposalById: Map<number, Proposal>,
): boolean {
  const winningId = resolved?.winningProposalId;
  if (winningId === null || winningId === undefined) return false;
  return proposalById.get(winningId)?.proposedBy === "model";
}

export function buildCard(
  definition: FieldDefinition,
  resolved: ResolvedField | undefined,
  winnerIsModel: boolean,
  locale: "nl" | "en",
): CaptureCard {
  return {
    fieldKey: definition.key,
    label: locale === "nl" ? definition.labelNl : definition.labelEn,
    section: definition.section,
    sectionLabel: sectionLabel(definition.section, locale),
    // De huidige waarde, niet de waarde van het voorstel. Een kaart die een
    // achterhaalde waarde toont terwijl het dossier iets anders zegt is erger
    // dan een kaart die meebeweegt.
    value: formatValue(definition, resolved?.value ?? null),
    status: resolved?.status ?? "missing",
    confidence: resolved?.confidence ?? "medium",
    proposedBy: resolved?.proposedBy ?? null,
    needsConfirmation: winnerIsModel,
    dataType: definition.dataType,
    enumOptions: definition.enumOptions,
  };
}

/**
 * De kaarten die uit één document kwamen.
 *
 * Per veld het laatste voorstel: het model kan hetzelfde veld twee keer
 * voorstellen binnen één document, en dan is de laatste de bedoelde.
 *
 * Zowel de transcriptie als de uploadroute gebruikt dit. Twee bouwers zouden
 * betekenen dat een kaart net na het uploaden iets anders kan zeggen dan
 * dezelfde kaart na een reload.
 */
export function cardsForDocument(
  documentId: string,
  proposals: Proposal[],
  definitions: Map<string, FieldDefinition>,
  resolved: Map<string, ResolvedField>,
  proposalById: Map<number, Proposal>,
  locale: "nl" | "en",
): { cards: CaptureCard[]; fieldsProposed: number; quotesVerified: number } {
  const fromDocument = proposals.filter(
    (proposal) =>
      proposal.proposedBy === "model" && proposal.sourceDocumentId === documentId,
  );

  const latestPerField = new Map<string, Proposal>();
  for (const proposal of fromDocument) latestPerField.set(proposal.fieldKey, proposal);

  const cards: CaptureCard[] = [];
  for (const proposal of latestPerField.values()) {
    const definition = definitions.get(proposal.fieldKey);
    if (!definition) continue;
    const field = resolved.get(proposal.fieldKey);
    cards.push(buildCard(definition, field, winnerIsModel(field, proposalById), locale));
  }

  return {
    cards,
    fieldsProposed: latestPerField.size,
    quotesVerified: fromDocument.filter((proposal) => proposal.quoteVerified).length,
  };
}

interface ChatMessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

/**
 * De rol intake_server heeft geen select op public.chat_messages (zie de grants
 * in 20260902110000_grants.sql), dus dit kan geen join zijn met de medische
 * tabellen. Berichten via PostgREST, medische data via de directe verbinding, en
 * samenvoegen in TypeScript. Een grant erbij zou de scheiding verzwakken voor
 * een gemak dat we niet nodig hebben.
 */
async function readMessages(intakeId: string): Promise<ChatMessageRow[]> {
  const { data, error } = await appDb()
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("intake_id", intakeId)
    .order("id");

  if (error) throw new Error(`chatberichten lezen mislukt: ${error.message}`);
  return (data ?? []) as ChatMessageRow[];
}

/**
 * Voortgang in secties.
 *
 * Alleen secties die het gesprek ook echt kan afwerken tellen mee, en dat is
 * niet hetzelfde als "alle secties". Twee vielen er buiten en dat maakte de ring
 * onbruikbaar: hij stond op 2/7 voordat de atleet één woord had getypt.
 *
 *   consent  twee verplichte velden, maar die worden bij het aanmaken van de
 *            intake gevuld uit de accountconsent en de assistent mag er niet
 *            naar vragen. Altijd af, dus geen voortgang.
 *   uploads  vier velden, geen enkele verplicht. Kan per definitie niets
 *            blokkeren, dus was ook altijd af.
 *
 * De regel is nu: een sectie doet mee als er minstens één verplicht veld in zit
 * dat via het gesprek gevuld kan worden. Dat sluit consent en uploads uit zonder
 * ze bij naam te noemen, en het blijft kloppen als de taxonomie ooit wijzigt.
 *
 * Af blijft: geen verplicht gat en geen conflict. Dezelfde grens als
 * readyToSubmit, zodat de ring en de indienknop niet uit elkaar kunnen lopen.
 */
function inRingScope(definition: FieldDefinition): boolean {
  return definition.required && !definition.key.startsWith("consent.");
}

export function computeProgress(
  definitions: FieldDefinition[],
  gaps: Array<{ fieldKey: string; section: string; required: boolean; reason: string }>,
  requiredFilled: number,
  requiredTotal: number,
): Progress {
  const sections = [
    ...new Set(definitions.filter(inRingScope).map((d) => d.section)),
  ];

  const blocked = new Set(
    gaps
      .filter(
        (gap) =>
          !gap.fieldKey.startsWith("consent.") &&
          (gap.required || gap.reason === "conflicting"),
      )
      .map((gap) => gap.section),
  );

  return {
    sectionsDone: sections.filter((section) => !blocked.has(section)).length,
    sectionsTotal: sections.length,
    requiredFilled,
    requiredTotal,
  };
}

/**
 * De sectie waar de assistent nu naar vraagt.
 *
 * Uit het eerste openstaande gat, niet uit het laatste bericht. Na een upload
 * die een paar velden invult verspringt het onderwerp, en dan hoort de kop mee
 * te verspringen in plaats van te blijven staan op wat er net gevraagd werd.
 */
export function collectingFrom(
  gaps: Array<{ section: string }>,
  locale: "nl" | "en",
): Collecting | null {
  const first = gaps[0];
  return first
    ? { section: first.section, label: sectionLabel(first.section, locale) }
    : null;
}

const SOURCE_RANK = { message: 0, capture: 1, document: 2, extraction: 3 } as const;

interface Sortable {
  item: TranscriptItem;
  source: keyof typeof SOURCE_RANK;
  seq: number;
}

/**
 * Zet de items op volgorde, met een sluitende regel voor gelijke tijdstempels.
 *
 * Die komen echt voor: `now()` in Postgres is de starttijd van de transactie,
 * dus alle voorstellen uit één addProposals-aanroep dragen exact dezelfde tijd,
 * en een batch-insert van berichten ook. Zonder tweede sleutel hangt de volgorde
 * dan af van de stabiliteit van Array.sort, en daar hoort een gesprek niet op te
 * leunen.
 *
 * De sleutels, in volgorde: tijd, dan de bron, dan het volgnummer binnen die
 * bron. De bron eerst en niet het soort item, want chat_messages heeft met zijn
 * id al een sluitende eigen volgorde, en een vraag en het antwoord erop mogen
 * nooit omdraaien omdat de een van de assistent is en de ander van de atleet.
 */
function sortTranscript(entries: Sortable[]): TranscriptItem[] {
  return entries
    .sort((a, b) => {
      if (a.item.at !== b.item.at) return a.item.at < b.item.at ? -1 : 1;
      const rank = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
      return rank !== 0 ? rank : a.seq - b.seq;
    })
    .map((entry) => entry.item);
}

export async function buildTranscript(
  intakeId: string,
  locale: "nl" | "en",
  meta: { status: string; consentGrantedAt: string | null },
): Promise<TranscriptResponse> {
  const state = await syncDossier(intakeId, locale);

  const [messages, documents, proposals, title] = await Promise.all([
    readMessages(intakeId),
    listDocuments(intakeId),
    getProposals(intakeId),
    intakeTitle(intakeId),
  ]);

  const byKey = new Map(state.definitions.map((d) => [d.key, d]));
  const proposalById = new Map(proposals.map((p) => [p.id, p]));

  const needsConfirm = (fieldKey: string): boolean =>
    winnerIsModel(state.resolved.get(fieldKey), proposalById);

  const entries: Sortable[] = [];

  for (const message of messages) {
    entries.push({
      source: "message",
      seq: message.id,
      item: {
        kind: message.role === "user" ? "athlete" : "assistant",
        id: `msg-${message.id}`,
        at: new Date(message.created_at).toISOString(),
        text: message.content,
      },
    });
  }

  for (const proposal of proposals) {
    if (!isChatCapture(proposal)) continue;
    const definition = byKey.get(proposal.fieldKey);
    if (!definition) continue;

    entries.push({
      source: "capture",
      seq: proposal.id,
      item: {
        kind: "capture",
        id: `cap-${proposal.id}`,
        at: proposal.createdAt,
        card: buildCard(
          definition,
          state.resolved.get(proposal.fieldKey),
          needsConfirm(proposal.fieldKey),
          locale,
        ),
      },
    });
  }

  documents.forEach((document, index) => {
    entries.push({
      source: "document",
      seq: index,
      item: {
        kind: "document",
        id: `doc-${document.id}`,
        at: document.uploadedAt,
        documentId: document.id,
        filename: document.originalFilename,
        mimeType: document.mimeType,
        byteSize: document.byteSize,
        documentKind: document.kind,
        pageCount: document.pageCount,
        // Geen processed_at en geen fout betekent "wel binnen, nog niet
        // gelezen", en niet "bezig". Er draait niets: het wachten is op de
        // atleet. Zie lib/intake/processDocument.ts.
        state: document.processingError
          ? "failed"
          : document.processedAt
            ? "read"
            : "unread",
        error: documentError(document.processingError, locale),
      },
    });

    // Een ongelezen of gefaald document heeft geen resultaat om te tonen. Een
    // document dat gelezen is wel, ook als er niets in stond: dat laatste is
    // een antwoord, geen stilte.
    if (document.processingError || !document.processedAt) return;

    const extraction = cardsForDocument(
      document.id,
      proposals,
      byKey,
      state.resolved,
      proposalById,
      locale,
    );

    entries.push({
      source: "extraction",
      seq: index,
      item: {
        kind: "extraction",
        id: `ext-${document.id}`,
        at: document.processedAt,
        documentId: document.id,
        filename: document.originalFilename,
        cards: extraction.cards,
        fieldsProposed: extraction.fieldsProposed,
        quotesVerified: extraction.quotesVerified,
      },
    });
  });

  const items = sortTranscript(entries);

  return {
    intakeId,
    title,
    transcript: items,
    collecting: collectingFrom(state.gaps, locale),
    progress: computeProgress(
      state.definitions,
      state.gaps,
      state.completeness.requiredFilled,
      state.completeness.requiredTotal,
    ),
    completeness: state.completeness,
    status: meta.status,
    consentGrantedAt: meta.consentGrantedAt,
  };
}
