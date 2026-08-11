/**
 * Deterministic pseudo-random number generation.
 *
 * The server generates a game's minefield from a secret seed and later has to
 * regenerate the *exact same* minefield to verify the submitted moves. That
 * only works if every runtime agrees bit-for-bit, so this file avoids floating
 * point entirely and sticks to 32-bit integer operations that behave
 * identically in Node, browsers and workerd.
 */

/** MurmurHash3 (x86, 32-bit) over an ASCII string. Used only for seeding. */
function murmur3(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    let k = input.charCodeAt(i) & 0xffff;
    k = Math.imul(k, 0xcc9e2d51) >>> 0;
    k = ((k << 15) | (k >>> 17)) >>> 0;
    k = Math.imul(k, 0x1b873593) >>> 0;
    h = (h ^ k) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  h = (h ^ input.length) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** xoshiro128** — small, fast, and trivially portable across our three runtimes. */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(a: number, b: number, c: number, d: number) {
    this.s0 = a >>> 0;
    this.s1 = b >>> 0;
    this.s2 = c >>> 0;
    this.s3 = d >>> 0;
    // An all-zero state is a fixed point of the generator.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x9e3779b9;
    // Discard the first outputs so poorly-distributed seeds settle down.
    for (let i = 0; i < 20; i++) this.next();
  }

  /** Next raw 32-bit value. */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /**
   * Uniform integer in `[0, bound)`.
   *
   * Rejection sampling rather than a modulo, because a biased shuffle would
   * make some mine layouts measurably more likely than others.
   */
  nextInt(bound: number): number {
    if (bound <= 0) throw new RangeError(`bound must be positive, got ${bound}`);
    const limit = 0x100000000 - (0x100000000 % bound);
    let r = this.next();
    while (r >= limit) r = this.next();
    return r % bound;
  }
}

/**
 * Builds a generator from a seed string plus any number of extra integers
 * (we fold in the first-click coordinates, since the board depends on them).
 */
export function rngFromSeed(seed: string, ...extra: number[]): Rng {
  const salt = extra.length > 0 ? `${seed}:${extra.join(',')}` : seed;
  return new Rng(
    murmur3(salt, 0x9e3779b9),
    murmur3(salt, 0x85ebca6b),
    murmur3(salt, 0xc2b2ae35),
    murmur3(salt, 0x27d4eb2f),
  );
}
