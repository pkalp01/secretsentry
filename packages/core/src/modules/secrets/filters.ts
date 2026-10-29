import { shannonEntropy } from "./entropy.ts";

/**
 * Filters that throw out values which match a secret pattern but are not
 * real secrets. Most of the accuracy of the module comes from here.
 */

/** Keys published in vendor docs. Flagged at low confidence, never dropped. */
export const KNOWN_EXAMPLE_VALUES: ReadonlySet<string> = new Set([
  "AKIAIOSFODNN7EXAMPLE",
  "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
]);

const PLACEHOLDER_SHAPES: RegExp[] = [
  /^<[^>]*>$/, // <API_KEY>
  /^\$\{[^}]*\}$/, // ${API_KEY}
  /^\{\{[^}]*\}\}$/, // {{ api_key }}
  /^\{[^}]*\}$/, // {api_key}
  /^%[A-Za-z_][A-Za-z0-9_]*%$/, // %API_KEY%
  /^\$[A-Za-z_][A-Za-z0-9_]*$/, // $API_KEY
  /^\[[A-Z0-9_]+_\d+\]$/, // [OPENAI_KEY_1], our own redaction labels
  /^[x*•.\-_#0]+$/i, // xxxx, ****, 0000
];

const PLACEHOLDER_WORDS =
  /your|example|sample|dummy|placeholder|changeme|change_me|redacted|insert|replace|fake|mock|todo|fixme|<|>/i;

/** Single words that show up after "password=" etc. but are not secrets. */
const STOP_VALUES: ReadonlySet<string> = new Set([
  "true", "false", "null", "nil", "none", "undefined", "required", "optional", "string", "number",
  "boolean", "password", "passwd", "secret", "token", "bearer", "basic", "notset", "not_set", "empty",
  "default", "hidden", "masked", "invalid", "incorrect", "expired", "missing",
]);

const VARIABLE_REFERENCE =
  /^(?:process\.env|import\.meta\.env|os\.environ|os\.getenv|getenv|env\(|ENV\[|System\.getenv|\$env:|config\.|settings\.|secrets\.|vault:)/i;

const DOTTED_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
const URL_OR_PATH = /^(?:[a-z][a-z0-9+.\-]*:\/\/|\.{0,2}\/|[A-Za-z]:\\|~\/)/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

/** Variable names that describe a secret instead of holding one. */
const DESCRIPTIVE_NAME_SUFFIX =
  /[_\-.](?:name|names|id|ids|type|url|uri|path|file|dir|header|endpoint|length|len|size|field|label|policy|version|arn|ttl|expiry|expires|expiration|count|prefix|env|var|key_?name|hash|algo|algorithm|format|location|ref|store)$/i;

export function isKnownExample(value: string): boolean {
  return KNOWN_EXAMPLE_VALUES.has(value);
}

/** True for template values, masks and filler like "xxxxxxxx". */
export function isPlaceholder(value: string): boolean {
  if (PLACEHOLDER_SHAPES.some((re) => re.test(value))) return true;
  if (PLACEHOLDER_WORDS.test(value)) return true;
  // Low variety at the end, like a Stripe key ending in a row of "x" or a GitHub token of zeros
  const tail = value.slice(-16);
  if (tail.length >= 8 && shannonEntropy(tail) < 1.5) return true;
  return false;
}

/**
 * Extra filters for generic rules (no known prefix), where the value could be
 * almost anything.
 */
export function looksLikeNonSecretValue(value: string, followingChar: string | undefined): boolean {
  if (STOP_VALUES.has(value.toLowerCase())) return true;
  if (VARIABLE_REFERENCE.test(value)) return true;
  if (DOTTED_PATH.test(value)) return true; // config.api.key, self.token
  if (URL_OR_PATH.test(value)) return true;
  if (EMAIL.test(value)) return true;
  if (followingChar === "(") return true; // a function call: getToken()
  return false;
}

export function isDescriptiveName(name: string): boolean {
  return DESCRIPTIVE_NAME_SUFFIX.test(name);
}

export function isUrlPasswordPlaceholder(value: string): boolean {
  return /^(?:password|pass|passwd|pwd|secret|pw|xxx+|\*+)$/i.test(value);
}
