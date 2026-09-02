import { NextResponse } from "next/server";
import { appDb } from "@/lib/supabase/service";
import { requireIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { syncDossier } from "@/lib/db/dossier";
import { addProposals } from "@/lib/db/dossier";

/**
 * Consent vastleggen.
 *
 * Versienummer van de tekst gaat mee: een consentregistratie zonder de versie
 * van wat iemand gezien heeft is waardeloos zodra de tekst wijzigt. IP en
 * user-agent gaan mee als bewijs van het moment.
 *
 * De bewaartermijn wordt hier pas gezet, want die is onderdeel van waar de
 * atleet mee instemt. De retentiejob leest athletes.retention_until.
 */

export const CONSENT_VERSION = "2026-09-02";

const REQUIRED = ["medical_processing", "retention_acknowledged"] as const;

export async function POST(request: Request) {
  try {
    const session = await requireIntake();

    const body = (await request.json()) as {
      purposes?: Record<string, boolean>;
      fullName?: string;
      email?: string;
    };

    const purposes = body.purposes ?? {};
    const missing = REQUIRED.filter((key) => purposes[key] !== true);
    if (missing.length > 0) {
      return badRequest(`verplichte toestemming ontbreekt: ${missing.join(", ")}`);
    }

    const db = appDb();
    const now = new Date();
    const months = Number(process.env.RETENTION_MONTHS ?? 60);
    const retentionUntil = new Date(now);
    retentionUntil.setMonth(retentionUntil.getMonth() + months);

    const { error: consentError } = await db.from("consents").insert({
      athlete_id: session.athleteId,
      intake_id: session.intakeId,
      consent_version: CONSENT_VERSION,
      purposes,
      ip:
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      user_agent: request.headers.get("user-agent"),
    });

    if (consentError) {
      throw new Error(`consent opslaan mislukt: ${consentError.message}`);
    }

    const { error: intakeError } = await db
      .from("intakes")
      .update({ consent_granted_at: now.toISOString() })
      .eq("id", session.intakeId);

    if (intakeError) {
      throw new Error(`intake bijwerken mislukt: ${intakeError.message}`);
    }

    await db
      .from("athletes")
      .update({
        retention_until: retentionUntil.toISOString().slice(0, 10),
        full_name: body.fullName?.trim() || null,
        email: body.email?.trim() || null,
      })
      .eq("id", session.athleteId);

    // De consentvinkjes en de naam zijn ook dossiervelden, zodat het
    // reviewscherm en het rapport ze in één lijst kunnen tonen.
    await addProposals(session.intakeId, [
      ...Object.entries(purposes).map(([key, value]) => ({
        fieldKey: `consent.${key}`,
        value,
        proposedBy: "athlete" as const,
      })),
      ...(body.fullName?.trim()
        ? [
            {
              fieldKey: "identity.full_name",
              value: body.fullName.trim(),
              proposedBy: "athlete" as const,
            },
          ]
        : []),
      ...(body.email?.trim()
        ? [
            {
              fieldKey: "identity.email",
              value: body.email.trim(),
              proposedBy: "athlete" as const,
            },
          ]
        : []),
    ]);

    const state = await syncDossier(session.intakeId, session.locale);

    return NextResponse.json({
      consentVersion: CONSENT_VERSION,
      retentionUntil: retentionUntil.toISOString().slice(0, 10),
      completeness: state.completeness,
    });
  } catch (error) {
    return handleError(error);
  }
}
