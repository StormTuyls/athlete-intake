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
 * De bewaartermijn wordt hier pas definitief, want die is onderdeel van waar de
 * atleet mee instemt. Tot dit moment stond er een korte einddatum op, zodat een
 * afgebroken intake opruimt in plaats van te blijven liggen.
 *
 * Standaard onbeperkt, want de praktijk wil dossiers houden. Dat mag, maar niet
 * stilzwijgend: de databank eist een benoemde grond. Zet RETENTION_MODE op
 * until_date met RETENTION_MONTHS als er wel een einddatum moet komen.
 */

export const CONSENT_VERSION = "2026-09-02";

const DEFAULT_BASIS =
  "Zorgdossier van een begeleide atleet. Bewaard met expliciete toestemming; " +
  "de atleet kan op elk moment verwijdering vragen.";

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

    const indefinite = (process.env.RETENTION_MODE ?? "indefinite") === "indefinite";
    let retentionUntil: string | null = null;
    if (!indefinite) {
      const until = new Date(now);
      until.setMonth(until.getMonth() + Number(process.env.RETENTION_MONTHS ?? 60));
      retentionUntil = until.toISOString().slice(0, 10);
    }

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
        retention_mode: indefinite ? "indefinite" : "until_date",
        retention_until: retentionUntil,
        retention_basis: indefinite
          ? (process.env.RETENTION_BASIS ?? DEFAULT_BASIS)
          : null,
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
      retentionMode: indefinite ? "indefinite" : "until_date",
      retentionUntil,
      completeness: state.completeness,
    });
  } catch (error) {
    return handleError(error);
  }
}
