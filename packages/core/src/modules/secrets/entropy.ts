/**
 * Shannon entropy in bits per character: how random a string looks.
 * English words land around 2-3, real API keys usually above 3.5.
 */
export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const n = value.length;
  let bits = 0;
  for (const c of counts.values()) {
    const p = c / n;
    bits -= p * Math.log2(p);
  }
  return bits;
}
