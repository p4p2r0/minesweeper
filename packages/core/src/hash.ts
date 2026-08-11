/**
 * The commitment scheme, in one place so the server and both clients cannot
 * drift apart on it.
 *
 * `globalThis.crypto.subtle` exists in Node 20+, in browsers and in workerd, so
 * this file needs no per-runtime branch.
 */

const HEX = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += HEX[byte >> 4] + HEX[byte & 0x0f];
  }
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

/**
 * Checks a released seed against the commitment handed out before play started.
 *
 * A mismatch means the board was swapped after the player committed to their
 * opening click, so the client should refuse to continue rather than play a
 * game whose result it cannot trust.
 */
export async function verifyCommitment(seed: string, commitment: string): Promise<boolean> {
  const actual = await sha256Hex(seed);
  if (actual.length !== commitment.length) return false;
  // Constant-time-ish comparison; the values are public, but the habit is cheap.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ commitment.charCodeAt(i);
  }
  return diff === 0;
}
