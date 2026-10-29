import { loadSettings, STORAGE_KEY, sanitizeSettings } from "../settings.ts";
import { isProtected } from "../sites.ts";
import type { Settings } from "../settings.ts";
import { applyChoice, findSecrets } from "./decide.ts";
import {
  findComposer, findComposerNear, findSendButton, getText, insertAtCaret, isSendButton, replaceAll,
} from "./composer.ts";
import type { Composer } from "./composer.ts";
import { currentNotice, isDialogOpen, ownHosts, showDialog, showNotice, showToast } from "./dialog.ts";
import type { NoticeAction } from "./dialog.ts";

/**
 * SecretSentry content script. Loaded only on sites in your list.
 *
 * What it does:
 *  - On paste and drop: lets the text in as normal (so you can see and edit
 *    it), then shows a heads-up that never takes focus, with one-click
 *    Replace or Remove. The heads-up updates as you edit and goes away when
 *    the secret is gone.
 *  - On send (Enter or the send button): checks the chat box and holds the
 *    message until you decide. This is the hard stop.
 *
 * What it never does: store, log or transmit any text. Text lives only in the
 * local variables of the event being handled.
 *
 * If anything goes wrong while checking, it fails closed: the paste or send is
 * held back and you're told why.
 */

let settings: Settings | null = null;
loadSettings().then((s) => (settings = s), () => (settings = null));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && STORAGE_KEY in changes) settings = sanitizeSettings(changes[STORAGE_KEY]!.newValue);
});

/** Checked on every event, so turning a site off or navigating within the app takes effect at once. */
function isActive(): boolean {
  if (!settings) return true; // registered here means allowed; settings load within milliseconds
  return settings.enabled && isProtected(settings.sites, location.href);
}

let lastComposer: Composer | null = null; // a reference to the element, never its text
let bypass: { el: HTMLElement; until: number } | null = null; // one-time pass after "Send anyway"

function stop(e: Event): void {
  e.preventDefault();
  e.stopImmediatePropagation();
}

/** The real target, even inside a web component's (open) shadow root. */
function targetOf(e: Event): EventTarget | null {
  return e.composedPath()[0] ?? e.target;
}

function isOurs(e: Event): boolean {
  return e.composedPath().some((n) => n instanceof Element && ownHosts.has(n));
}

function failClosed(e: Event, anchor: Element | null): void {
  stop(e);
  if (anchor) showToast("SecretSentry couldn't check this, so it was held back. If this keeps happening, turn SecretSentry off for this site.", anchor);
}

function takeBypass(el: HTMLElement): boolean {
  if (bypass && bypass.el === el && Date.now() < bypass.until) {
    bypass = null;
    return true;
  }
  return false;
}

// ---------- paste and drop ----------

/** Replace or Remove every secret currently in the box, then confirm it really changed. */
function cleanComposer(composer: Composer, choice: "placeholder" | "remove"): void {
  const current = getText(composer);
  const fresh = findSecrets(current);
  if (!fresh.length) return;
  const out = applyChoice(current, fresh, choice);
  if (out !== null) replaceAll(composer, out);
  // Some editors keep their own copy of the text; make sure the change took.
  requestAnimationFrame(() => {
    const left = findSecrets(getText(composer)).length;
    const n = fresh.length;
    showToast(
      left
        ? "SecretSentry couldn't edit this chat box. Please remove the secret yourself."
        : `${choice === "placeholder" ? "Replaced" : "Removed"} ${n} secret${n === 1 ? "" : "s"}. Review, then send.`,
      composer.el,
    );
  });
}

/** Shows, updates or closes the heads-up to match what's in the box right now. */
function refreshNotice(composer: Composer): void {
  if (isDialogOpen()) return; // the send popup is already asking
  const findings = findSecrets(getText(composer));
  const existing = currentNotice();
  if (existing && existing.anchor === composer.el) return existing.update(findings);
  if (!findings.length) return;
  showNotice(findings, composer.el, (action: NoticeAction) => {
    composer.el.focus();
    if (action !== "dismiss") cleanComposer(composer, action);
  });
}

