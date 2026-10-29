import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { BrowserContext, Page, Worker } from "playwright";

/**
 * Loads the real extension (dist-e2e/, which adds http://127.0.0.1 to the
 * built-in sites) into Chromium and drives it with real keystrokes.
 * The dialog's shadow root is closed, so the test can only use the keyboard,
 * just like a person would.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ext = join(root, "dist-e2e");
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "chat-page.html"));

// Fake secrets, built at runtime so no key-shaped string is stored in the repo.
const STRIPE = "sk_live_" + "Zq8XvP2mK9LwR4tN7bY1cH5j";
const AWS = "AKIA" + "QWERTYUIOPASDFGH".split("").reverse().join("");

let server: ReturnType<typeof createServer>;
let port = 0;
let context: BrowserContext;
let sw: Worker;

before(async () => {
  server = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(html));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "ss-profile-")), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    permissions: ["clipboard-read", "clipboard-write"],
  });
  context.setDefaultTimeout(5000);
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  // Wait until the background has registered the content script.
  for (let i = 0; i < 50; i++) {
    const n = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
    if (n) break;
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(async () => {
  await context?.close();
  server?.close();
});

async function openChat(host = "127.0.0.1"): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`http://${host}:${port}/`);
  return page;
}
const dialog = (p: Page) => p.locator("secretsentry-warning");
const sent = (p: Page) => p.locator("#sent li").allTextContents();

async function paste(page: Page, selector: string, text: string): Promise<void> {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.click(selector);
  await page.keyboard.press("ControlOrMeta+V");
}

const notice = (p: Page) => p.locator("secretsentry-notice");
const noticeButton = (p: Page, name: string) => notice(p).getByRole("button", { name });
const focusedId = (p: Page) => p.evaluate(() => document.activeElement?.id);

test("pasted secrets stay visible and editable, with a heads-up that doesn't steal focus", async () => {
  const page = await openChat();
  await paste(page, "#ta", `my key is ${STRIPE} thanks`);
  await notice(page).waitFor({ state: "attached" });
  assert.equal(await page.inputValue("#ta"), `my key is ${STRIPE} thanks`, "the paste lands as normal");
  assert.equal(await focusedId(page), "ta", "focus stays in the chat box");

  // The heads-up sits next to the chat box, not on top of it.
  const box = (await notice(page).locator(".box").boundingBox())!;
  const ta = (await page.locator("#ta").boundingBox())!;
  assert.ok(box.y >= ta.y + ta.height || box.y + box.height <= ta.y, "heads-up must not cover the chat box");

  await page.keyboard.type("!!");
  await page.keyboard.press("Backspace");
  assert.equal(await page.inputValue("#ta"), `my key is ${STRIPE} thanks!`, "typing and Backspace work");
  await notice(page).waitFor({ state: "attached" });

  await noticeButton(page, "Replace with placeholders").click();
  await notice(page).waitFor({ state: "detached" });
  assert.equal(await page.inputValue("#ta"), "my key is [STRIPE_SECRET_KEY_1] thanks!");
  assert.equal(await focusedId(page), "ta");
  await page.close();
});

test("the heads-up goes away when you delete the secret yourself", async () => {
  const page = await openChat();
  await paste(page, "#ta", STRIPE);
  await notice(page).waitFor({ state: "attached" });
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await notice(page).waitFor({ state: "detached" });
  assert.equal(await page.inputValue("#ta"), "");
  await page.close();
});

test("heads-up: Remove drops the secret; × dismisses it, and Send is still guarded", async () => {
  const page = await openChat();
  await paste(page, "#ta", `key ${AWS} end`);
  await notice(page).waitFor({ state: "attached" });
  await noticeButton(page, "Remove it").click();
  assert.equal(await page.inputValue("#ta"), "key  end");

  await page.fill("#ta", "");
  await paste(page, "#ta", `key ${AWS} end`);
  await noticeButton(page, "Dismiss").click();
  await notice(page).waitFor({ state: "detached" });
  assert.equal(await page.inputValue("#ta"), `key ${AWS} end`);
  await page.keyboard.type(" more"); // editing after dismissing doesn't bring it back
  await page.waitForTimeout(300);
  assert.equal(await notice(page).count(), 0);
  await page.press("#ta", "Enter");
  await dialog(page).waitFor({ state: "attached" });
  assert.deepEqual(await sent(page), [], "Send is the hard stop");
  await page.keyboard.press("Escape");
  await page.close();
});

test("Enter with a secret is blocked until you decide; Send anyway sends once", async () => {
  const page = await openChat();
  await page.fill("#ta", `deploy with ${STRIPE}`);
  await page.press("#ta", "Enter");
  await dialog(page).waitFor({ state: "attached" });
  assert.deepEqual(await sent(page), [], "nothing sent while the dialog is open");
  await page.waitForTimeout(600); // "Send anyway" is disabled for the first moment (anti-clickjacking)
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab"); // -> Send anyway
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("#sent li").length === 1);
  assert.deepEqual(await sent(page), [`deploy with ${STRIPE}`]);

  // Approval was for that message only.
  await page.fill("#ta", `again ${STRIPE}`);
  await page.press("#ta", "Enter");
  await dialog(page).waitFor({ state: "attached" });
  await page.keyboard.press("Escape");
  assert.equal((await sent(page)).length, 1);
  await page.close();
});

test("clicking Send with a secret: Replace updates the box and does not send", async () => {
  const page = await openChat();
  await page.fill("#ta", `token ${STRIPE}`);
  await page.click("#send");
  await dialog(page).waitFor({ state: "attached" });
  await page.keyboard.press("Enter");
  await dialog(page).waitFor({ state: "detached" });
  assert.equal(await page.inputValue("#ta"), "token [STRIPE_SECRET_KEY_1]");
  assert.deepEqual(await sent(page), []);
  await page.click("#send");
  assert.deepEqual(await sent(page), ["token [STRIPE_SECRET_KEY_1]"]);
  await page.close();
});

test("rich-text editors (contenteditable) are covered too", async () => {
  const page = await openChat();
  await paste(page, "#ce", `use ${AWS} please`);
  await notice(page).waitFor({ state: "attached" });
  assert.equal((await page.innerText("#ce")).trim(), `use ${AWS} please`);
  await noticeButton(page, "Replace with placeholders").click();
  await notice(page).waitFor({ state: "detached" });
  assert.equal((await page.innerText("#ce")).trim(), "use [AWS_ACCESS_KEY_ID_1] please");
  await page.close();
});

test("clean messages go straight through", async () => {
  const page = await openChat();
  await page.fill("#ta", "how do I rotate an API key?");
  await page.press("#ta", "Enter");
  assert.deepEqual(await sent(page), ["how do I rotate an API key?"]);
  assert.equal(await dialog(page).count(), 0);
  await page.close();
});

test("the page can't read or press the dialog, and removing it counts as Cancel", async () => {
  const page = await openChat();
  await page.fill("#ta", `x ${STRIPE}`);
  await page.press("#ta", "Enter");
  await dialog(page).waitFor({ state: "attached" });
  assert.equal(await page.evaluate(() => document.querySelector("secretsentry-warning")!.shadowRoot), null);
  await page.evaluate(() => document.querySelector("secretsentry-warning")!.remove());
  await page.waitForTimeout(100);
  assert.deepEqual(await sent(page), []);
  // Nothing was sent, and the next Enter is checked again.
  await page.press("#ta", "Enter");
  await dialog(page).waitFor({ state: "attached" });
  await page.keyboard.press("Escape");
  assert.deepEqual(await sent(page), []);
  await page.close();
});

test("editing the chat box while the send popup is open updates it, and it closes once the secret is gone", async () => {
  const page = await openChat();
  await page.fill("#ta", `hey, testing ${STRIPE}`);
  await page.press("#ta", "Enter");
  await dialog(page).waitFor({ state: "attached" });
  await page.click("#ta"); // go back to the chat box and fix it by hand
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("hey, testing without the key");
  await dialog(page).waitFor({ state: "detached" });
  assert.deepEqual(await sent(page), [], "closing the popup never sends");
  await page.press("#ta", "Enter");
  assert.deepEqual(await sent(page), ["hey, testing without the key"]);
  await page.close();
});

test("the × on the send popup closes it without sending", async () => {
  const page = await openChat();
  await page.fill("#ta", `close ${STRIPE}`);
  await page.press("#ta", "Enter");
  await dialog(page).waitFor({ state: "attached" });
  await page.keyboard.press("Shift+Tab"); // from Replace, wraps to ×
  await page.keyboard.press("Enter");
  await dialog(page).waitFor({ state: "detached" });
  assert.deepEqual(await sent(page), []);
  assert.equal(await page.inputValue("#ta"), `close ${STRIPE}`);
  await page.close();
});

test("Send anyway pressed in the first moment is ignored", async () => {
  const page = await openChat();
  await page.fill("#ta", `fast ${STRIPE}`);
  await page.press("#ta", "Enter");
  await dialog(page).waitFor({ state: "attached" });
  for (const k of ["Tab", "Tab", "Tab", "Enter"]) await page.keyboard.press(k);
  await page.waitForTimeout(100);
  assert.deepEqual(await sent(page), []);
  assert.equal(await dialog(page).count(), 1, "dialog still open");
  await page.keyboard.press("Escape");
  await page.close();
});

test("page CSS can't hide the dialog, and restyling it cancels", async () => {
  const page = await openChat();
  await page.addStyleTag({ content: "secretsentry-warning { display: none !important; opacity: 0 !important; transform: translateX(-9999px) !important; }" });
  await page.fill("#ta", `css ${STRIPE}`);
  await page.press("#ta", "Enter");
  await dialog(page).waitFor({ state: "attached" });
  const shown = await page.evaluate(() => {
    const h = document.querySelector("secretsentry-warning")!;
    const cs = getComputedStyle(h);
    return { display: cs.display, opacity: cs.opacity, transform: cs.transform, open: h.matches(":popover-open") };
  });
  assert.deepEqual(shown, { display: "block", opacity: "1", transform: "none", open: true });
  await page.evaluate(() => document.querySelector("secretsentry-warning")!.setAttribute("style", "opacity:0"));
  await dialog(page).waitFor({ state: "detached" });
  assert.deepEqual(await sent(page), []);
  await page.close();
});

test("clicking Send on a box that was never focused is still checked", async () => {
  const page = await openChat();
  await page.evaluate((v) => ((document.getElementById("ta") as HTMLTextAreaElement).value = v), `draft ${STRIPE}`);
  await page.click("#send");
  await dialog(page).waitFor({ state: "attached" });
  assert.deepEqual(await sent(page), []);
  await page.keyboard.press("Escape");
  await page.close();
});

test("chat boxes inside web components are covered", async () => {
  const page = await openChat();
  const inner = page.locator("#wc").locator("#inner");
  await inner.fill(`wc ${STRIPE}`);
  await inner.press("Enter");
  await dialog(page).waitFor({ state: "attached" });
  assert.deepEqual(await sent(page), []);
  await page.keyboard.press("Escape");
  await page.close();
});

test("sites that aren't on the list are never scanned", async () => {
  const page = await openChat("localhost");
  await page.fill("#ta", `secret ${STRIPE}`);
  await page.press("#ta", "Enter");
  assert.deepEqual(await sent(page), [`secret ${STRIPE}`]);
  assert.equal(await dialog(page).count(), 0);
  const registered = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts())[0]?.matches ?? []);
  assert.ok(!registered.some((m: string) => m.includes("localhost")));
  await page.close();
});

test("turning protection off takes effect on open pages", async () => {
  const page = await openChat();
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...(settings as object), enabled: false } });
  });
  await page.waitForTimeout(150);
  await page.fill("#ta", `off ${STRIPE}`);
  await page.press("#ta", "Enter");
  assert.deepEqual(await sent(page), [`off ${STRIPE}`]);
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...(settings as object), enabled: true } });
  });
  await page.close();
});

test("storage holds only settings: no secrets, no history", async () => {
  const all = await sw.evaluate(() => chrome.storage.local.get(null));
  assert.deepEqual(Object.keys(all), ["settings"]);
  const json = JSON.stringify(all);
  for (const s of [STRIPE, AWS, "STRIPE_SECRET_KEY", "deploy with"]) assert.ok(!json.includes(s), `storage contains ${s}`);
  const session = await sw.evaluate(() => chrome.storage.session.get(null));
  assert.deepEqual(session, {});
});
