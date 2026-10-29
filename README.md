# SecretSentry

A browser extension that warns you before you send API keys, tokens and passwords to an AI chat.

Paste a Stripe key into ChatGPT by accident, and SecretSentry spots it, tells you what it found, and lets you swap it for a placeholder like `[STRIPE_SECRET_KEY_1]` with one click. The AI can still help with your code. Your key never leaves your browser.

Everything runs on your own computer. SecretSentry saves no secrets, makes no network requests, and only runs on the sites you choose.

Made by Kalpesh. Free and open source under the MIT license.

## Contents

- [What it does](#what-it-does)
- [Install](#install)
- [How to use it](#how-to-use-it)
- [Choosing which sites it runs on](#choosing-which-sites-it-runs-on)
- [Updating and removing](#updating-and-removing)
- [Privacy](#privacy)
- [What it detects](#what-it-detects)
- [Troubleshooting](#troubleshooting)
- [For developers](#for-developers)
- [Contributing](#contributing)
- [License](#license)

## What it does

- **When you paste** a secret into an AI chat box, the text goes in as normal and a small warning appears below the box. You can keep typing and editing. One click replaces or removes the secret.
- **When you press Send** and a secret is still in the box, SecretSentry holds the message and asks what to do. Nothing goes out until you decide.
- **It works on** ChatGPT, Claude, Gemini, Google AI Studio, Microsoft Copilot, Microsoft 365 Copilot, Perplexity, DeepSeek, Grok, Mistral Le Chat, Meta AI, Poe, Qwen and HuggingChat out of the box. You can add any other site.

## Install

SecretSentry works in Chrome, Microsoft Edge, Brave and other Chromium-based browsers.

1. Go to the [Releases](../../releases) page and download the latest `SecretSentry-vX.Y.Z.zip`.
2. Unzip it somewhere you'll keep it, for example `Documents\SecretSentry`. Don't delete this folder later, because the browser loads the extension from it.
3. Open your browser's extensions page:
   - Chrome or Brave: type `chrome://extensions` in the address bar
   - Edge: type `edge://extensions`
4. Turn on **Developer mode** (top right in Chrome, left side in Edge).
5. Click **Load unpacked** and select the folder you unzipped (the one that contains `manifest.json`).
6. Click the puzzle-piece icon in your toolbar and pin **SecretSentry** so its shield icon is always visible.
7. Reload any AI chat tabs that were already open.

**Prefer to use the source code?** Download this repository (green **Code** button, then **Download ZIP**), unzip it, and in step 5 select the `packages/extension/dist` folder.

**Want to check the download?** Each release has a `.sha256` file. In PowerShell, run `Get-FileHash SecretSentry-vX.Y.Z.zip` and compare the result with the value in that file.

## How to use it

### When you paste a secret

1. Paste as usual. The text appears in the chat box.
2. A warning appears below the box showing what it found, for example "This looks like a Stripe live secret key", with a partly hidden preview such as `sk_l••••••••0u`.
3. Choose one:
   - **Replace with placeholders**: swaps each secret for a label like `[STRIPE_SECRET_KEY_1]`. Best choice when you want help with code or config.
   - **Remove it**: deletes the secret from the box.
   - **×** (top right): closes the warning. You can keep editing. You'll still be asked before sending.

If you delete or edit the secret yourself, the warning disappears on its own.

### When you press Send

If a secret is still in the box, the message is held and a warning asks you to choose:

- **Replace with placeholders** or **Remove it**: cleans the box. Check it, then send again.
- **Cancel** or **×**: closes the warning. Nothing is sent and your text stays in the box.
- **Send anyway**: sends this one message as it is. It only works after the warning has been on screen for half a second, so you can't hit it by accident. The next message is checked again.

You can also click back into the chat box and fix the text while the warning is open. It updates as you type and closes once the secret is gone.

### Keyboard

- **Tab** moves between the buttons in the Send warning.
- **Enter** presses the highlighted button.
- **Esc** closes the Send warning without sending.

### Turning it off

Click the SecretSentry icon in your toolbar:

- **The switch at the top** turns SecretSentry off or on everywhere.
- **Turn off for this site** stops it on the site you're looking at.

## Choosing which sites it runs on

SecretSentry only loads on sites in its list. On every other website it doesn't run at all.

**Add the site you're on:**

1. Click the SecretSentry icon in the toolbar.
2. Click **Add** followed by the site name.
3. Your browser asks for permission for that one site. Click **Allow**.
4. Click **Reload page to apply**.

**Manage the whole list:** click the SecretSentry icon, then **Manage sites**. From there you can:

- turn any site on or off with its switch,
- add a site by typing its address, like `chat.example.com`,
- remove sites you added (built-in sites can be turned off but not removed).

Rules for added sites:

- They must use `https`. Plain `http` is allowed only for `localhost` and `127.0.0.1`, which is handy for local AI tools such as Open WebUI.
- Each entry is one exact site. Wildcards like `*.example.com` aren't allowed, so a single entry can never cover thousands of sites.

## Updating and removing

**To update:**

1. Download the new zip from [Releases](../../releases).
2. Unzip it over the same folder, replacing the old files.
3. Go to `chrome://extensions` (or `edge://extensions`) and click the circular reload arrow on the SecretSentry card.
4. Reload your AI chat tabs.

**To remove:** on the extensions page, click **Remove** on the SecretSentry card, then delete the folder.

## Privacy

| | |
|---|---|
| **What it saves** | The on/off switch and your site list, on this computer only. Nothing else. |
| **What it never saves** | Your messages, your keys, or anything it found. It checks text in memory and forgets it straight away. |
| **What it sends** | Nothing. It makes no network requests, has no analytics and loads no code from the internet. |
| **Where it runs** | Only on the sites in your list. |
| **Permissions** | `storage` for your settings, `scripting` to load only on your sites, `activeTab` to show the current site when you click the icon, and access to the AI sites in the list. |

The code isn't minified, so anyone can read exactly what runs. See [SECURITY.md](SECURITY.md) for how each promise is enforced and tested, and for the known limits.

One limit worth knowing: the AI site can see whatever is in its own chat box before you press Send, and some sites save drafts as you type. If you paste a secret, use **Replace** or **Remove** straight away.

## What it detects

36 rules covering:

| Category | Examples |
|---|---|
| Cloud | AWS access keys and secret keys, Google and Gemini API keys, Google service account keys, Azure Storage keys, Microsoft Entra client secrets, DigitalOcean tokens |
| Code and packages | GitHub tokens (with checksum check), GitLab, npm and PyPI tokens |
| Payments | Stripe live and test keys, Square, Braintree |
| AI providers | OpenAI, Anthropic, Hugging Face, Groq, Replicate, other `sk-` style keys |
| Messaging | Slack tokens and webhooks, Discord webhooks, Telegram bot tokens, SendGrid, Twilio, Mailgun |
| Keys and tokens | Private keys (SSH, RSA, PGP), JSON Web Tokens, Basic and Bearer auth headers |
| Other | Passwords inside database URLs, random-looking values assigned to names like `api_key=` or `client_secret:` |

Each finding has a confidence level. SecretSentry warns on **high** (a known key format) and **medium** (very likely a secret). It stays quiet on **low**, such as example keys from documentation.

It doesn't look for personal information like names, emails or card numbers yet, and it can't recognise a plain password with no label.

## Troubleshooting

**No warning appears.**

- Make sure the site is in your list and switched on (click the SecretSentry icon).
- Reload the tab. Tabs that were open before you installed or changed settings keep the old state until reloaded.
- Check the switch at the top of the popup is on.
- If it still doesn't work on a particular site, please [open an issue](../../issues/new/choose) using "Site not working".

**It warned about something that isn't a secret.** Please [report a false alarm](../../issues/new/choose). Describe the text but don't paste anything real.

**It missed a real secret.** Please [report a missed secret](../../issues/new/choose). Use a made-up example in the same format, never your real key.

**I leaked a key before installing.** Revoke or rotate it with the provider (AWS, GitHub, Stripe and so on). Deleting the chat isn't enough.

## For developers

You need Node.js 22.18 or newer.

```
npm install
npm test             # detection engine, extension unit tests and security checks
npm run test:e2e     # loads the real extension in Chromium (run "npx playwright install chromium" once first)
npm run typecheck
npm run build        # rebuilds packages/extension/dist after code changes
```

`npm test` fails if `dist/` is out of date, so the committed build always matches the source.

### Project layout

```
packages/
  core/                    detection engine (TypeScript, no runtime dependencies)
    rules/secrets/*.yaml   the detection rules
    src/                   engine, filters, validators, redaction
    tests/                 rule examples, false-alarm corpus, regex safety tests
  extension/               the SecretSentry browser extension
    src/                   content script, background, popup and settings page
    dist/                  ready-to-load build
    tests/                 unit, security audit and end-to-end tests
```

### How detection works

For every rule: a quick keyword check, then the pattern, then filters that drop placeholders (`<your-key>`, `${API_KEY}`, `xxxx`), variable references (`process.env.KEY`) and function calls. Loose rules also need the value to look random enough. Some rules have extra checks, like GitHub's built-in checksum. Where two rules match the same text, the more specific one wins.

### Releasing a new version

1. Update the version in `packages/extension/scripts/build.ts` and add an entry to [CHANGELOG.md](CHANGELOG.md).
2. Run `npm run build` and `npm test`, then upload the changes.
3. On GitHub, go to **Releases**, click **Draft a new release**, create a tag like `v0.1.1`, and publish.
4. GitHub Actions builds the zip and its `.sha256` file and attaches them to the release within a couple of minutes.

## Contributing

Bug reports, new detection rules and fixes are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

MIT. Copyright (c) 2026 Kalpesh. See [LICENSE](LICENSE).
