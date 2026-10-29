import { loadSettings } from "../settings.ts";
import { siteForUrl, displayName, normalizeSitePattern } from "../sites.ts";
import { addSite, setEnabled, setSiteEnabled } from "../site-actions.ts";
import { RULESET } from "../ruleset.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (primary) b.className = "primary";
  b.addEventListener("click", onClick);
  return b;
}

async function render(): Promise<void> {
  const settings = await loadSettings();
  $("rules").textContent = `${RULESET.ruleCount} detection rules · v${chrome.runtime.getManifest().version}`;
  $<HTMLInputElement>("enabled").checked = settings.enabled;

  // activeTab: the URL is available only because you clicked the toolbar icon.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  const actions = $("siteActions");
  actions.replaceChildren();
  $("error").textContent = "";
  const status = $("status");

  let host = "";
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") host = u.hostname;
  } catch {
    /* not a web page */
  }
  $("host").textContent = host;

  if (!host) {
    status.className = "status";
    $("statusText").textContent = "Not a web page";
    return;
  }
  const site = siteForUrl(settings.sites, url);
  const on = settings.enabled && !!site?.enabled;
  status.className = on ? "status on" : "status";
  $("statusText").textContent = !settings.enabled ? "SecretSentry is off" : on ? `Protecting ${displayName(site!.pattern)}` : "Not active on this site";

  if (!settings.enabled) return;
  const reload = () => tab?.id !== undefined && chrome.tabs.reload(tab.id);
  if (site) {
    actions.append(
      site.enabled
        ? button("Turn off for this site", false, async () => { await setSiteEnabled(site.pattern, false); await render(); })
        : button("Turn on for this site", true, async () => { await setSiteEnabled(site.pattern, true); await render(); actions.append(button("Reload page to apply", false, reload)); }),
    );
  } else if (normalizeSitePattern(url)) {
    actions.append(
      button(`Add ${host}`, true, async () => {
        const r = await addSite(`${new URL(url).protocol}//${host}`);
        if (!r.ok) {
          $("error").textContent = r.error;
          return;
        }
        await render();
        actions.append(button("Reload page to apply", false, reload));
      }),
    );
  }
}

$<HTMLInputElement>("enabled").addEventListener("change", async (e) => {
  await setEnabled((e.target as HTMLInputElement).checked);
  await render();
});
$("manage").addEventListener("click", () => chrome.runtime.openOptionsPage());
void render();
