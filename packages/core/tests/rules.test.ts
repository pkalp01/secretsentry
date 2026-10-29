import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadAuthoredRules, renderGenerated, GENERATED_PATH } from "../scripts/rules-loader.ts";
import { createSecretsModule } from "../src/modules/secrets/index.ts";
import { expand } from "./helpers.ts";

const { rules } = loadAuthoredRules();
const secrets = createSecretsModule();

test("generated rules file is up to date with the YAML (run `npm run build:rules`)", () => {
  assert.equal(readFileSync(GENERATED_PATH, "utf8"), renderGenerated());
});

for (const rule of rules) {
  test(`rule ${rule.id} (${rule.file})`, async (t) => {
    for (const [i, template] of rule.tests.match.entries()) {
      await t.test(`matches example ${i + 1}`, () => {
        const text = expand(template, `${rule.id}:m${i}`);
        const hits = secrets.scan(text).filter((f) => f.ruleId === rule.id);
        assert.ok(hits.length > 0, `expected ${rule.id} to match:\n${text}\nGot: ${JSON.stringify(secrets.scan(text).map((f) => f.ruleId))}`);
        for (const h of hits) {
          assert.ok(!h.preview.includes(text.slice(h.start + 4, h.end - 2)) || h.end - h.start < 10, "preview must be masked");
        }
      });
    }
    for (const [i, template] of rule.tests.nomatch.entries()) {
      await t.test(`ignores example ${i + 1}`, () => {
        const text = expand(template, `${rule.id}:n${i}`);
        const hits = secrets.scan(text).filter((f) => f.ruleId === rule.id);
        assert.equal(hits.length, 0, `expected ${rule.id} NOT to match:\n${text}`);
      });
    }
  });
}
