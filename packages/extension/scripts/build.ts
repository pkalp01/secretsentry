import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SITE_PATTERNS, E2E_SITE_PATTERNS, permissionOrigin } from "../src/sites.ts";

/**
 * Builds the extension into dist/ (or dist-e2e/ with --e2e).
 * Output is NOT minified on purpose: anyone can read exactly what runs.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const e2e = process.argv.includes("--e2e");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const out = outArg ? outArg.slice(6) : join(root, e2e ? "dist-e2e" : "dist");

const sitePatterns = [...DEFAULT_SITE_PATTERNS, ...(e2e ? E2E_SITE_PATTERNS : [])];
const hostPermissions = [...new Set(sitePatterns.map(permissionOrigin))];

export const manifest = {
  manifest_version: 3,
  name: "SecretSentry",
  short_name: "SecretSentry",
  version: "0.1.0",
  description: "Warns you before API keys and other secrets leave your browser for an AI chat. Runs entirely on your device.",
  minimum_chrome_version: "116",
  icons: { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" },
  action: {
    default_title: "SecretSentry",
    default_popup: "popup/popup.html",
    default_icon: { "16": "icons/icon-16.png", "32": "icons/icon-32.png" },
  },
  options_ui: { page: "options/options.html", open_in_tab: true },
  background: { service_worker: "background.js" },
  // storage: the site list. scripting: load the checker only on allowed sites.
  // activeTab: show the current site in the toolbar popup when you click it.
  permissions: ["storage", "scripting", "activeTab"],
  host_permissions: hostPermissions,
  // Sites you add yourself. The browser asks you for each one.
  optional_host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
  content_security_policy: {
    extension_pages:
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  },
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: {
    "background": join(root, "src/background.ts"),
    "content": join(root, "src/content/index.ts"),
    "popup/popup": join(root, "src/popup/popup.ts"),
    "options/options": join(root, "src/options/options.ts"),
  },
  outdir: out,
  absWorkingDir: root,
  bundle: true,
  format: "iife",
  target: "chrome116",
  minify: false,
  legalComments: "none",
  charset: "utf8",
  define: { __E2E__: JSON.stringify(e2e) },
  logLevel: "warning",
});

for (const f of ["popup/popup.html", "popup/popup.css", "options/options.html", "options/options.css", "ui.css"]) {
  mkdirSync(dirname(join(out, f)), { recursive: true });
  cpSync(join(root, "src", f), join(out, f));
}
cpSync(join(root, "static/icons"), join(out, "icons"), { recursive: true });
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
if (!process.argv.includes("--quiet")) {
  console.log(`Built SecretSentry ${manifest.version} into ${out} (${hostPermissions.length} built-in sites)`);
}
