import type { Finding } from "@infodetector/core";
import type { Choice } from "./decide.ts";
import { computePlacement, visualBounds } from "./placement.ts";

/**
 * The warning shown above the chat box.
 *
 * Security notes:
 *  - Lives in a CLOSED shadow root, so page scripts can't read its contents.
 *  - Shown in the browser's top layer (popover), above anything the page draws.
 *  - The host carries inline !important styles that page CSS can't override,
 *    and any change to its attributes counts as Cancel.
 *  - Built only with createElement/textContent, never HTML strings.
 *  - Ignores synthetic events (isTrusted === false), so a page script can't
 *    click "Send anyway" for you.
 *  - "Send anyway" only works after the dialog has been on screen for a
 *    moment AND the browser confirms it is actually visible (not covered,
 *    not transparent). This defeats clickjacking.
 *  - If the page removes it, that counts as Cancel: nothing is sent.
 */

export type DialogMode = "paste" | "send";

/** Hosts we created, so events from them can be recognized by reference (a page can fake a tag name). */
export const ownHosts = new WeakSet<Element>();

const ALLOW_DELAY_MS = 500;

const HOST_STYLE = [
  "all: initial !important",
  "display: block !important",
  "position: fixed !important",
  "inset: 0 !important",
  "width: 100vw !important",
  "height: 100vh !important",
  "margin: 0 !important",
  "padding: 0 !important",
  "border: 0 !important",
  "background: transparent !important",
  "overflow: visible !important",
  "pointer-events: none !important",
  "opacity: 1 !important",
  "visibility: visible !important",
  "transform: none !important",
  "filter: none !important",
  "clip-path: none !important",
  "z-index: 2147483647 !important",
].join("; ");

function mountHost(tag: string): HTMLElement {
  const host = document.createElement(tag);
  ownHosts.add(host);
  host.setAttribute("popover", "manual");
  host.style.cssText = HOST_STYLE;
  (document.body ?? document.documentElement).append(host);
  try {
    host.showPopover(); // top layer: above every z-index on the page
  } catch {
    /* older browser: fixed position + max z-index still applies */
  }
  return host;
}

