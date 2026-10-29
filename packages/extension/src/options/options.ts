import { loadSettings, STORAGE_KEY } from "../settings.ts";
import { displayName } from "../sites.ts";
import { addSite, removeSite, setEnabled, setSiteEnabled } from "../site-actions.ts";
import { RULESET } from "../ruleset.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function render(): Promise<void> {
  const settings = await loadSettings();
  $("version").textContent = `Version ${chrome.runtime.getManifest().version} · ${RULESET.ruleCount} detection rules (${RULESET.version})`;
  $<HTMLInputElement>("enabled").checked = settings.enabled;

  const list = $("sites");
  const items = [...settings.sites].sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || displayName(a.pattern).localeCompare(displayName(b.pattern)));
  list.replaceChildren(
    ...items.map((site) => {
      const li = document.createElement("li");
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.className = "switch";
      toggle.checked = site.enabled;
      toggle.setAttribute("aria-label", `Protect ${displayName(site.pattern)}`);
      toggle.addEventListener("change", async () => {
        await setSiteEnabled(site.pattern, toggle.checked);
        await render();
      });
      const name = document.createElement("span");
      name.className = "name mono";
      name.textContent = displayName(site.pattern);
      li.append(toggle, name);
      if (site.builtIn) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "built in";
        li.append(tag);
      } else {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "link";
        remove.textContent = "Remove";
        remove.addEventListener("click", async () => {
          await removeSite(site.pattern);
          await render();
        });
        li.append(remove);
      }
      return li;
    }),
  );
}

$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("newSite");
  const result = await addSite(input.value);
  $("error").textContent = result.ok ? "" : result.error;
  if (result.ok) input.value = "";
  await render();
});
$<HTMLInputElement>("enabled").addEventListener("change", async (e) => {
  await setEnabled((e.target as HTMLInputElement).checked);
  await render();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && STORAGE_KEY in changes) void render();
});
void render();
