import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSitePattern, patternMatchesUrl, permissionOrigin, displayName, isProtected, siteForUrl, DEFAULT_SITE_PATTERNS } from "../src/sites.ts";

test("normalizes what people type into safe https patterns", () => {
  const cases: [string, string | null][] = [
    ["chat.example.com", "https://chat.example.com/*"],
    ["https://Chat.Example.com/c/123?x=1#y", "https://chat.example.com/c/123/*"],
    ["chat.example.com:8443", "https://chat.example.com/*"],
    ["https://example.com/Chat/X", "https://example.com/Chat/X/*"],
    ["http://localhost:3000", "http://localhost/*"],
    ["http://127.0.0.1", "http://127.0.0.1/*"],
    ["huggingface.co/chat", "https://huggingface.co/chat/*"],
  ];
  for (const [input, want] of cases) assert.equal(normalizeSitePattern(input), want, input);
});

test("rejects anything that would widen access or isn't a real site", () => {
  for (const bad of [
    "", "*", "*.*", "<all_urls>", "*://*/*", "https://*/*", "http://example.com", "ftp://example.com",
    "file:///etc/passwd", "chrome://settings", "javascript:alert(1)", "user:pass@example.com",
    "exa mple.com", "example", "-bad.com", "192.168.1.10", "https://*.com", "a".repeat(300) + ".com",
    "*.example.ai", "*.github.io", "*.co.uk", "https://*.vercel.app",
  ]) assert.equal(normalizeSitePattern(bad), null, bad);
});

test("pattern matching", () => {
  assert.ok(patternMatchesUrl("https://chatgpt.com/*", "https://chatgpt.com/c/abc"));
  assert.ok(!patternMatchesUrl("https://chatgpt.com/*", "http://chatgpt.com/"));
  assert.ok(!patternMatchesUrl("https://chatgpt.com/*", "https://evilchatgpt.com/"));
  assert.ok(!patternMatchesUrl("https://chatgpt.com/*", "https://chatgpt.com.evil.io/"));
  assert.ok(patternMatchesUrl("https://example.com/Chat/*", "https://example.com/Chat/1"));
  assert.ok(!patternMatchesUrl("https://example.com/Chat/*", "https://example.com/chat/1"), "paths are case-sensitive");
  assert.ok(patternMatchesUrl("https://huggingface.co/chat/*", "https://huggingface.co/chat/conversation/1"));
  assert.ok(patternMatchesUrl("https://huggingface.co/chat/*", "https://huggingface.co/chat"));
  assert.ok(!patternMatchesUrl("https://huggingface.co/chat/*", "https://huggingface.co/models"));
  assert.ok(patternMatchesUrl("http://localhost/*", "http://localhost:3000/"));
});

test("every built-in pattern is valid and round-trips", () => {
  for (const p of DEFAULT_SITE_PATTERNS) assert.equal(normalizeSitePattern(p), p, p);
  assert.equal(permissionOrigin("https://huggingface.co/chat/*"), "https://huggingface.co/*");
  assert.equal(displayName("https://huggingface.co/chat/*"), "huggingface.co/chat");
});

test("an enabled entry wins over a disabled one for the same URL", () => {
  const sites = [
    { pattern: "https://example.com/*", enabled: false, builtIn: true },
    { pattern: "https://example.com/chat/*", enabled: true, builtIn: false },
  ];
  assert.ok(isProtected(sites, "https://example.com/chat/1"));
  assert.ok(!isProtected(sites, "https://example.com/other"));
  assert.equal(siteForUrl(sites, "https://example.com/chat/1")?.enabled, true);
});
