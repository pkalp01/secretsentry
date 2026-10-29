import { loadSettings, saveSettings, MAX_SITES } from "./settings.ts";
import { normalizeSitePattern, permissionOrigin } from "./sites.ts";
import type { Settings } from "./settings.ts";
import { reconcileContentScripts } from "./registration.ts";

/** Shared by the toolbar popup and the settings page. */

export type AddResult = { ok: true; pattern: string } | { ok: false; error: string };

/**
 * Adds a site. Must be called from a click handler: the browser shows its own
 * permission prompt, and the site is added only if the user approves.
 */
export async function addSite(input: string): Promise<AddResult> {
  const pattern = normalizeSitePattern(input);
  if (!pattern) {
    return { ok: false, error: "Enter a site like chat.example.com. Use https (http works only for localhost)." };
  }
  // Ask first, while the click still counts as a user gesture.
  const granted = await chrome.permissions.request({ origins: [permissionOrigin(pattern)] });
  if (!granted) return { ok: false, error: "Access wasn't granted, so the site wasn't added." };

  const settings = await loadSettings();
  const existing = settings.sites.find((s) => s.pattern === pattern);
  if (!existing && settings.sites.length >= MAX_SITES) return { ok: false, error: `You can add up to ${MAX_SITES} sites.` };

  if (existing) existing.enabled = true;
  else settings.sites.push({ pattern, enabled: true, builtIn: false });
  await commit(settings);
  return { ok: true, pattern };
}

export async function setSiteEnabled(pattern: string, enabled: boolean): Promise<void> {
  // Turning a site on re-asks for access if it was revoked (returns true at once if still granted).
  if (enabled && !(await chrome.permissions.request({ origins: [permissionOrigin(pattern)] }))) return;
  const settings = await loadSettings();
  const site = settings.sites.find((s) => s.pattern === pattern);
  if (!site) return;
  site.enabled = enabled;
  await commit(settings);
}

/** Removes a site you added, and gives its access back to the browser. */
export async function removeSite(pattern: string): Promise<void> {
  const settings = await loadSettings();
  const site = settings.sites.find((s) => s.pattern === pattern);
  if (!site || site.builtIn) return;
  settings.sites = settings.sites.filter((s) => s.pattern !== pattern);
  await commit(settings);
  const origin = permissionOrigin(pattern);
  const stillUsed = settings.sites.some((s) => permissionOrigin(s.pattern) === origin);
  if (!stillUsed) await chrome.permissions.remove({ origins: [origin] }).catch(() => false);
}

export async function setEnabled(enabled: boolean): Promise<void> {
  const settings = await loadSettings();
  settings.enabled = enabled;
  await commit(settings);
}

async function commit(settings: Settings): Promise<void> {
  await saveSettings(settings);
  // The background also does this on every settings change; doing it here makes it immediate.
  await reconcileContentScripts().catch(() => undefined);
}
