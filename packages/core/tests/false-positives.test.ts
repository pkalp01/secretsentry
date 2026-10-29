import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { secretsModule } from "../src/index.ts";

// Everyday text and code that must never be flagged. Every false alarm someone
// reports should be added to fixtures/clean.txt so it can never come back.
// Placeholder keys are written as <<x:N>> (N copies of "x") so GitHub's secret
// scanning doesn't block pushes over a fake "sk_live_xxxx..." line.
const corpus = readFileSync(new URL("./fixtures/clean.txt", import.meta.url), "utf8")
  .replace(/<<(\w):(\d+)>>/g, (_, ch: string, n: string) => ch.repeat(Number(n)));

test("no findings in the clean corpus", () => {
  const findings = secretsModule.scan(corpus);
  const report = findings.map((f) => {
    const lineNo = corpus.slice(0, f.start).split("\n").length;
    return `line ${lineNo}: ${f.ruleId} (${f.confidence}) -> ${corpus.split("\n")[lineNo - 1]}`;
  });
  assert.deepEqual(report, []);
});
