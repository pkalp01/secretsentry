/**
 * Shared types for the infodetector core engine.
 *
 * Privacy rule: a Finding never carries the raw secret. It holds offsets into
 * the text the caller already has, plus a masked preview. That way nothing
 * downstream (UI, logs, telemetry) can leak the value by accident.
 */

export type Confidence = "high" | "medium" | "low";

export interface Finding {
  /** Module that produced the finding, e.g. "secrets". */
  module: string;
  /** Stable rule id, e.g. "aws-access-key-id". */
  ruleId: string;
  /** Human label, e.g. "AWS access key ID". */
  label: string;
  /** Rule category, e.g. "cloud", "code", "payments", "ai". */
  category: string;
  /** Start offset (inclusive) of the sensitive value in the scanned text. */
  start: number;
  /** End offset (exclusive). */
  end: number;
  confidence: Confidence;
  /** Masked preview that is safe to display, e.g. "AKIA••••••••LE". */
  preview: string;
  /** One-sentence explanation of why this was flagged. */
  reason: string;
  /** Upper-snake name used when redacting, e.g. "AWS_ACCESS_KEY_ID". */
  placeholder: string;
}

export interface ScanOptions {
  /** Rule ids to skip. */
  disabledRules?: readonly string[];
  /** Categories to skip, e.g. ["payments"]. */
  disabledCategories?: readonly string[];
  /** Drop findings below this confidence. Default "low" (keep everything). */
  minConfidence?: Confidence;
}

export interface DetectorModule {
  /** Module id, e.g. "secrets". */
  id: string;
  /** Ruleset version, e.g. "2026.10.1". */
  version: string;
  /** Number of active rules, for display. */
  ruleCount: number;
  /** Pure function: text in, findings out. No I/O, no storage, no globals. */
  scan(text: string, options?: ScanOptions): Finding[];
}

export interface ScanResult {
  findings: Finding[];
  /** True if the input was longer than maxInputLength and only a prefix was scanned. */
  truncated: boolean;
  /** Wall-clock time spent scanning, in milliseconds. */
  durationMs: number;
  modules: { id: string; version: string; ruleCount: number }[];
}

export const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
