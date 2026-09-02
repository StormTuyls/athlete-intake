import { readFileSync } from "node:fs";

/**
 * Laadt .env.local voor losstaande scripts. Next doet dit zelf, node niet, en
 * een script dat stil zonder key draait geeft een verwarrende 401.
 */
export function loadEnv(file = ".env.local"): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
}
