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

/**
 * Versie van de consent-tekst.
 *
 * Bumpen zodra de tekst wijzigt. Dat is niet administratie: wie versie
 * 2026-09-02 aanvinkte gaf geen toestemming voor een tekst die daarna is
 * uitgebreid met het delen van een samenvatting met behandelaars. De
 * registratie moet zeggen wat iemand werkelijk gezien heeft.
 */
export const CONSENT_VERSION = "2026-09-02b";

const DEFAULT_BASIS =
  "Zorgdossier van een begeleide atleet. Bewaard met expliciete toestemming; " +
  "de atleet kan op elk moment verwijdering vragen.";

const REQUIRED = ["medical_processing", "retention_acknowledged"] as const;

/**
 * Toegestane doelen, en welke daarvan ook een dossierveld zijn.
 *
 * `consents.purposes` is jsonb en is het juridische register: daar mag een doel
 * bij zonder migratie. De taxonomie in `field_definitions` is bevroren en heeft
 * maar drie `consent.*`-velden. Zonder deze scheiding wordt elk onbekend doel
 * een voorstel met een field_key die niet bestaat, en dat is een FK-schending
 * die als een kale 500 bij de atleet landt.
 *
 * Onbekende sleutels worden geweigerd in plaats van genegeerd: een doel dat de
 * client stuurt en de server stil laat vallen, staat straks in geen enkel
 * register terwijl de atleet denkt dat hij iets afgesproken heeft.
 */
const KNOWN_PURPOSES = [
  "medical_processing",
  "share_with_practitioners",
  "retention_acknowledged",
] as const;

const PURPOSES_WITH_FIELD: ReadonlySet<string> = new Set([
  "medical_processing",
  "share_with_practitioners",
  "retention_acknowledged",
]);

export async function POST(request: Request) {
  try {
    const session = await requireIntake();

    const body = (await request.json()) as {
      purposes?: Record<string, boolean>;
      fullName?: string;
      email?: string;
    };

    const purposes = body.purposes ?? {};

    const unknown = Object.keys(purposes).filter(
      (key) => !(KNOWN_PURPOSES as readonly string[]).includes(key),
    );
    if (unknown.length > 0) {
      return badRequest(`Unknown consent purpose: ${unknown.join(", ")}`);
    }

    const missing = REQUIRED.filter((key) => purposes[key] !== true);
    if (missing.length > 0) {
      return badRequest(`Required consent is missing: ${missing.join(", ")}`);
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
    // reviewscherm en het rapport ze in één lijst kunnen tonen. Alleen de doelen
    // die echt in de taxonomie staan: de rest leeft in `consents.purposes`.
    await addProposals(session.intakeId, [
      ...Object.entries(purposes)
        .filter(([key]) => PURPOSES_WITH_FIELD.has(key))
        .map(([key, value]) => ({
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
