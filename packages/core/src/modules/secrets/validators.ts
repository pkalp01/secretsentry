/**
 * Extra checks that run after a pattern matches.
 *
 * A validator returns:
 *   "pass" - the value is internally consistent (e.g. checksum matches)
 *   "fail" - the format matched but the value is not consistent
 *
 * A failed check lowers confidence instead of dropping the finding. This tool
 * exists to warn people, so a missed real key is worse than an extra warning.
 */
export type ValidationResult = "pass" | "fail";
export type Validator = (value: string) => ValidationResult;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

let crcTable: Uint32Array | undefined;
export function crc32(input: string): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    crc = crcTable[(crc ^ input.charCodeAt(i)) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function base62(n: number, width: number): string {
  let out = "";
  do {
    out = BASE62[n % 62] + out;
    n = Math.floor(n / 62);
  } while (n > 0);
  return out.padStart(width, "0");
}

/**
 * GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_) end in a 6-character base62
 * CRC32 checksum of the 30 random characters before it.
 * Source: GitHub's 2021 "Behind GitHub's new authentication token formats".
 * TODO: confirm against a freshly generated real token before v1.0.
 */
export const githubChecksum: Validator = (value) => {
  const body = value.slice(4); // drop "ghp_"
  if (body.length !== 36) return "fail";
  const random = body.slice(0, 30);
  const check = body.slice(30);
  return base62(crc32(random), 6) === check ? "pass" : "fail";
};

export const VALIDATORS: Record<string, Validator> = {
  "github-checksum": githubChecksum,
};
