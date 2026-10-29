"use strict";
(() => {
  // src/sites.ts
  var DEFAULT_SITE_PATTERNS = [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://aistudio.google.com/*",
    "https://copilot.microsoft.com/*",
    "https://m365.cloud.microsoft/*",
    "https://www.perplexity.ai/*",
    "https://chat.deepseek.com/*",
    "https://grok.com/*",
    "https://chat.mistral.ai/*",
    "https://www.meta.ai/*",
    "https://poe.com/*",
    "https://chat.qwen.ai/*",
    "https://huggingface.co/chat/*"
  ];
  var E2E_SITE_PATTERNS = ["http://127.0.0.1/*"];
  var HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
  var LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1"]);
  var PATH = /^\/(?:[A-Za-z0-9._~!$&'()+,;=:@%\-/]*\*)?$/;
  function normalizeSitePattern(input) {
    let s = input.trim();
    if (!s || s.length > 253) return null;
    let scheme = "https";
    const schemeMatch = s.match(/^([A-Za-z]+):\/\//);
    if (schemeMatch) {
      scheme = schemeMatch[1].toLowerCase();
      s = s.slice(schemeMatch[0].length);
    }
    const slash = s.indexOf("/");
    let host = (slash === -1 ? s : s.slice(0, slash)).toLowerCase();
    let path = slash === -1 ? "/*" : s.slice(slash);
    host = host.replace(/:\d+$/, "");
    if (host.includes("@")) return null;
    if (scheme !== "https" && !(scheme === "http" && LOCAL_HOSTS.has(host))) return null;
    if (!LOCAL_HOSTS.has(host) && !HOST.test(host)) return null;
    path = path.replace(/[?#].*$/, "");
    if (!path.endsWith("*")) path = path.replace(/\/?$/, "/*");
    if (path !== "/*" && !path.endsWith("/*")) path = path.replace(/\*$/, "/*");
    if (!PATH.test(path)) return null;
    return `${scheme}://${host}${path}`;
  }
  function permissionOrigin(pattern) {
    return pattern.replace(/^([a-z]+:\/\/[^/]+)\/.*$/, "$1/*");
  }

  // src/settings.ts
  var STORAGE_KEY = "settings";
  var MAX_SITES = 200;
  var isE2E = false;
  function builtInPatterns() {
    return [...DEFAULT_SITE_PATTERNS, ...isE2E ? E2E_SITE_PATTERNS : []];
  }
  function defaultSettings() {
    return { version: 1, enabled: true, sites: builtInPatterns().map((pattern) => ({ pattern, enabled: true, builtIn: true })) };
  }
  function sanitizeSettings(raw) {
    const base = defaultSettings();
    if (!raw || typeof raw !== "object") return base;
    const r = raw;
    const builtIns = new Set(builtInPatterns());
    const seen = /* @__PURE__ */ new Set();
    const sites = [];
    if (Array.isArray(r.sites)) {
      for (const item of r.sites.slice(0, MAX_SITES)) {
        if (!item || typeof item !== "object") continue;
        const s = item;
        if (typeof s.pattern !== "string") continue;
        const pattern = builtIns.has(s.pattern) ? s.pattern : normalizeSitePattern(s.pattern);
        if (!pattern || pattern !== s.pattern || seen.has(pattern)) continue;
        seen.add(pattern);
        sites.push({ pattern, enabled: s.enabled !== false, builtIn: builtIns.has(pattern) });
      }
    }
    for (const p of builtIns) if (!seen.has(p)) sites.push({ pattern: p, enabled: true, builtIn: true });
    return { version: 1, enabled: r.enabled !== false, sites };
  }
  async function loadSettings() {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    return sanitizeSettings(got[STORAGE_KEY]);
  }
  async function saveSettings(settings) {
    await chrome.storage.local.set({ [STORAGE_KEY]: sanitizeSettings(settings) });
  }

  // src/registration.ts
  var SCRIPT_ID = "secretsentry";
  var queue = Promise.resolve();
  function reconcileContentScripts() {
    const run = queue.then(reconcile, reconcile);
    queue = run.catch(() => void 0);
    return run;
  }
  async function reconcile() {
    const settings = await loadSettings();
    const wanted = settings.enabled ? settings.sites.filter((s) => s.enabled).map((s) => permissionOrigin(s.pattern)) : [];
    const matches = [];
    for (const origin of new Set(wanted)) {
      if (await chrome.permissions.contains({ origins: [origin] })) matches.push(origin);
    }
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (matches.length === 0) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      return [];
    }
    const script = {
      id: SCRIPT_ID,
      matches,
      js: ["content.js"],
      runAt: "document_start",
      allFrames: false,
      persistAcrossSessions: true
    };
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else {
      try {
        await chrome.scripting.registerContentScripts([script]);
      } catch {
        await chrome.scripting.updateContentScripts([script]);
      }
    }
    return matches;
  }

  // src/background.ts
  async function sync() {
    try {
      await reconcileContentScripts();
    } catch (e) {
      console.error("SecretSentry: could not update site registration", e);
    }
  }
  chrome.runtime.onInstalled.addListener(async () => {
    await saveSettings(await loadSettings());
    await sync();
  });
  chrome.runtime.onStartup.addListener(sync);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && STORAGE_KEY in changes) void sync();
  });
  chrome.permissions.onAdded.addListener(sync);
  chrome.permissions.onRemoved.addListener(sync);
})();
