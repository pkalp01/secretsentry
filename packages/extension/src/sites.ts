/**
 * Site list: which pages SecretSentry is allowed to run on.
 * Pure functions only, so they can be unit tested without a browser.
 */

export interface Site {
  /** Chrome match pattern, e.g. "https://chatgpt.com/*". */
  pattern: string;
  enabled: boolean;
  /** Shipped with the extension. Can be turned off, not removed. */
  builtIn: boolean;
}

/** Popular AI chat sites, enabled out of the box. Keep in sync with manifest host_permissions. */
export const DEFAULT_SITE_PATTERNS: readonly string[] = [
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
  "https://huggingface.co/chat/*",
];

/** Only used by the end-to-end test build (`npm run build:e2e`). */
export const E2E_SITE_PATTERNS: readonly string[] = ["http://127.0.0.1/*"];

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const PATH = /^\/(?:[A-Za-z0-9._~!$&'()+,;=:@%\-/]*\*)?$/;

/**
 * Turns what a user types ("chat.example.com", "https://chat.example.com/x")
 * into a safe match pattern ("https://chat.example.com/*"), or returns null.
 *
 * Rules: https only (plain http only for localhost / 127.0.0.1, for local AI
 * tools), one exact host per entry (no wildcards, so "*.github.io" can't
 * cover thousands of sites), no IP ranges, no ports (Chrome patterns can't
 * express them anyway). The path keeps its case, because URLs are
 * case-sensitive.
 */
export function normalizeSitePattern(input: string): string | null {
  let s = input.trim();
  if (!s || s.length > 253) return null;
  let scheme = "https";
  const schemeMatch = s.match(/^([A-Za-z]+):\/\//);
  if (schemeMatch) {
    scheme = schemeMatch[1]!.toLowerCase();
    s = s.slice(schemeMatch[0].length);
  }
  const slash = s.indexOf("/");
  let host = (slash === -1 ? s : s.slice(0, slash)).toLowerCase();
  let path = slash === -1 ? "/*" : s.slice(slash);
  host = host.replace(/:\d+$/, ""); // drop a port
  if (host.includes("@")) return null; // user:pass@host tricks
  if (scheme !== "https" && !(scheme === "http" && LOCAL_HOSTS.has(host))) return null;
  if (!LOCAL_HOSTS.has(host) && !HOST.test(host)) return null;
  // Keep a meaningful path prefix only (e.g. huggingface.co/chat/*). Drop query and hash.
  path = path.replace(/[?#].*$/, "");
  if (!path.endsWith("*")) path = path.replace(/\/?$/, "/*");
  if (path !== "/*" && !path.endsWith("/*")) path = path.replace(/\*$/, "/*");
  if (!PATH.test(path)) return null;
  return `${scheme}://${host}${path}`;
}

/** Host part of a pattern, for display: "https://chatgpt.com/*" -> "chatgpt.com". */
export function displayName(pattern: string): string {
  const m = pattern.match(/^[a-z]+:\/\/([^/]+)(\/.*)$/);
  if (!m) return pattern;
  const path = m[2] === "/*" ? "" : m[2]!.replace(/\/\*$/, "");
  return m[1] + path;
}

/** Does a match pattern cover this URL? Mirrors Chrome's match-pattern rules for our subset. */
export function patternMatchesUrl(pattern: string, url: string): boolean {
  const m = pattern.match(/^([a-z]+):\/\/([^/]+)(\/.*)$/);
  if (!m) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const [, scheme, host, path] = m as unknown as [string, string, string, string];
  if (u.protocol !== `${scheme}:`) return false;
  if (u.hostname.toLowerCase() !== host) return false;
  const prefix = path.replace(/\*$/, "");
  const target = u.pathname;
  return target.startsWith(prefix) || `${target}/` === prefix;
}

/** Origin pattern for a permission request: path dropped, since host permissions ignore it. */
export function permissionOrigin(pattern: string): string {
  return pattern.replace(/^([a-z]+:\/\/[^/]+)\/.*$/, "$1/*");
}

/** The site entry that covers this URL. An enabled match wins over a disabled one. */
export function siteForUrl(sites: readonly Site[], url: string): Site | undefined {
  const matching = sites.filter((s) => patternMatchesUrl(s.pattern, url));
  return matching.find((s) => s.enabled) ?? matching[0];
}

/** Should the checker act on this URL right now? Re-evaluated on every event, so in-app navigation is respected. */
export function isProtected(sites: readonly Site[], url: string): boolean {
  return sites.some((s) => s.enabled && patternMatchesUrl(s.pattern, url));
}
