import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handleError } from "@/lib/http";
import { apiMessages } from "@/lib/i18n/server";
import { isUuid, requireCoach } from "@/lib/review/access";
import { createSession, getHistory, getLibrary, toSpecs } from "@/lib/db/screening";
import { evaluate } from "@/lib/screening/evaluate";

export const maxDuration = 60;

const bodySchema = z.object({
  athleteId: z.string().uuid(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bodyMassKg: z.number().positive().nullable(),
  notes: z.string().max(2000).nullable(),
  entries: z
    .array(
      z.object({
        metricKey: z.string().min(1),
        side: z.enum(["left", "right", "bilateral", "unknown"]),
        // null betekent: hoorde bij deze sessie, niet gemeten. Spec §12.1. Een
        // leeg veld in het formulier wordt dus null en niet 0.
        value: z.number().finite().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * Een screening opslaan.
 *
 * De server bepaalt de protocolversie, niet de client. Het formulier stuurt
 * alleen metriek, zijde en waarde; welke protocolversie daarbij hoort komt uit
 * de bibliotheek op dit moment. Zou de client dat meesturen, dan kan een oud
 * tabblad een meting onder een uitgefaseerd protocol wegschrijven, en spec §4 is
 * daar juist onvoorwaardelijk over.
 *
 * Doorrekenen gebeurt hier en niet bij het lezen: medical.derived_results draagt
 * de formule- en regelversie, zodat een rapport dat volgend jaar opnieuw
 * geprint wordt dezelfde getallen toont.
 */
export async function POST(request: Request) {
  try {
    const t = await apiMessages();
    const coach = await requireCoach();

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest("Expected a screening session.");
    const input = parsed.data;

    if (!isUuid(input.athleteId)) {
      return NextResponse.json({ error: t("athleteNotFound") }, { status: 404 });
    }

    const library = await getLibrary();
    const byMetric = new Map(library.map((item) => [item.metricKey, item]));

    // Een metriek die niet in de bibliotheek staat is geen 400 van de gebruiker
    // maar een formulier dat niet meer klopt met de taxonomie. Weigeren, niet
    // overslaan: stil minder opslaan dan de tester invulde is de ergste uitkomst.
    const unknown = input.entries.filter((e) => !byMetric.has(e.metricKey));
    if (unknown.length > 0) {
      return badRequest(`Unknown metric: ${unknown[0].metricKey}`);
    }

    // Alles leeg is geen screening. Anders levert een per ongeluk ingediend
    // formulier een lege sessie op die wel in de tijdlijn staat.
    if (input.entries.every((e) => e.value === null)) {
      return badRequest("Enter at least one measurement.");
    }

    // De protocolversie hoort bij de meting: de rekenmotor vergelijkt alleen
    // binnen dezelfde versie, en zonder dit zou laag 1 een lijn trekken dwars
    // door een protocolwissel heen.
    const entries = input.entries.map((e) => ({
      ...e,
      protocolId: byMetric.get(e.metricKey)!.protocolId,
    }));

    const history = await getHistory(
      input.athleteId,
      entries.map((e) => e.metricKey),
    );

    // occurredAt is de gemeten datum, recordedAt het invoermoment. Dat tweede
    // breekt gelijke stand als er twee screenings op dezelfde dag staan.
    const recordedAt = new Date().toISOString();
    const results = evaluate(
      entries,
      toSpecs(library),
      history,
      `${input.occurredOn}T00:00:00.000Z`,
      recordedAt,
    );

    const sessionId = await createSession(
      {
        athleteId: input.athleteId,
        occurredOn: input.occurredOn,
        testerProfileId: coach.id,
        bodyMassKg: input.bodyMassKg,
        notes: input.notes,
        entries,
      },
      results,
      { id: coach.id },
    );

    return NextResponse.json({ ok: true, sessionId });
  } catch (caught) {
    return handleError(caught);
  }
}
