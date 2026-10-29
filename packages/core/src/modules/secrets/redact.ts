import type { Finding } from "../../types.ts";

export type RedactMode = "placeholder" | "mask" | "remove";

export interface RedactResult {
  text: string;
  /** What each finding was replaced with, in the same order as the input findings. */
  replacements: { ruleId: string; replacement: string }[];
}

/**
 * Replaces each finding in `text`.
 *
 *  placeholder  AKIA... -> [AWS_ACCESS_KEY_ID_1]  (the same value always gets the same label)
 *  mask         AKIA... -> the finding's masked preview
 *  remove       AKIA... -> ""
 *
 * Findings must come from scanning this exact text. Overlapping findings are
 * not expected (the engine resolves them), but are skipped safely if present.
 */
export function redact(text: string, findings: readonly Finding[], mode: RedactMode = "placeholder"): RedactResult {
  const ordered = [...findings].sort((a, b) => a.start - b.start);
  const counters = new Map<string, number>();
  const labelByValue = new Map<string, string>();
  const replacementFor = new Map<Finding, string>();

  for (const f of ordered) {
    const value = text.slice(f.start, f.end);
    let replacement: string;
    if (mode === "remove") replacement = "";
    else if (mode === "mask") replacement = f.preview;
    else {
      const key = `${f.placeholder}\u0000${value}`;
      replacement = labelByValue.get(key) ?? "";
      if (!replacement) {
        const n = (counters.get(f.placeholder) ?? 0) + 1;
        counters.set(f.placeholder, n);
        replacement = `[${f.placeholder}_${n}]`;
        labelByValue.set(key, replacement);
      }
    }
    replacementFor.set(f, replacement);
  }

  let out = "";
  let cursor = 0;
  for (const f of ordered) {
    if (f.start < cursor) continue; // overlapping, skip
    out += text.slice(cursor, f.start) + replacementFor.get(f);
    cursor = f.end;
  }
  out += text.slice(cursor);

  return {
    text: out,
    replacements: findings.map((f) => ({ ruleId: f.ruleId, replacement: replacementFor.get(f) ?? "" })),
  };
}
