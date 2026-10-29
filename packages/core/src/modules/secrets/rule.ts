import type { Confidence } from "../../types.ts";

/** A rule as authored in rules/secrets/*.yaml (minus its tests), compiled into rules.generated.ts. */
export interface SecretRule {
  id: string;
  label: string;
  category: string;
  confidence: Confidence;
  /** Lowercase strings; the rule only runs if one of them appears in the text. Empty = always run. */
  keywords: string[];
  /** JavaScript regex source. */
  pattern: string;
  /** Extra regex flags, e.g. "i". "g" and "d" are always added. */
  flags: string;
  /** Capture group that holds the secret value. 0 = whole match. */
  group: number;
  /** Optional capture group holding the variable name (generic rules). */
  nameGroup?: number;
  /** Name of a validator in validators.ts. */
  validate?: string;
  /** Minimum Shannon entropy (bits/char) of the value. */
  minEntropy?: number;
  /** True for rules without a known prefix. They lose ties against specific rules. */
  generic?: boolean;
  /** Upper-snake name used when redacting. */
  placeholder: string;
  /** Why a match is flagged, shown to the user. */
  description: string;
}

export interface RuleTests {
  match: string[];
  nomatch: string[];
}

export interface AuthoredRule extends Omit<SecretRule, "flags" | "group" | "keywords"> {
  flags?: string;
  group?: number;
  keywords?: string[];
  tests: RuleTests;
}

export const CATEGORIES: Record<string, string> = {
  cloud: "Cloud providers",
  code: "Code hosting and packages",
  payments: "Payments",
  ai: "AI providers",
  messaging: "Chat and email services",
  keys: "Private keys",
  tokens: "Session and auth tokens",
  database: "Database credentials",
  generic: "Generic secrets",
};
