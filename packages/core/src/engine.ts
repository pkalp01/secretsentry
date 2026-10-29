import { CONFIDENCE_RANK } from "./types.ts";
import type { DetectorModule, Finding, ScanOptions, ScanResult } from "./types.ts";

export interface EngineOptions {
  modules: DetectorModule[];
  /**
   * Inputs longer than this are scanned only up to this length, so a huge
   * paste can never freeze the page. Default 200,000 characters.
   */
  maxInputLength?: number;
}

export interface Engine {
  scan(text: string, options?: ScanOptions): ScanResult;
}

/**
 * Keeps one finding per stretch of text. The more specific rule wins (lower
 * `rank`, so "GitHub token" beats "secret assigned to a variable"), then
 * higher confidence, then the longer match.
 */
export function resolveOverlaps<T extends Finding>(findings: T[], rank: (f: T) => number = () => 0): T[] {
  const ordered = [...findings].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
      (b.end - b.start) - (a.end - a.start) ||
      a.start - b.start,
  );
  const kept: T[] = [];
  for (const f of ordered) {
    if (!kept.some((k) => f.start < k.end && f.end > k.start)) kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function createEngine({ modules, maxInputLength = 200_000 }: EngineOptions): Engine {
  return {
    scan(text, options) {
      const t0 = performance.now();
      const truncated = text.length > maxInputLength;
      const input = truncated ? text.slice(0, maxInputLength) : text;
      const all = modules.flatMap((m) => m.scan(input, options));
      return {
        findings: resolveOverlaps(all),
        truncated,
        durationMs: performance.now() - t0,
        modules: modules.map((m) => ({ id: m.id, version: m.version, ruleCount: m.ruleCount })),
      };
    },
  };
}
