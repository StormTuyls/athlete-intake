import { NextResponse } from "next/server";
import { requireIntake } from "@/lib/intake/session";
import { handleError } from "@/lib/http";
import { dossierView } from "@/lib/intake/report";
import { logAudit } from "@/lib/audit";

/**
 * Het dossier zoals het er nu bij staat, voor het paneel naast het gesprek.
 *
 * Naast /api/intake/state en niet in plaats daarvan, en het verschil is de
 * vorm. Die route geeft ruwe veldwaarden voor code die ermee rekent; deze geeft
 * weergaveklare secties, opgebouwd door dezelfde functie als het rapport dat de
 * atleet kan openen. Zou het paneel /state gebruiken, dan moest de browser de
 * waarden zelf opmaken en de secties zelf groeperen, en dan is er een tweede
 * plek die kan afwijken van het rapport over hetzelfde dossier.
 *
 * Geen bronciteten, net als in dat rapport en om dezelfde reden: een letterlijk
 * fragment uit een medisch verslag teruglezen op een webpagina is een gesprek
 * dat een behandelaar hoort te voeren.
 *
 * Wordt alleen aangeroepen door het paneel, en dat bestaat alleen op een breed
 * scherm. Op een telefoon gaat er dus geen extra request uit.
 */
export async function GET() {
  try {
    const session = await requireIntake();
    const view = await dossierView(session.intakeId, session.locale);

    // Elke leesactie op medische velden, ook door de atleet zelf. Het paneel
    // haalt opnieuw op na elke beurt, dus dit levert regels op; dat is de
    // bedoeling. Een spoor dat leesacties weglaat omdat het er veel zijn, is
    // geen spoor.
    await logAudit({
      action: "read",
      actorKind: "athlete",
      entitySchema: "medical",
      entityTable: "dossier_fields",
      entityId: session.intakeId,
    });

    return NextResponse.json(view);
  } catch (error) {
    return handleError(error);
  }
}
