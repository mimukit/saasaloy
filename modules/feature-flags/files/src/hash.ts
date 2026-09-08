// Percentage bucketing. One function, no dependencies, and deliberately synchronous.
//
// Web Crypto was rejected for this: `crypto.subtle.digest` is async, so every `flag()`
// call would await a digest even for a boolean flag that never buckets. FNV-1a is a
// non-cryptographic hash, which is the right class of tool — nothing here is a secret, and
// what a rollout needs is a cheap, well-spread, *stable* number.

const FNV_OFFSET_BASIS = 0x81_1c_9d_c5;
const FNV_PRIME = 0x01_00_01_93;

/**
 * FNV-1a, 32-bit, over the string's code points.
 *
 * Code points rather than UTF-8 bytes: reading bytes would mean a `TextEncoder` allocation
 * per call, and the hash is never compared against another implementation's output. It only
 * has to be stable and well spread, and over ASCII subject ids the two agree anyway.
 *
 * `Math.imul` is what keeps the multiply 32-bit. A plain `*` overflows into a float past
 * 2^53 and the low bits — the only ones that survive the modulo — stop being reliable.
 */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const character of input) {
    // The three bitwise operators below are FNV-1a itself, not a clever shortcut for
    // arithmetic: the xor is the algorithm's mixing step, and `>>> 0` is what keeps the
    // running value an unsigned 32-bit integer. Writing them any other way computes a
    // different hash, and a different hash reshuffles every subject in every rollout.
    // oxlint-disable-next-line no-bitwise
    hash ^= character.codePointAt(0) ?? 0;
    // oxlint-disable-next-line no-bitwise
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  // oxlint-disable-next-line no-bitwise
  return hash >>> 0;
}

/**
 * Which of 100 buckets a subject falls in for one flag, 0–99.
 *
 * Stable across requests, isolates and colos, because it is a pure function of the flag key
 * and the subject id — no random, no time, no stored assignment. A user does not flip in
 * and out of a 50% rollout while clicking around.
 *
 * The flag key is in the hash, not just the subject, so two flags at 10% do not roll out to
 * the same tenth of the audience. Bucketing on the subject alone would make the second
 * rollout a strict subset of the first, and the second experiment would measure the first.
 */
export function bucket(flagKey: string, subjectId: string): number {
  return fnv1a32(`${flagKey}:${subjectId}`) % 100;
}
