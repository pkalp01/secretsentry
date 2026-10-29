import { base62, crc32 } from "../src/modules/secrets/validators.ts";

const ALPHABETS: Record<string, string> = {
  alnum: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  hex: "0123456789abcdef",
  b64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
  b32: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
  urlsafe: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  digits: "0123456789",
};

/** Small deterministic PRNG so test values are random-looking but stable across runs. */
export function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function randomString(alphabet: string, n: number, next: () => number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(next() * alphabet.length)];
  return s;
}

/** A fake GitHub token whose checksum is valid. */
export function fakeGithubToken(prefix: string, next: () => number): string {
  const random = randomString(ALPHABETS.alnum!, 30, next);
  return prefix + random + base62(crc32(random), 6);
}

/**
 * Expands <<kind:N>> fillers in a test string into fake random values.
 * Real-looking keys are never stored in the repo; they only exist while tests run.
 */
export function expand(template: string, seed: string): string {
  const next = rng(seed);
  return template.replace(/<<(\w+):([^>]+)>>/g, (_, kind: string, arg: string) => {
    if (kind === "ghtoken") return fakeGithubToken(arg, next);
    const alphabet = ALPHABETS[kind];
    if (!alphabet) throw new Error(`Unknown filler kind "${kind}" in ${template}`);
    return randomString(alphabet, Number(arg), next);
  });
}
