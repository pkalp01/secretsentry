/**
 * Reading and writing the chat box. AI sites use either a <textarea> or a
 * rich-text editor (contenteditable: ProseMirror, Lexical, Quill...).
 */

export type Composer =
  | { kind: "field"; el: HTMLTextAreaElement | HTMLInputElement }
  | { kind: "editable"; el: HTMLElement };

const TEXT_INPUT_TYPES = new Set(["text", "search", ""]);

export function findComposer(target: EventTarget | null): Composer | null {
  if (!(target instanceof Element)) return null;
  if (target instanceof HTMLTextAreaElement) return { kind: "field", el: target };
  if (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)) return { kind: "field", el: target };
  // The outermost contenteditable is the editor root.
  let root: HTMLElement | null = null;
  for (let el: HTMLElement | null = target as HTMLElement; el; el = el.parentElement) {
    if (el.isContentEditable) root = el;
    else if (root) break;
  }
  return root ? { kind: "editable", el: root } : null;
}

export function getText(c: Composer): string {
  return c.kind === "field" ? c.el.value : c.el.innerText;
}

/** Saved caret/selection, so focus can return to the right place after the dialog. */
export type Caret = { kind: "field"; start: number; end: number } | { kind: "editable"; range: Range | null };

export function saveCaret(c: Composer): Caret {
  if (c.kind === "field") return { kind: "field", start: c.el.selectionStart ?? c.el.value.length, end: c.el.selectionEnd ?? c.el.value.length };
  const sel = window.getSelection();
  const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  return { kind: "editable", range: range && c.el.contains(range.commonAncestorContainer) ? range : null };
}

export function restoreCaret(c: Composer, caret: Caret): void {
  c.el.focus();
  if (c.kind === "field" && caret.kind === "field") {
    c.el.setSelectionRange(caret.start, caret.end);
  } else if (caret.kind === "editable") {
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    if (caret.range) sel.addRange(caret.range);
    else {
      const r = document.createRange();
      r.selectNodeContents(c.el);
      r.collapse(false);
      sel.addRange(r);
    }
  }
}

function setFieldValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  // Use the native setter so frameworks like React notice the change.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Inserts text at the caret, the way a normal paste would. */
export function insertAtCaret(c: Composer, text: string): void {
  // execCommand keeps the editor's undo stack and its internal state in sync.
  if (document.execCommand("insertText", false, text)) return;
  if (c.kind === "field") {
    const el = c.el;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setFieldValue(el, el.value.slice(0, start) + text + el.value.slice(end));
    el.setSelectionRange(start + text.length, start + text.length);
  } else {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    c.el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }
}

/** Replaces everything in the chat box. Rich formatting in editors is reset to plain text. */
export function replaceAll(c: Composer, text: string): void {
  c.el.focus();
  if (c.kind === "field") {
    c.el.select();
    if (!document.execCommand("insertText", false, text)) setFieldValue(c.el, text);
    return;
  }
  const sel = window.getSelection();
  if (sel) {
    const r = document.createRange();
    r.selectNodeContents(c.el);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  // No fallback that rewrites the DOM directly: rich editors keep their own copy of
  // the text, so a DOM-only change could show placeholders while the real secret
  // is still sent. The caller re-checks the box and tells the user if this failed.
  document.execCommand("insertText", false, text);
}

const SEND_BUTTON_SELECTOR = [
  'button[type="submit"]',
  'button[aria-label*="send" i]',
  'button[data-testid*="send" i]',
  'button[aria-label*="submit" i]',
  '[role="button"][aria-label*="send" i]',
].join(",");

export function isSendButton(el: Element | null): el is HTMLElement {
  return !!el && el.matches(SEND_BUTTON_SELECTOR);
}

const COMPOSER_SELECTOR = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';

/** Finds the chat box that belongs to a send button: same form first, then nearby. */
export function findComposerNear(btn: Element): Composer | null {
  const form = btn.closest("form");
  const inForm = form?.querySelector(COMPOSER_SELECTOR);
  if (inForm) return findComposer(inForm);
  for (let el: Element | null = btn.parentElement, depth = 0; el && depth < 6; el = el.parentElement, depth++) {
    const found = el.querySelector(COMPOSER_SELECTOR);
    if (found) return findComposer(found);
  }
  return null;
}

/** Finds the send button that belongs to this chat box: same form first, then nearby. */
export function findSendButton(c: Composer): HTMLElement | null {
  const form = c.el.closest("form");
  const inForm = form?.querySelector<HTMLElement>(SEND_BUTTON_SELECTOR);
  if (inForm) return inForm;
  for (let el: HTMLElement | null = c.el.parentElement, depth = 0; el && depth < 6; el = el.parentElement, depth++) {
    const btn = el.querySelector<HTMLElement>(SEND_BUTTON_SELECTOR);
    if (btn) return btn;
  }
  return null;
}
