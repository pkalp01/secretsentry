import { createEngine, secretsModule, redact, resolveOverlaps } from "@infodetector/core";
import type { Finding } from "@infodetector/core";

/** Pure logic shared by the paste and send paths. No DOM, no browser APIs. */

export type Choice = "allow" | "placeholder" | "remove" | "cancel";

const CHUNK = 200_000;
const OVERLAP = 16_000; // longer than any single secret (private keys are capped at ~12 KB)
const engine = createEngine({ modules: [secretsModule], maxInputLength: CHUNK });

/**
 * Findings worth interrupting the user for: high and medium confidence only.
 * Long text is scanned in overlapping chunks, so nothing past the engine's
 * per-scan limit slips through.
 */
export function findSecrets(text: string): Finding[] {
  if (!text || text.length < 8) return [];
  if (text.length <= CHUNK) return engine.scan(text, { minConfidence: "medium" }).findings;
  const all: Finding[] = [];
  for (let offset = 0; offset < text.length; offset += CHUNK - OVERLAP) {
    const part = engine.scan(text.slice(offset, offset + CHUNK), { minConfidence: "medium" }).findings;
    for (const f of part) all.push({ ...f, start: f.start + offset, end: f.end + offset });
    if (offset + CHUNK >= text.length) break;
  }
  return resolveOverlaps(all);
}

/** Returns the text to use after the user's choice, or null to do nothing. */
export function applyChoice(text: string, findings: Finding[], choice: Choice): string | null {
  switch (choice) {
    case "allow":
      return text;
    case "placeholder":
      return redact(text, findings, "placeholder").text;
    case "remove":
      return redact(text, findings, "remove").text;
    case "cancel":
      return null;
  }
}
