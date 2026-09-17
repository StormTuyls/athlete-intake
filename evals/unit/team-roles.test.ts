import assert from "node:assert/strict";
import {
  blockedTeamChange,
  type TeamRoleState,
} from "../../lib/db/practitioners";
import { roleAfterSignup } from "../../lib/intake/athlete";

/**
 * De rol is nu een keuzelijst op het teamscherm, en daarmee is er een klik die
 * een praktijk uit haar eigen beheerscherm kan zetten. Er is geen scherm dat dat
 * herstelt: wie de laatste beheerder wegzet, heeft een ontwikkelaar met
 * databanktoegang nodig om terug binnen te komen.
 *
 * Vandaar dat de grendel een losse functie is en geen `if` in de route. Hij is
 * hier te draaien zonder databank, en dat is het verschil tussen een regel die
 * getest is en een regel waarvan we aannemen dat hij klopt.
 */

const team: TeamRoleState[] = [
  { id: "a", role: "admin", archivedAt: null },
  { id: "b", role: "admin", archivedAt: null },
  { id: "c", role: "coach", archivedAt: null },
  { id: "d", role: "admin", archivedAt: "2026-01-01T00:00:00Z" },
];

const check = (change: Parameters<typeof blockedTeamChange>[0]["change"], actorId = "a") =>
  blockedTeamChange({ team, actorId, change });

// 1. Het gewone geval: een collega promoveren mag, en degraderen ook zolang er
//    een andere beheerder overblijft.
assert.equal(check({ id: "c", role: "admin" }), null);
assert.equal(check({ id: "b", role: "coach" }), null);

// 2. Je eigen beheerdersrol afzetten niet. Dit is de klik die het scherm sluit
//    waarop je hem terug zou zetten.
assert.match(
  check({ id: "a", role: "coach" }) ?? "",
  /own administrator role/,
  "zelfdegradatie hoort geweigerd te worden",
);

// 3. Jezelf archiveren evenmin, om dezelfde reden.
assert.match(check({ id: "a", archived: true }) ?? "", /your own account/);

// 4. De laatste actieve beheerder blijft staan, of de wijziging nu over de rol
//    of over het archief gaat. Let op wie de actor is: dit is niet hetzelfde
//    geval als hierboven, want hier degradeert iemand anders.
const single: TeamRoleState[] = [
  { id: "a", role: "admin", archivedAt: null },
  { id: "c", role: "coach", archivedAt: null },
];

assert.match(
  blockedTeamChange({ team: single, actorId: "c", change: { id: "a", role: "coach" } }) ?? "",
  /at least one active administrator/,
);
assert.match(
  blockedTeamChange({ team: single, actorId: "c", change: { id: "a", archived: true } }) ?? "",
  /at least one active administrator/,
  "archiveren kon de laatste beheerder wel degelijk wegzetten",
);

// 5. Een gearchiveerde beheerder telt niet mee als beheerder die er nog is.
const archivedSpare: TeamRoleState[] = [
  { id: "a", role: "admin", archivedAt: null },
  { id: "d", role: "admin", archivedAt: "2026-01-01T00:00:00Z" },
];
assert.match(
  blockedTeamChange({ team: archivedSpare, actorId: "c", change: { id: "a", archived: true } }) ?? "",
  /at least one active administrator/,
);

// 6. Een gearchiveerde beheerder terughalen mag altijd: dat maakt er meer, geen
//    minder.
assert.equal(
  blockedTeamChange({ team: archivedSpare, actorId: "a", change: { id: "d", archived: false } }),
  null,
);

// 7. Een vakgebied wijzigen raakt dit niet, ook niet bij jezelf.
assert.equal(check({ id: "a" }), null);

// 8. Een id dat niet in het team zit is geen stille no-op. De rij kan net
//    verdwenen zijn terwijl het scherm openstond.
assert.match(check({ id: "weg", role: "admin" }) ?? "", /no longer exists/);

// 9. Een aanmelding mag een behandelaar niet degraderen.
//
//    ensureAthleteForUser() schreef altijd rol 'athlete' mee in zijn upsert. Dat
//    klopte zolang staf en atleten twee groepen mensen waren. Een kinesist die
//    zelf bij deze praktijk in behandeling is, is allebei, en dan is die vaste
//    waarde een stille degradatie: geen fout, geen melding, wel weg.
assert.equal(roleAfterSignup(undefined), "athlete", "een nieuw account is een atleet");
assert.equal(roleAfterSignup(null), "athlete");
assert.equal(roleAfterSignup("athlete"), "athlete");
assert.equal(roleAfterSignup("coach"), "coach", "staf blijft staf na een aanmelding");
assert.equal(roleAfterSignup("admin"), "admin");
// Onzin uit de databank valt terug op de minste rechten, niet op de meeste.
assert.equal(roleAfterSignup("superuser"), "athlete");

console.log("team-roles: ok");