const CSS = `
:host { all: initial; }
.box { position: fixed; z-index: 2147483647; pointer-events: auto; box-sizing: border-box; overflow-y: auto; width: min(420px, calc(100vw - 24px));
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #17202c; background: #fff;
  border: 1px solid #e3b25e; border-radius: 12px; box-shadow: 0 12px 32px rgba(15, 23, 42, .22); padding: 14px; }
.head { display: flex; gap: 10px; align-items: flex-start; }
.icon { flex: none; width: 28px; height: 28px; border-radius: 8px; background: #fdf1dc; color: #9a5300;
  display: grid; place-items: center; font-weight: 700; }
h2 { margin: 0; font-size: 15px; font-weight: 650; }
.sub { margin: 2px 0 0; font-size: 12.5px; color: #5b6676; }
ul { list-style: none; margin: 10px 0; padding: 0; display: grid; gap: 6px; max-height: 180px; overflow: auto; }
li { border: 1px solid #e4e8ee; border-radius: 8px; padding: 7px 9px; display: grid; gap: 1px; }
.label { font-weight: 600; font-size: 13.5px; display: flex; justify-content: space-between; gap: 8px; }
.conf { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #9a5300; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #5b6676; overflow-wrap: anywhere; }
.why { font-size: 12px; color: #5b6676; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button { font: 600 13px system-ui, -apple-system, "Segoe UI", sans-serif; border-radius: 8px; padding: 8px 12px; cursor: pointer;
  border: 1px solid #cfd6df; background: #fff; color: #17202c; }
button.primary { background: #1f4fbf; border-color: #1f4fbf; color: #fff; }
button.danger { margin-left: auto; background: transparent; border-color: transparent; color: #8a1c1c; text-decoration: underline; }
button:focus-visible { outline: 2px solid #1f4fbf; outline-offset: 2px; }
.brand { margin-top: 8px; font-size: 11px; color: #8a94a3; }
.head { padding-right: 28px; }
button.close { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: #5b6676; font: 400 20px/1 system-ui, sans-serif; display: grid; place-items: center; }
button.close:hover { background: rgba(127, 127, 127, .15); }
@media (prefers-color-scheme: dark) {
  .box { background: #161b22; color: #e6eaf0; border-color: #6b4a1c; }
  .icon { background: #2a1f10; color: #f3a63b; }
  .sub, code, .why { color: #9aa5b5; }
  li { border-color: #2a3240; }
  .conf { color: #f3a63b; }
  button { background: #1c222c; color: #e6eaf0; border-color: #2f3846; }
  button.primary { background: #7da3ff; border-color: #7da3ff; color: #0d1016; }
  button.danger { background: transparent; border-color: transparent; color: #ff9b9b; }
  button.close { background: transparent; color: #9aa5b5; }
}
@media (prefers-reduced-motion: no-preference) { .box { animation: in .14s ease-out; } }
@keyframes in { from { opacity: 0; transform: translateY(6px); } }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderList(list: HTMLElement, findings: Finding[]): void {
  list.replaceChildren(
    ...findings.slice(0, 20).map((f) => {
      const li = el("li");
      const label = el("div", "label");
      label.append(el("span", undefined, f.label), el("span", "conf", f.confidence));
      li.append(label, el("code", undefined, f.preview), el("span", "why", f.reason));
      return li;
    }),
  );
}

function titleFor(findings: Finding[]): string {
  return findings.length === 1 ? `This looks like a ${findings[0]!.label}` : `${findings.length} possible secrets found`;
}

/** Puts the box next to the chat box without covering it; it scrolls inside if space is short. */
function placeNear(box: HTMLElement, anchor: Element, fallbackHeight: number): void {
  box.style.maxHeight = "none";
  const natural = box.scrollHeight || fallbackHeight;
  const p = computePlacement(visualBounds(anchor), window.innerWidth, window.innerHeight, natural);
  box.style.left = `${p.left}px`;
  box.style.top = `${p.top}px`;
  box.style.maxHeight = `${p.maxHeight}px`;
}

let open: Promise<Choice> | null = null;

export function isDialogOpen(): boolean {
  return open !== null;
}

/**
 * The send-time popup. If you click back into the chat box and edit while it's
 * open, `rescan` re-checks the box: the popup updates, and closes by itself
 * once no secret is left (nothing is sent; press Send again when ready).
 */
export function showDialog(mode: DialogMode, findings: Finding[], anchor: Element, rescan?: () => Finding[]): Promise<Choice> {
  if (open) return Promise.resolve("cancel");

  open = new Promise<Choice>((resolve) => {
    const host = document.createElement("secretsentry-warning");
    const root = host.attachShadow({ mode: "closed" });
    const shownAt = performance.now();
    let visible = false;
    const style = el("style");
    style.textContent = CSS;
    const box = el("div", "box");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");

    const n = findings.length;
    const head = el("div", "head");
    const text = el("div");
    const h2 = el("h2", undefined, titleFor(findings));
    h2.id = "t";
    box.setAttribute("aria-labelledby", "t");
    text.append(h2, el("p", "sub", mode === "paste" ? "Checked on this device before pasting. Nothing was saved or sent." : "Checked on this device before sending. Nothing was saved or sent."));
    head.append(el("div", "icon", "!"), text);

    const list = el("ul");
    renderList(list, findings);

    const actions = el("div", "actions");
    const verb = mode === "paste" ? "Paste" : "Send";
    const btnReplace = el("button", "primary", "Replace with placeholders");
    const btnRemove = el("button", undefined, n === 1 ? "Remove it" : "Remove them");
    const btnAllow = el("button", "danger", `${verb} anyway`);
    const btnCancel = el("button", undefined, "Cancel");
    const btnClose = el("button", "close", "×");
    btnClose.setAttribute("aria-label", "Close");
    btnClose.title = "Close (nothing is sent)";
    for (const b of [btnReplace, btnRemove, btnCancel, btnAllow, btnClose]) b.type = "button";
    actions.append(btnReplace, btnRemove, btnCancel, btnAllow);

    box.append(btnClose, head, list, actions, el("div", "brand", "SecretSentry"));

    let done = false;
    const finish = (choice: Choice) => {
      if (done) return;
      done = true;
      observer.disconnect();
      attrObserver.disconnect();
      visibility?.disconnect();
      window.removeEventListener("resize", place, true);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("input", onEdit, true);
      clearTimeout(editTimer);
      host.remove();
      open = null;
      resolve(choice);
    };
    const on = (b: HTMLButtonElement, choice: Choice) =>
      b.addEventListener("click", (e) => {
        if (!e.isTrusted) return; // a page script can't press our buttons
        if (choice === "allow" && (performance.now() - shownAt < ALLOW_DELAY_MS || !visible)) return;
        finish(choice);
      });
    on(btnReplace, "placeholder");
    on(btnRemove, "remove");
    on(btnAllow, "allow");
    on(btnCancel, "cancel");
    on(btnClose, "cancel");
    box.addEventListener("keydown", (e) => {
      // Stops bubbling to the page's own handlers. (Page listeners on window in the
      // capture phase still see key presses, but the dialog holds no secret text.)
      e.stopPropagation();
      if (!e.isTrusted) return;
      if (e.key === "Escape") {
        e.preventDefault();
        finish("cancel");
      }
      if (e.key === "Tab") {
        // Keep focus inside the dialog.
        const order = [btnReplace, btnRemove, btnCancel, btnAllow, btnClose];
        const i = order.indexOf(root.activeElement as HTMLButtonElement);
        e.preventDefault();
        order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length]!.focus();
      }
    });

    function place() {
      placeNear(box, anchor, 260);
    }

    // Keep up with edits made in the chat box while the popup is open.
    let editTimer = 0;
    function onEdit(e: Event) {
      if (!rescan || !e.composedPath().includes(anchor)) return;
      clearTimeout(editTimer);
      editTimer = window.setTimeout(() => {
        let fresh: Finding[];
        try {
          fresh = rescan();
        } catch {
          return;
        }
        if (!fresh.length) return finish("cancel"); // secret gone: nothing to ask about
        h2.textContent = titleFor(fresh);
        btnRemove.textContent = fresh.length === 1 ? "Remove it" : "Remove them";
        renderList(list, fresh);
        place();
      }, 150);
    }
    window.addEventListener("input", onEdit, true);

    // If the page (or anything else) removes the dialog, treat it as Cancel.
    const observer = new MutationObserver(() => {
      if (!host.isConnected) finish("cancel");
    });
    // Any attempt to restyle or hide the host also counts as Cancel.
    const attrObserver = new MutationObserver(() => finish("cancel"));

    root.append(style, box);
    ownHosts.add(host);
    host.setAttribute("popover", "manual");
    host.style.cssText = HOST_STYLE;
    (document.body ?? document.documentElement).append(host);
    try {
      host.showPopover();
    } catch {
      /* older browser: fixed position + max z-index still applies */
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
    attrObserver.observe(host, { attributes: true });
    host.addEventListener("toggle", () => {
      if (!host.matches(":popover-open")) finish("cancel"); // closed by someone else
    });

    // Ask the browser whether the box is really visible (not covered, transparent or off-screen).
    let visibility: IntersectionObserver | undefined;
    try {
      visibility = new IntersectionObserver(
        (entries) => {
          const last = entries[entries.length - 1] as IntersectionObserverEntry & { isVisible?: boolean };
          visible = last.isVisible ?? last.isIntersecting;
        },
        { trackVisibility: true, delay: 100 } as IntersectionObserverInit,
      );
      visibility.observe(box);
    } catch {
      visible = true; // the API is missing; the delay and top layer still apply
    }
    place();
    window.addEventListener("resize", place, true);
    window.addEventListener("scroll", place, true);
    btnReplace.focus();
  });
  return open;
}

// ---------- non-blocking notice after a paste ----------

export type NoticeAction = "placeholder" | "remove" | "dismiss";

export interface Notice {
  /** Re-render with fresh findings (the user kept editing). */
  update(findings: Finding[]): void;
  close(): void;
  readonly anchor: Element;
}

declare const __E2E__: boolean;
let notice: Notice | null = null;

export function currentNotice(): Notice | null {
  return notice;
}

/**
 * A heads-up shown after pasting a secret. Unlike the send dialog it never
 * takes focus, so you can keep typing, deleting and editing in the chat box.
 * Nothing is sent from here: Send is still checked separately.
 */
export function showNotice(findings: Finding[], anchor: Element, onAction: (a: NoticeAction) => void): Notice {
  notice?.close();
  const host = mountHost("secretsentry-notice");
  // The test build uses an open root so tests can click its buttons; real builds keep it closed.
  const root = host.attachShadow({ mode: typeof __E2E__ !== "undefined" && __E2E__ ? "open" : "closed" });
  const style = el("style");
  style.textContent = CSS + `
    .box { padding: 12px; }
    .sub { margin-top: 2px; }
    ul { margin: 8px 0; max-height: 120px; }
    .why { display: none; }
    .actions { align-items: center; }`;
  const box = el("div", "box");
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  const head = el("div", "head");
  const text = el("div");
  const h2 = el("h2");
  text.append(h2, el("p", "sub", "You can keep editing. SecretSentry will ask again before anything is sent."));
  head.append(el("div", "icon", "!"), text);
  const list = el("ul");
  const actions = el("div", "actions");
  const btnReplace = el("button", "primary", "Replace with placeholders");
  const btnRemove = el("button");
  const btnDismiss = el("button", "close", "×");
  btnDismiss.setAttribute("aria-label", "Dismiss");
  btnDismiss.title = "Dismiss. You'll still be asked before sending.";
  for (const b of [btnReplace, btnRemove, btnDismiss]) {
    b.type = "button";
    // Keep the caret in the chat box while clicking.
    b.addEventListener("mousedown", (e) => e.preventDefault());
  }
  actions.append(btnReplace, btnRemove);
  box.append(btnDismiss, head, list, actions);
  root.append(style, box);

  const render = (f: Finding[]) => {
    h2.textContent = titleFor(f);
    btnRemove.textContent = f.length === 1 ? "Remove it" : "Remove them";
    renderList(list, f);
    placeNear(box, anchor, 160);
  };
  const place = () => placeNear(box, anchor, 160);

  let closed = false;
  const self: Notice = {
    anchor,
    update: (f) => (f.length ? render(f) : self.close()),
    close: () => {
      if (closed) return;
      closed = true;
      attrObserver.disconnect();
      window.removeEventListener("resize", place, true);
      window.removeEventListener("scroll", place, true);
      host.remove();
      if (notice === self) notice = null;
    },
  };
  const on = (b: HTMLButtonElement, a: NoticeAction) =>
    b.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      self.close();
      onAction(a);
    });
  on(btnReplace, "placeholder");
  on(btnRemove, "remove");
  on(btnDismiss, "dismiss");

  // If the page restyles it, just close it. It's only a heads-up; Send is still guarded.
  const attrObserver = new MutationObserver(() => self.close());
  attrObserver.observe(host, { attributes: true });
  window.addEventListener("resize", place, true);
  window.addEventListener("scroll", place, true);
  render(findings);
  notice = self;
  return self;
}

/** Small confirmation that disappears on its own. */
export function showToast(message: string, anchor: Element): void {
  const host = mountHost("secretsentry-toast");
  const root = host.attachShadow({ mode: "closed" });
  const style = el("style");
  style.textContent = `:host{all:initial}.t{position:fixed;z-index:2147483647;font:13px system-ui,-apple-system,"Segoe UI",sans-serif;
    background:#17202c;color:#fff;padding:8px 12px;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.25)}`;
  const t = el("div", "t", message);
  t.setAttribute("role", "status");
  root.append(style, t);
  const r = anchor.getBoundingClientRect();
  t.style.left = `${Math.max(12, r.left)}px`;
  t.style.top = `${Math.max(12, r.top - 44)}px`;
  setTimeout(() => host.remove(), 4500);
}
