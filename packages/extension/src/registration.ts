import { loadSettings } from "./settings.ts";
import { permissionOrigin } from "./sites.ts";

/**
 * Makes the registered content script match exactly the origins of enabled
 * sites the user has granted access to. A site that is off, removed, or whose
 * permission was revoked gets no script at all.
 *
 * Registration is per origin (https://huggingface.co/*) so that in-app
 * navigation into a listed path still works; the content script then checks
 * the full pattern (https://huggingface.co/chat/*) on every event and does
 * nothing outside it.
 */
export const SCRIPT_ID = "secretsentry";

let queue: Promise<unknown> = Promise.resolve();

/** Serialized, so overlapping calls can't race into a "duplicate script id" error. */
export function reconcileContentScripts(): Promise<string[]> {
  const run = queue.then(reconcile, reconcile);
  queue = run.catch(() => undefined);
  return run;
}

async function reconcile(): Promise<string[]> {
  const settings = await loadSettings();
  const wanted = settings.enabled ? settings.sites.filter((s) => s.enabled).map((s) => permissionOrigin(s.pattern)) : [];

  const matches: string[] = [];
  for (const origin of new Set(wanted)) {
    if (await chrome.permissions.contains({ origins: [origin] })) matches.push(origin);
  }

  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (matches.length === 0) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return [];
  }
  const script: chrome.scripting.RegisteredContentScript = {
    id: SCRIPT_ID,
    matches,
    js: ["content.js"],
    runAt: "document_start",
    allFrames: false,
    persistAcrossSessions: true,
  };
  if (existing.length) await chrome.scripting.updateContentScripts([script]);
  else {
    try {
      await chrome.scripting.registerContentScripts([script]);
    } catch {
      await chrome.scripting.updateContentScripts([script]); // registered by another context meanwhile
    }
  }
  return matches;
}
