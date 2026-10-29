# Contributing to SecretSentry

Thanks for helping. This guide covers reporting problems, adding detection rules and sending code changes.

## Ground rules

- **Never put a real secret anywhere in this repository**, including issues, pull requests, test files and screenshots. Use made-up values in the same format.
- **Keep the privacy promises.** SecretSentry must not make network requests, store page text or secrets, log page content, or load remote code. The security tests in `packages/extension/tests/security-audit.test.ts` enforce this. If a change needs one of those tests updated, explain why in the pull request.
- **Be kind.** Assume good intent and keep feedback about the work.

## Reporting a problem

Use the [issue forms](../../issues/new/choose):

- **Missed a secret**: SecretSentry didn't warn about a real key format.
- **False alarm**: it warned about something that isn't a secret.
- **Site not working**: no warning on a site that's in your list.

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Setting up

You need Node.js 22.18 or newer and Git.

```
git clone <your fork URL>
cd secretsentry
npm install
npm test
```

For the end-to-end tests, which load the real extension in Chromium:

```
npx playwright install chromium
npm run test:e2e
```

To try your changes in a browser, run `npm run build` and load `packages/extension/dist` with **Load unpacked** on `chrome://extensions`.

## Adding a detection rule

Rules live in `packages/core/rules/secrets/`, one YAML file per category.

1. Add an entry to the right file:

   ```yaml
   - id: example-api-key
     label: Example API key
     category: ai
     confidence: high
     keywords: [exk_]
     pattern: '\b(exk_[A-Za-z0-9]{32})\b'
     placeholder: EXAMPLE_API_KEY
     description: Known Example format (exk_ plus 32 characters)
     tests:
       match:
         - 'EXAMPLE_KEY=exk_<<alnum:32>>'
       nomatch:
         - 'exk_<<alnum:10>>'
   ```

2. Write test values with fillers instead of real-looking keys. They're expanded into random fake values only while tests run:

   | Filler | Produces |
   |---|---|
   | `<<alnum:N>>` | letters and digits |
   | `<<hex:N>>` | lowercase hex |
   | `<<b64:N>>` | base64 characters |
   | `<<b32:N>>` | `A-Z` and `2-7` |
   | `<<urlsafe:N>>` | letters, digits, `-` and `_` |
   | `<<digits:N>>` | digits |
   | `<<ghtoken:ghp_>>` | a GitHub token with a valid checksum |

3. Run:

   ```
   npm run build:rules
   npm test
   npm run build
   ```

Every rule needs at least one `match` and one `nomatch` example. The build rejects bad regexes, unknown fields and duplicate ids. The tests also run every rule against hostile inputs to make sure no regex can freeze a browser.

**Choosing confidence:** use `high` for a distinctive prefix or structure (like `ghp_` or `sk_live_`), and `medium` for looser formats that need a randomness check (`minEntropy`).

## Fixing a false alarm

1. Add the text (made up, never real) to `packages/core/tests/fixtures/clean.txt`.
2. Run `npm test` and confirm it fails.
3. Fix the rule or the filters in `packages/core/src/modules/secrets/filters.ts`.
4. Run `npm test` again.

The clean corpus means a false alarm, once fixed, can never come back.

## Adding a built-in site

Add the match pattern to `DEFAULT_SITE_PATTERNS` in `packages/extension/src/sites.ts`, then run `npm run build` and `npm test`. The security audit checks that the manifest's site permissions match the list exactly. Only add sites that are AI chat tools.

## Sending a pull request

1. Fork the repository and create a branch.
2. Make your change, with tests.
3. Run `npm run typecheck`, `npm test` and `npm run build`. Commit the updated `dist/` folder too.
4. Describe what changed and why. For detection changes, include a made-up example of the text involved.

Pull requests run the full test suite automatically, including the browser tests.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
