import { reconcileContentScripts } from "./registration.ts";
import { STORAGE_KEY, loadSettings, saveSettings } from "./settings.ts";

/**
 * Background service worker. Its only job is keeping the content script
 * registered on the right sites. It never sees page text.
 */

async function sync(): Promise<void> {
  try {
    await reconcileContentScripts();
  } catch (e) {
    console.error("SecretSentry: could not update site registration", e);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await saveSettings(await loadSettings()); // writes defaults on first install, keeps user choices on update
  await sync();
});
chrome.runtime.onStartup.addListener(sync);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && STORAGE_KEY in changes) void sync();
});
chrome.permissions.onAdded.addListener(sync);
chrome.permissions.onRemoved.addListener(sync);
