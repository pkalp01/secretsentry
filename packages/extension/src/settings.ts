import { DEFAULT_SITE_PATTERNS, E2E_SITE_PATTERNS, normalizeSitePattern } from "./sites.ts";
import type { Site } from "./sites.ts";

/**
 * The ONLY thing SecretSentry ever saves: an on/off switch and the site list.
 * It is stored with chrome.storage.local (this device only; not synced to
 * your browser account). No secrets, no message text, no history.
 */
export interface Settings {
  version: 1;
  enabled: boolean;
  sites: Site[];
}

export const STORAGE_KEY = "settings";
export const MAX_SITES = 200;

declare const __E2E__: boolean;
const isE2E = typeof __E2E__ !== "undefined" && __E2E__;

export function builtInPatterns(): string[] {
  return [...DEFAULT_SITE_PATTERNS, ...(isE2E ? E2E_SITE_PATTERNS : [])];
}

export function defaultSettings(): Settings {
  return { version: 1, enabled: true, sites: builtInPatterns().map((pattern) => ({ pattern, enabled: true, builtIn: true })) };
}

/**
 * Validates whatever is in storage. Anything malformed is dropped, so a
 * tampered or corrupted value can never widen where the extension runs.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const builtIns = new Set(builtInPatterns());
  const seen = new Set<string>();
  const sites: Site[] = [];

  if (Array.isArray(r.sites)) {
    for (const item of r.sites.slice(0, MAX_SITES)) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      if (typeof s.pattern !== "string") continue;
      const pattern = builtIns.has(s.pattern) ? s.pattern : normalizeSitePattern(s.pattern);
      if (!pattern || pattern !== s.pattern || seen.has(pattern)) continue;
      seen.add(pattern);
      sites.push({ pattern, enabled: s.enabled !== false, builtIn: builtIns.has(pattern) });
    }
  }
  // Built-in sites always exist (a newer version may ship new ones).
  for (const p of builtIns) if (!seen.has(p)) sites.push({ pattern: p, enabled: true, builtIn: true });

  return { version: 1, enabled: r.enabled !== false, sites };
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeSettings(got[STORAGE_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: sanitizeSettings(settings) });
}
