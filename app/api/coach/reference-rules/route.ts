import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handleError } from "@/lib/http";
import { requireCoach } from "@/lib/review/access";
import { BAND } from "@/lib/screening/bands";
import { addVersion, checkVersion, getRule, setClassification } from "@/lib/db/referenceRules";

export const maxDuration = 60;

/**
 * Referentieregels beheren. FR-02.
 *
 * Twee handelingen onder een route, omdat ze over hetzelfde ding gaan en de
 * client er een formulier voor heeft.
 *
 * Wie dit mag: elke behandelaar, niet alleen een beheerder. Het teamscherm is
 * wel beheerder-only, maar dat gaat over wie toegang heeft tot dossiers; dit
 * gaat over klinische afspraken, en de fysiotherapeut die het protocol van de
 * 90-90 bevestigt is zelden de beheerder. Elke wijziging staat in het
 * audit-log en de oude versie blijft bestaan.
 */

const toggle = z.object({
  action: z.literal("classification"),
  ruleId: z.number().int().positive(),
  enabled: z.boolean(),
});

const version = z.object({
  action: z.literal("version"),
  metricKey: z.string().min(1),
  bands: z.array(BAND).min(1).max(8),
  coverage: z.enum(["total", "gapped"]),
  classificationEnabled: z.boolean(),
  evidence: z.enum(["source_sheet", "published", "internal"]),
  sourceCitation: z.string().max(500).nullable(),
  sourceNote: z.string().max(2000).nullable(),
});

const bodySchema = z.discriminatedUnion("action", [toggle, version]);

export async function POST(request: Request) {
  try {
    const coach = await requireCoach();
    const actor = { id: coach.id, isAdmin: coach.role === "admin" };

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest("Expected a rule change.");
    const body = parsed.data;

    if (body.action === "classification") {
      await setClassification(body.ruleId, body.enabled, actor);
      return NextResponse.json({ ok: true });
    }

    const rule = await getRule(body.metricKey);
    if (!rule && body.metricKey.length === 0) return badRequest("Unknown metric.");

    // Dezelfde controle die de seed bewaakt: oplopende banden, geen overlap,
    // en wie 'total' zegt mag geen gat laten. De databank houdt daarnaast nog
    // twee sloten vast, maar daar komt een onleesbare constraintnaam uit.
    const problems = checkVersion(body);
    if (problems.length > 0) return badRequest(problems.join("; "));

    const id = await addVersion(body, actor);
    return NextResponse.json({ ok: true, id });
  } catch (caught) {
    return handleError(caught);
  }
}
