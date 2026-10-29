# Security

SecretSentry is a browser extension that reads what you paste or type into AI chat boxes. That is sensitive, so this file spells out exactly what it can and can't do, and how that is enforced.

## Promises, and how each one is enforced

| Promise | How it's enforced |
|---|---|
| Runs only on sites in your list | No static content scripts. The checker is registered at runtime only for sites that are switched on **and** that the browser has granted access to (`src/registration.ts`). On every other site it isn't loaded at all. On a listed site it re-checks the exact address on every event, so in-app navigation and turning a site off take effect immediately. |
| You approve every new site | Built-in AI sites are declared in the manifest. Any site you add goes through the browser's own permission prompt (`optional_host_permissions`), one exact host at a time (no wildcards like `*.github.io`). Removing a site gives the permission back. |
| Saves no secrets | The only stored value is `settings` (on/off switch and site list) in `chrome.storage.local`. Stored settings are re-validated on every read, so a tampered value can't widen access (`src/settings.ts`). The content script never writes to storage. |
| Stays on your device | Settings use `storage.local`, never `storage.sync`. The code makes no network requests, and the extension-page CSP sets `connect-src 'none'`. |
| No remote or dynamic code | CSP `script-src 'self'`, no `eval`, no `new Function`, no remote scripts. The build is not minified, so anyone can read exactly what runs. |
| Pages can't tamper with the warning | The dialog lives in a closed shadow root in the browser's top layer, above anything the page draws. Its host has inline `!important` styles that page CSS can't override, and any change to its attributes, or removing it, counts as Cancel. It's built with `textContent` only and ignores synthetic events (`isTrusted`). "Send anyway" only works after the dialog has been on screen for half a second and the browser confirms it's actually visible (anti-clickjacking). |
| Nothing else can talk to it | Web pages can't message it (no `externally_connectable`), no files are exposed (`web_accessible_resources`), and it has no message listeners at all, so other extensions get no answer either. |
| Secrets are never sent without your say-so | Send (Enter or the send button) is the hard stop: the message is held until you choose Replace, Remove, Cancel or Send anyway. Pastes and drops are checked too: the text lands in the box so you can see and edit it, and a heads-up (which never takes focus) offers one-click Replace or Remove. If the formatted (HTML) version of a paste hides a secret the plain text doesn't show, only the plain text is inserted. |
| Big inputs are fully checked | Text longer than one scan is checked in overlapping chunks. |
| Errors fail closed | If checking throws for any reason, the paste or send is held back and you're told. |

These are checked automatically by `packages/extension/tests/security-audit.test.ts` (manifest permissions, CSP, banned APIs in the built code) and the end-to-end tests (storage contents, closed dialog, unlisted sites).

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save the on/off switch and site list |
| `scripting` | Load the checker only on allowed sites |
| `activeTab` | Show the current site in the toolbar popup, only when you click the icon |
| Host access to built-in AI sites | Run the checker there |
| Optional host access | Sites you add yourself, one browser prompt each |

## Known limits

- **The site can see what's in its chat box before you press Send.** That includes pasted text, which now lands in the box so you can edit it. Some AI sites save drafts as you type; SecretSentry can't stop that, only the send. Use Replace on the paste heads-up to clean it up straight away.
- **The page itself can always read its own chat box.** SecretSentry stops you from *sending* a secret; it can't hide text from the site you typed it into.
- **Send buttons are found by common patterns** (`type="submit"`, `aria-label` containing "send", and similar). Enter is always covered; an unusual custom button might not be.
- **"Send anyway" re-sends by clicking the site's send button** (or replaying Enter). If a site ignores that, press Send again within a second and a half.
- **Replacing text in rich editors resets formatting** to plain text.
- **Open tabs need a reload** after install or after adding a site.
- **Not covered yet:** file uploads, voice input, iframes, desktop and mobile AI apps.
- **Detection isn't perfect.** It finds known key formats very reliably and generic secrets reasonably well. It can't recognize a plain password with no label.

## Review

Before v0.1 the extension had an independent adversarial review. It found and we fixed: a large paste skipping the check, page CSS being able to hide the dialog, chat boxes inside web components being missed, Send clicks on unfocused boxes skipping the check, editors that ignore programmatic edits, errors letting events through, drag-and-drop, hidden HTML in pastes, wildcard sites, single-page-app navigation, and a registration race.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting (Security tab, "Report a vulnerability") instead of a public issue. Include the browser version, the site, and steps to reproduce. Never include a real secret in a report.
