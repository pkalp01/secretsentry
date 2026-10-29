import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine, secretsModule, redact } from "../src/index.ts";
import { expand, rng, randomString } from "./helpers.ts";

const engine = createEngine({ modules: [secretsModule] });
const scan = (t: string) => engine.scan(t).findings;

test("a Finding never contains the raw secret", () => {
  const text = expand("STRIPE_SECRET_KEY=sk_live_<<alnum:32>>", "raw");
  const secret = text.split("=")[1]!;
  const [f] = scan(text);
  assert.ok(f);
  assert.equal(text.slice(f.start, f.end), secret);
  assert.ok(!JSON.stringify(f).includes(secret.slice(8)), "serialized finding leaked the secret");
});

test("a GitHub token with a bad checksum is still flagged, at medium confidence", () => {
  const good = expand("<<ghtoken:ghp_>>", "gh");
  const bad = good.slice(0, -1) + (good.endsWith("A") ? "B" : "A");
  assert.equal(scan(good)[0]?.confidence, "high");
  const f = scan(bad)[0];
  assert.equal(f?.ruleId, "github-token");
  assert.equal(f?.confidence, "medium");
  assert.match(f!.reason, /checksum/);
});

test("published example keys are flagged at low confidence only", () => {
  const f = scan("aws_access_key_id = AKIAIOSFODNN7EXAMPLE")[0];
  assert.equal(f?.ruleId, "aws-access-key-id");
  assert.equal(f?.confidence, "low");
});

test("placeholders and masks are ignored", () => {
  for (const t of [
    "sk_live_" + "x".repeat(26), // built at runtime so GitHub push protection doesn't flag it
    "OPENAI_API_KEY=<your-api-key>",
    "API_KEY=${API_KEY}",
    "password: ********",
    "ghp_" + "0".repeat(36),
    "api_key = [OPENAI_API_KEY_1]",
  ]) assert.deepEqual(scan(t), [], t);
});

test("a specific rule beats the generic one on the same value", () => {
  const f = scan(expand('api_key = "sk-proj-<<urlsafe:100>>"', "ov"));
  assert.equal(f.length, 1);
  assert.equal(f[0]!.ruleId, "openai-api-key");
});

test("generic assignments explain which variable they came from", () => {
  const f = scan(expand("INTERNAL_SERVICE_TOKEN=<<alnum:40>>", "gen"))[0];
  assert.equal(f?.ruleId, "generic-secret-assignment");
  assert.match(f!.reason, /INTERNAL_SERVICE_TOKEN/);
  assert.equal(f!.confidence, "high", "very random 40-char values are boosted");
});

test("disabledCategories and minConfidence are respected", () => {
  const text = expand("sk_test_<<alnum:30>> and AKIA<<b32:16>>", "opts");
  assert.equal(engine.scan(text).findings.length, 2);
  assert.equal(engine.scan(text, { disabledCategories: ["payments"] }).findings.length, 1);
  assert.equal(engine.scan(text, { minConfidence: "high" }).findings.length, 1);
  assert.equal(engine.scan(text, { disabledRules: ["aws-access-key-id"] }).findings.length, 1);
});

test("redact: placeholders are numbered per type and reused for repeated values", () => {
  const text = expand("a=AKIA<<b32:16>> b=AKIA<<b32:16>>", "red");
  const first = text.match(/AKIA\w{16}/)![0];
  const doubled = `${text} c=${first}`;
  const r = redact(doubled, scan(doubled));
  assert.equal(r.text, "a=[AWS_ACCESS_KEY_ID_1] b=[AWS_ACCESS_KEY_ID_2] c=[AWS_ACCESS_KEY_ID_1]");
});

test("redact: mask and remove modes", () => {
  const text = expand("key AKIA<<b32:16>> here", "red2");
  const f = scan(text);
  assert.equal(redact(text, f, "remove").text, "key  here");
  assert.match(redact(text, f, "mask").text, /^key AKIA•+\w\w here$/);
});

test("private keys are masked by line count", () => {
  const text = expand("-----BEGIN RSA PRIVATE KEY-----\n<<b64:64>>\n<<b64:64>>\n-----END RSA PRIVATE KEY-----", "pk");
  assert.equal(scan(text)[0]?.preview, "-----BEGIN … PRIVATE KEY----- (4 lines)");
});

test("huge input is truncated, not rejected", () => {
  const e = createEngine({ modules: [secretsModule], maxInputLength: 1000 });
  const r = e.scan("x".repeat(5000) + expand(" AKIA<<b32:16>>", "big"));
  assert.equal(r.truncated, true);
  assert.equal(r.findings.length, 0);
});

test("empty input", () => {
  assert.deepEqual(scan(""), []);
});

test("offsets are exact for every rule match in a mixed document", () => {
  const next = rng("mixed");
  const parts = [
    "Here is my config:",
    `AWS_ACCESS_KEY_ID=AKIA${randomString("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", 16, next)}`,
    `GROQ_API_KEY=gsk_${randomString("abcdefghijklmnopqrstuvwxyz0123456789", 52, next)}`,
    "thanks!",
  ];
  const text = parts.join("\n");
  const f = scan(text);
  assert.deepEqual(f.map((x) => x.ruleId), ["aws-access-key-id", "groq-api-key"]);
  for (const x of f) assert.ok(!/[\s=]/.test(text.slice(x.start, x.end)));
});
