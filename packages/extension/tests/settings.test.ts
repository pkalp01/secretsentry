import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSettings, defaultSettings, MAX_SITES } from "../src/settings.ts";
import { DEFAULT_SITE_PATTERNS } from "../src/sites.ts";

test("defaults: on, with every built-in site enabled", () => {
  const s = defaultSettings();
  assert.equal(s.enabled, true);
  assert.equal(s.sites.length, DEFAULT_SITE_PATTERNS.length);
  assert.ok(s.sites.every((x) => x.enabled && x.builtIn));
});

test("garbage in storage falls back to defaults", () => {
  for (const raw of [null, 42, "x", [], { sites: "nope" }]) assert.deepEqual(sanitizeSettings(raw), defaultSettings());
});

test("tampered entries can't widen where the extension runs", () => {
  const s = sanitizeSettings({
    enabled: true,
    sites: [
      { pattern: "<all_urls>", enabled: true },
      { pattern: "https://*/*", enabled: true },
      { pattern: "*://*/*", enabled: true },
      { pattern: "http://evil.com/*", enabled: true },
      { pattern: "https://ok.example.com/*", enabled: true, builtIn: true },
      { pattern: "https://ok.example.com/*", enabled: false },
      { pattern: "https://chatgpt.com/*", enabled: false },
    ],
  });
  const custom = s.sites.filter((x) => !x.builtIn);
  assert.deepEqual(custom, [{ pattern: "https://ok.example.com/*", enabled: true, builtIn: false }], "builtIn flag can't be forged and dupes are dropped");
  assert.equal(s.sites.find((x) => x.pattern === "https://chatgpt.com/*")?.enabled, false, "user's choice to turn off a built-in is kept");
});

test("site list is capped", () => {
  const sites = Array.from({ length: MAX_SITES + 50 }, (_, i) => ({ pattern: `https://s${i}.example.com/*`, enabled: true }));
  assert.ok(sanitizeSettings({ sites }).sites.length <= MAX_SITES + DEFAULT_SITE_PATTERNS.length);
});

test("only known fields survive", () => {
  const s = sanitizeSettings({ enabled: false, sites: [], secretStash: "sk_live_abc", history: ["x"] }) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(s).sort(), ["enabled", "sites", "version"]);
});
