import Anthropic from "@anthropic-ai/sdk";

/** Vastgezet model. Wijzigen is een bewuste beslissing, niet een default. */
export const MODEL = "claude-opus-5" as const;

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY ontbreekt");
    }
    client = new Anthropic();
  }
  return client;
}
