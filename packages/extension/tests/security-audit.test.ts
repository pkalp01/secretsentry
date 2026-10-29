import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEFAULT_SITE_PATTERNS, permissionOrigin } from "../src/sites.ts";

/**
 * Guards the security promises in SECURITY.md. If one of these fails, a change
 * has widened what SecretSentry can access or do. Don't just update the test:
 * explain the change in the pull request.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));

test("dist/ is up to date with the source (run `npm run build`)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "secretsentry-"));
  execFileSync(process.execPath, [join(root, "scripts/build.ts"), `--out=${tmp}`, "--quiet"]);
  const a = files(dist).map((f) => relative(dist, f)).sort();
  const b = files(tmp).map((f) => relative(tmp, f)).sort();
  assert.deepEqual(a, b);
  for (const f of a) assert.ok(readFileSync(join(dist, f)).equals(readFileSync(join(tmp, f))), `${f} differs from a fresh build`);
});

test("permissions are exactly the minimal set", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting", "storage"]);
});

test("built-in host access covers only the AI sites in the default list", () => {
  const expected = [...new Set(DEFAULT_SITE_PATTERNS.map(permissionOrigin))].sort();
  assert.deepEqual([...manifest.host_permissions].sort(), expected);
  for (const h of manifest.host_permissions) {
    assert.ok(/^https:\/\/[a-z0-9.-]+\/\*$/.test(h), `host permission too broad: ${h}`);
  }
});

test("user-added sites are optional and need the browser's own prompt", () => {
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"]);
});

test("no static content scripts: code is only injected on sites the user allows", () => {
  assert.equal(manifest.content_scripts, undefined);
});

test("no files are exposed to web pages, and nothing outside can message the extension", () => {
  assert.equal(manifest.web_accessible_resources, undefined);
  // No externally_connectable key means web pages can't connect at all. Other
  // extensions could try, but nothing listens: there are no external message handlers.
  assert.equal(manifest.externally_connectable, undefined);
  for (const f of files(dist).filter((f) => f.endsWith(".js"))) {
    assert.ok(!/onMessageExternal|onConnectExternal|onMessage\b|onConnect\b/.test(readFileSync(f, "utf8")), `${relative(dist, f)} listens for messages`);
  }
});

test("extension pages can't load remote code or make network requests", () => {
  const csp: string = manifest.content_security_policy.extension_pages;
  for (const d of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "object-src 'none'"]) {
    assert.ok(csp.includes(d), `CSP is missing ${d}`);
  }
  assert.ok(!/unsafe-|https?:|\*/.test(csp), "CSP must not allow unsafe-* or remote sources");
});

// Network, dynamic code, HTML-string injection, logging of page content, persistent web storage.
const FORBIDDEN: [RegExp, string][] = [
  [/\bfetch\s*\(/, "fetch()"],
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/sendBeacon/, "sendBeacon"],
  [/RTCPeerConnection/, "WebRTC"],
  [/\bimportScripts\b/, "importScripts"],
  [/\beval\s*\(/, "eval()"],
  [/new\s+Function\s*\(/, "new Function()"],
  [/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/, "HTML string injection"],
  [/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, "web storage"],
  [/chrome\.storage\.sync/, "synced storage (would leave the device)"],
  [/chrome\.runtime\.(sendMessage|connect)\b|postMessage\s*\(/, "message passing"],
];

test("built code uses no network, no dynamic code, no HTML injection, no web storage", () => {
  const problems: string[] = [];
  for (const f of files(dist).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(f, "utf8");
    for (const [re, what] of FORBIDDEN) if (re.test(src)) problems.push(`${relative(dist, f)} uses ${what}`);
  }
  assert.deepEqual(problems, []);
});

test("the content script never logs", () => {
  const src = readFileSync(join(dist, "content.js"), "utf8");
  assert.ok(!/console\.(log|info|debug|warn|error|trace|dir)\b/.test(src));
});

test("the content script never writes to storage", () => {
  const src = readFileSync(join(dist, "content.js"), "utf8");
  assert.ok(!/chrome\.storage\.local\.(set|remove|clear)/.test(src));
});

test("extension pages load only local scripts and styles", () => {
  for (const f of files(dist).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(f, "utf8");
    assert.ok(!/<script(?![^>]*src="[^"/:]+\.js")[^>]*>/.test(html), `${relative(dist, f)} has an inline or remote script`);
    assert.ok(!/(src|href)="(https?:)?\/\//.test(html), `${relative(dist, f)} loads something remote`);
    assert.ok(!/\son[a-z]+=/i.test(html), `${relative(dist, f)} has an inline event handler`);
  }
});
