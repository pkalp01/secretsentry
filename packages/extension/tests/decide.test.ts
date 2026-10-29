import { test } from "node:test";
import assert from "node:assert/strict";
import { findSecrets, applyChoice } from "../src/content/decide.ts";

const KEY = "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc".split("").reverse().join("");
const text = `my stripe key is ${KEY} and it fails`;

test("finds high/medium secrets, ignores low-confidence example keys", () => {
  assert.equal(findSecrets(text)[0]?.ruleId, "stripe-live-key");
  assert.deepEqual(findSecrets("aws key AKIAIOSFODNN7EXAMPLE"), []);
  assert.deepEqual(findSecrets("hello"), []);
});

test("each choice produces the right text", () => {
  const f = findSecrets(text);
  assert.equal(applyChoice(text, f, "allow"), text);
  assert.equal(applyChoice(text, f, "placeholder"), "my stripe key is [STRIPE_SECRET_KEY_1] and it fails");
  assert.equal(applyChoice(text, f, "remove"), "my stripe key is  and it fails");
  assert.equal(applyChoice(text, f, "cancel"), null);
});

test("secrets far past the engine's per-scan limit are still found", () => {
  const filler = "lorem ipsum dolor sit amet ".repeat(40_000); // ~1 MB
  const big = filler + KEY + " " + filler;
  const f = findSecrets(big);
  assert.equal(f.length, 1);
  assert.equal(big.slice(f[0]!.start, f[0]!.end), KEY);
});

test("a secret that straddles a chunk boundary is found once", () => {
  const pad = "x ".repeat(99_995); // puts the key across the 200,000-char boundary
  const f = findSecrets(pad + KEY + " end");
  assert.equal(f.length, 1);
});