function guardIncomingText(e: Event, data: DataTransfer | null): void {
  if (!isActive() || !e.isTrusted || isOurs(e)) return;
  const composer = findComposer(targetOf(e));
  if (!composer) return;
  try {
    if (isDialogOpen()) return stop(e);
    const text = data?.getData("text/plain") ?? "";
    if (findSecrets(text).length) {
      // Let the paste land normally, then raise the heads-up once the editor has it.
      setTimeout(() => refreshNotice(composer), 0);
      return;
    }
    // Rich editors insert the HTML version, which can hide a key (in a link, say)
    // that the plain version doesn't show. Insert the plain version instead.
    const html = data?.getData("text/html") ?? "";
    if (html && findSecrets(html).length) {
      stop(e);
      if (text) insertAtCaret(composer, text);
      showToast("Pasted as plain text: the formatted version contained a hidden secret.", composer.el);
    }
  } catch {
    failClosed(e, composer.el);
  }
}

function onPaste(e: ClipboardEvent): void {
  guardIncomingText(e, e.clipboardData);
}

function onDrop(e: DragEvent): void {
  guardIncomingText(e, e.dataTransfer);
}

let refreshTimer = 0;
/** While a heads-up is showing, keep it in step with your edits. */
function onInput(e: Event): void {
  const n = currentNotice();
  if (!n || isOurs(e)) return;
  const composer = findComposer(targetOf(e));
  if (!composer || composer.el !== n.anchor) return;
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    try {
      refreshNotice(composer);
    } catch {
      n.close();
    }
  }, 150);
}

// ---------- send ----------

/** Returns true if the send was held back for a decision. */
function checkBeforeSend(composer: Composer, resend: () => void): boolean {
  if (takeBypass(composer.el)) return false; // approved a moment ago, for this box
  const findings = findSecrets(getText(composer));
  if (!findings.length) return false;

  currentNotice()?.close(); // the hard stop takes over from the heads-up
  void showDialog("send", findings, composer.el, () => findSecrets(getText(composer))).then((choice) => {
    if (choice === "cancel") return composer.el.focus();
    if (choice === "allow") {
      bypass = { el: composer.el, until: Date.now() + 1500 }; // this message only
      composer.el.focus();
      resend();
      return;
    }
    cleanComposer(composer, choice);
  });
  return true;
}

function onKeyDown(e: KeyboardEvent): void {
  if (!isActive() || isOurs(e) || e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  const composer = findComposer(targetOf(e));
  if (!composer) return;
  lastComposer = composer;
  try {
    if (isDialogOpen()) return stop(e);
    if (!e.isTrusted && takeBypass(composer.el)) return; // our own re-sent Enter
    const init: KeyboardEventInit = {
      key: e.key, code: e.code, keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true,
      ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey,
    };
    const resend = () => {
      const btn = findSendButton(composer);
      if (btn) btn.click();
      else composer.el.dispatchEvent(new KeyboardEvent("keydown", init));
    };
    if (checkBeforeSend(composer, resend)) stop(e);
  } catch {
    failClosed(e, composer.el);
  }
}

function onClick(e: MouseEvent): void {
  if (!isActive() || isOurs(e)) return;
  const t = targetOf(e);
  const btn = t instanceof Element ? t.closest("button, [role='button']") : null;
  if (!isSendButton(btn)) return;
  try {
    if (isDialogOpen()) return stop(e);
    // Prefer the chat box next to this button; fall back to the last one used.
    const near = findComposerNear(btn);
    const composer = near ?? (lastComposer?.el.isConnected ? lastComposer : null);
    if (!composer) return;
    if (checkBeforeSend(composer, () => btn.click())) stop(e);
  } catch {
    failClosed(e, btn);
  }
}

function onFocusIn(e: FocusEvent): void {
  if (!isActive() || isOurs(e)) return;
  const c = findComposer(targetOf(e));
  if (c) lastComposer = c;
}

// Capture phase on window, registered at document_start, so these run before the page's own handlers.
window.addEventListener("paste", onPaste, true);
window.addEventListener("drop", onDrop, true);
window.addEventListener("input", onInput, true);
window.addEventListener("keydown", onKeyDown, true);
window.addEventListener("click", onClick, true);
window.addEventListener("focusin", onFocusIn, true);
