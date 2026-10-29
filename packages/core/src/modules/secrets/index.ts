import { CONFIDENCE_RANK } from "../../types.ts";
import type { Confidence, DetectorModule, Finding, ScanOptions } from "../../types.ts";
import { resolveOverlaps } from "../../engine.ts";
import { shannonEntropy } from "./entropy.ts";
import { VALIDATORS } from "./validators.ts";
import {
  isDescriptiveName,
  isKnownExample,
  isPlaceholder,
  isUrlPasswordPlaceholder,
  looksLikeNonSecretValue,
} from "./filters.ts";
import { RULES, RULESET_VERSION } from "./rules.generated.ts";
import type { SecretRule } from "./rule.ts";

/**
 * Secrets module: API keys, tokens, private keys and credentials.
 *
 * Pipeline for every rule:
 *   keyword pre-check -> regex -> validator -> entropy -> filters -> confidence
 * then one overlap pass across all rules.
 */

interface CompiledRule extends SecretRule {
  re: RegExp;
}

interface Candidate extends Finding {
  /** 0 = known format, 1 = loose format (sk-, Bearer), 2 = any secret-like variable name. */
  specificity: number;
}

const DOWNGRADE: Record<Confidence, Confidence> = { high: "medium", medium: "low", low: "low" };

export function compileRules(rules: readonly SecretRule[]): CompiledRule[] {
  return rules.map((r) => ({ ...r, re: new RegExp(r.pattern, "gd" + r.flags.replace(/[gd]/g, "")) }));
}

export function maskValue(value: string, ruleId: string): string {
  if (ruleId === "private-key") {
    const lines = value.split(/\r?\n/).length;
    return lines > 1 ? `-----BEGIN … PRIVATE KEY----- (${lines} lines)` : "-----BEGIN … PRIVATE KEY-----";
  }
  // Short values (passwords) reveal almost nothing; long keys show their prefix so you can tell them apart.
  if (value.length <= 8) return "•".repeat(value.length);
  if (value.length < 16) return value.slice(0, 2) + "•".repeat(Math.min(10, value.length - 2));
  const keep = value.length >= 20 ? 4 : 2;
  return value.slice(0, keep) + "•".repeat(Math.min(10, value.length - keep - 2)) + value.slice(-2);
}

export interface SecretsModuleOptions {
  /** Override the built-in rules (useful for tests or custom rule packs). */
  rules?: readonly SecretRule[];
}

export function createSecretsModule(options: SecretsModuleOptions = {}): DetectorModule {
  const rules = compileRules(options.rules ?? RULES);

  function scan(text: string, opts: ScanOptions = {}): Finding[] {
    if (!text) return [];
    const lower = text.toLowerCase();
    const disabledRules = new Set(opts.disabledRules ?? []);
    const disabledCats = new Set(opts.disabledCategories ?? []);
    const minRank = CONFIDENCE_RANK[opts.minConfidence ?? "low"];
    const candidates: Candidate[] = [];

    for (const rule of rules) {
      if (disabledRules.has(rule.id) || disabledCats.has(rule.category)) continue;
      // 1. Keyword pre-check: skip the regex entirely if no keyword is present.
      if (rule.keywords.length && !rule.keywords.some((k) => lower.includes(k))) continue;

      rule.re.lastIndex = 0;
      for (const m of text.matchAll(rule.re)) {
        // 2. Pattern match: pull out the secret's exact position.
        const value = m[rule.group];
        const span = m.indices?.[rule.group];
        if (value === undefined || !span) continue;
        const [start, end] = span;
        let confidence: Confidence = rule.confidence;
        let reason = rule.description;
        const name = rule.nameGroup !== undefined ? m[rule.nameGroup] : undefined;

        // 3. Known example keys from vendor docs: keep, but at low confidence.
        if (isKnownExample(value)) {
          confidence = "low";
          reason = "This is a published example key, not a real one";
        } else {
          // 4. Filters: placeholders, masks, variable references.
          if (isPlaceholder(value)) continue;
          if (rule.generic && looksLikeNonSecretValue(value, text[end])) continue;
          if (name && isDescriptiveName(name)) continue;
          if (rule.category === "database" && isUrlPasswordPlaceholder(value)) continue;

          // 5. Entropy: generic values must look random enough.
          let entropy: number | undefined;
          if (rule.minEntropy !== undefined) {
            entropy = shannonEntropy(value);
            if (entropy < rule.minEntropy) continue;
          }

          // 6. Validators: a failed checksum lowers confidence instead of dropping.
          if (rule.validate) {
            const validator = VALIDATORS[rule.validate];
            if (validator && validator(value) === "fail") {
              confidence = DOWNGRADE[confidence];
              reason = `${reason}. The built-in checksum did not match, so it may be mistyped or fake`;
            }
          }

          // 7. Context boost: a very random value assigned to a secret-like name.
          if (rule.generic && name && entropy !== undefined) {
            reason = `Random-looking value (${entropy.toFixed(1)} bits/char) assigned to "${name}"`;
            if (entropy >= 4.3 && value.length >= 24 && confidence === "medium") confidence = "high";
          }
        }

        if (CONFIDENCE_RANK[confidence] < minRank) continue;
        candidates.push({
          module: "secrets",
          ruleId: rule.id,
          label: rule.label,
          category: rule.category,
          start,
          end,
          confidence,
          preview: maskValue(value, rule.id),
          reason,
          placeholder: rule.placeholder,
          specificity: rule.generic ? (rule.nameGroup !== undefined ? 2 : 1) : 0,
        });
      }
    }

    // 8. Overlaps: one finding per stretch of text. Specific rules beat generic ones.
    return resolveOverlaps(candidates, (c) => c.specificity).map(({ specificity: _s, ...f }) => f);
  }

  return { id: "secrets", version: RULESET_VERSION, ruleCount: rules.length, scan };
}

export const secretsModule: DetectorModule = createSecretsModule();
