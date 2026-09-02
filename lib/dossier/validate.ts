import type { FieldDataType, FieldDefinition } from "@/lib/types";

/**
 * Typevalidatie per veld. Voedt zowel de betrouwbaarheidsregel als de
 * conflictdetectie, want twee waarden vergelijken kan alleen na normalisatie.
 */

export interface Validation {
  valid: boolean;
  /** De genormaliseerde waarde, of null als hij niet te lezen was. */
  normalised: unknown;
  reason?: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validateValue(
  definition: Pick<FieldDefinition, "dataType" | "enumOptions">,
  raw: unknown,
): Validation {
  if (raw === null || raw === undefined || raw === "") {
    return { valid: false, normalised: null, reason: "leeg" };
  }

  switch (definition.dataType) {
    case "text":
    case "long_text": {
      const text = String(raw).trim();
      return text === ""
        ? { valid: false, normalised: null, reason: "leeg" }
        : { valid: true, normalised: text };
    }

    case "number": {
      // Het model levert soms "72 kg" of "1,84". Beide zijn te lezen.
      const text = String(raw).replace(",", ".").replace(/[^\d.\-]/g, "");
      const value = Number(text);
      return Number.isFinite(value)
        ? { valid: true, normalised: value }
        : { valid: false, normalised: null, reason: "geen getal" };
    }

    case "boolean": {
      if (typeof raw === "boolean") return { valid: true, normalised: raw };
      const text = String(raw).trim().toLowerCase();
      if (["ja", "yes", "true", "1"].includes(text)) {
        return { valid: true, normalised: true };
      }
      if (["nee", "neen", "no", "false", "0"].includes(text)) {
        return { valid: true, normalised: false };
      }
      return { valid: false, normalised: null, reason: "geen ja of nee" };
    }

    case "date": {
      const text = String(raw).trim();
      if (DATE.test(text)) {
        const parsed = new Date(`${text}T00:00:00Z`);
        return Number.isNaN(parsed.getTime())
          ? { valid: false, normalised: null, reason: "bestaat niet" }
          : { valid: true, normalised: text };
      }
      // Dag-eerst, want dat is de notatie in de brondocumenten hier. Het model
      // wordt gevraagd ISO te leveren; dit is de terugvaloptie.
      const dayFirst = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(text);
      if (dayFirst) {
        const [, d, m, y] = dayFirst;
        const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
        const parsed = new Date(`${iso}T00:00:00Z`);
        if (!Number.isNaN(parsed.getTime()) && parsed.getUTCDate() === Number(d)) {
          return { valid: true, normalised: iso };
        }
      }
      return { valid: false, normalised: null, reason: "geen leesbare datum" };
    }

    case "enum": {
      const text = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
      const match = definition.enumOptions?.find(
        (option) => option.toLowerCase() === text,
      );
      return match
        ? { valid: true, normalised: match }
        : { valid: false, normalised: null, reason: "niet in de lijst" };
    }

    case "list": {
      const items = Array.isArray(raw)
        ? raw.map((item) => String(item).trim())
        : String(raw)
            .split(/[;,\n]/)
            .map((item) => item.trim());
      const clean = items.filter((item) => item !== "");
      return clean.length > 0
        ? { valid: true, normalised: clean }
        : { valid: false, normalised: null, reason: "lege lijst" };
    }
  }
}

/**
 * Sleutel om twee waarden te vergelijken voor conflictdetectie. Verschil in
 * spelling of notatie mag geen conflict opleveren; verschil in betekenis wel.
 */
export function comparisonKey(dataType: FieldDataType, value: unknown): string {
  if (value === null || value === undefined) return "";

  switch (dataType) {
    case "number":
      return String(Number(value));
    case "boolean":
      return String(Boolean(value));
    case "text":
    case "long_text":
      return String(value).toLowerCase().replace(/\s+/g, " ").trim();
    case "list":
      return (Array.isArray(value) ? value : [value])
        .map((item) => String(item).toLowerCase().trim())
        .sort()
        .join("|");
    default:
      return String(value).trim();
  }
}
