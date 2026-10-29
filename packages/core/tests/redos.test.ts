import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecretsModule } from "../src/modules/secrets/index.ts";
import { RULES } from "../src/modules/secrets/rules.generated.ts";

// Hostile inputs built to trigger catastrophic regex backtracking. A rule that
// takes longer than the budget on any of them could freeze someone's browser.
const N = 100_000;
const BUDGET_MS = 300;
const hostile: Record<string, string> = {
  "letters": "a".repeat(N),
  "upper": "A".repeat(N),
  "dashes": "-".repeat(N),
  "underscored words": "a_".repeat(N / 2),
  "keyword soup": "api_key_token_secret_".repeat(N / 21),
  "unclosed private key": "-----BEGIN RSA PRIVATE KEY-----\n" + "A".repeat(N),
  "many key headers": "-----BEGIN PRIVATE KEY-----".repeat(N / 27),
  "assignment soup": "password=".repeat(N / 9),
  "url soup": "postgres://u:".repeat(N / 13),
  "jwt-ish": "eyJ" + "a".repeat(N / 2) + ".eyJ" + "b".repeat(N / 2),
  "bearer soup": "Bearer ".repeat(N / 7),
  "prefix soup": "sk-ghp_AKIAxoxb-hf_gsk_".repeat(N / 23),
  "base64 wall": "Ab3+/".repeat(N / 5),
};

for (const rule of RULES) {
  test(`rule ${rule.id} stays under ${BUDGET_MS} ms on hostile input`, () => {
    const one = createSecretsModule({ rules: [{ ...rule, keywords: [] }] });
    for (const [name, text] of Object.entries(hostile)) {
      const t0 = performance.now();
      one.scan(text);
      const ms = performance.now() - t0;
      assert.ok(ms < BUDGET_MS, `${rule.id} took ${ms.toFixed(0)} ms on "${name}"`);
    }
  });
}
