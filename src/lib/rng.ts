/**
 * Deterministic, counter-based RNG for the price engine.
 *
 * Requirements (PLAN.md 3.3):
 *  - Identical output on every machine, every V8 build, every replay.
 *  - No carried state, so tick k can be computed without having computed k-1.
 *
 * Deliberately avoids Math.log / Math.exp / Math.sin: those are NOT bit-identical
 * across engines, and a 1-ULP difference can flip a paise rounding. Only integer
 * ops, +, -, / and Math.sqrt (which IEEE-754 specifies exactly) are used.
 */

/** 32-bit integer avalanche hash (murmur3 finalizer). */
export function hash32(a: number, b: number, c: number): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1) ^ Math.imul(c | 0, 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform in [0, 1). */
export function uniform(seed: number, tick: number, stream: number): number {
  return hash32(seed, tick, stream) / 4294967296;
}

/**
 * Standard normal via Irwin-Hall: sum of 12 uniforms minus 6.
 *
 * Mean 0, variance 1 (exactly, for n=12), naturally truncated at +/-6 sigma —
 * which is a feature here, not a bug: a stock cannot take a 40% single-tick
 * move because a random number generator had a bad day.
 */
export function gaussian(seed: number, tick: number, stream = 0): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += uniform(seed, tick, stream * 32 + i);
  return sum - 6;
}

/** Deterministic seed from a string, for assigning stock seeds reproducibly. */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
