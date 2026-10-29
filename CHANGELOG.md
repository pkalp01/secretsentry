# Changelog

All notable changes to SecretSentry are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-28

First public release.

### Added

- Browser extension for Chrome, Edge, Brave and other Chromium browsers (Manifest V3).
- Warning when you paste a secret into an AI chat. The text stays editable, with one-click **Replace with placeholders** or **Remove**, and a × to dismiss.
- Check at Send: messages that still contain a secret are held until you choose Replace, Remove, Cancel or Send anyway.
- 15 built-in AI sites: ChatGPT, Claude, Gemini, Google AI Studio, Microsoft Copilot, Microsoft 365 Copilot, Perplexity, DeepSeek, Grok, Mistral Le Chat, Meta AI, Poe, Qwen and HuggingChat.
- Add or remove your own sites, each approved through the browser's permission prompt.
- Detection engine with 36 rules for cloud, code hosting, payment, AI provider and messaging keys, private keys, tokens and database passwords.
- Placeholder redaction that keeps the same label for a repeated key.

### Security

- Runs only on sites in your list, with no network requests and no stored secrets.
- Warnings live in a closed shadow root in the browser's top layer, ignore synthetic clicks, and close if a page tampers with them.
- "Send anyway" works only after the warning has been visibly on screen for half a second.
- Independent adversarial review before release; all findings fixed. See SECURITY.md.
