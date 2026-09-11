// Key building and key validation. Namespacing is the capability's job, never the
// caller's: a caller passes a namespace and some parts, and this file decides what the
// string looks like. Two modules that both cache "user 7" therefore cannot collide.

import { KvError } from "./provider";

/** Workers KV's hard cap, and the number every provider is held to. */
export const MAX_KEY_BYTES = 512;

/** What joins the namespace to the parts, and the parts to each other. */
export const KEY_SEPARATOR = ":";

const encoder = new TextEncoder();

export interface BuildKeyOptions {
  /** Who owns the key — "flags", "session", "ratelimit". No `:`. */
  namespace: string;
  /** The identifying pieces, joined with `:`. Numbers are stringified. No `:` in any. */
  parts?: (string | number)[];
  /** Put in front of everything. `client.key()` fills this from `KV_KEY_PREFIX`. */
  prefix?: string;
}

/**
 * Build `<prefix><namespace>:<part>:<part>`.
 *
 * ```ts
 * buildKey({ namespace: "flags", parts: ["doc", tenantId] }); // "flags:doc:t_42"
 * ```
 *
 * A `:` inside a namespace or a part is refused rather than escaped: allowing one would
 * let `{ namespace: "a", parts: ["b:c"] }` and `{ namespace: "a:b", parts: ["c"] }`
 * produce the same key, which is the collision the namespace exists to prevent. The
 * prefix is exempt, so `KV_KEY_PREFIX="staging:"` reads the way it looks.
 *
 * Throws `invalid_key` for a `:`, for an empty piece, and for a result over 512 bytes.
 */
export function buildKey(options: BuildKeyOptions): string {
  const { namespace, parts = [], prefix = "" } = options;

  assertPiece("namespace", namespace);
  for (const part of parts) {
    assertPiece("key part", String(part));
  }

  const key = prefix + [namespace, ...parts.map(String)].join(KEY_SEPARATOR);
  assertKey(key);
  return key;
}

/**
 * Check a key that arrived as a plain string — what the client runs on every `get`,
 * `set` and `delete`, so a hand-written key gets the same 512-byte answer on every
 * provider instead of a different vendor error on each.
 */
export function assertKey(key: string): void {
  if (key.length === 0) {
    throw new KvError("invalid_key", "The key is empty.");
  }

  const bytes = keyByteLength(key);
  if (bytes > MAX_KEY_BYTES) {
    throw new KvError(
      "invalid_key",
      `The key is ${bytes} bytes, over the ${MAX_KEY_BYTES}-byte limit. ` +
        `Hash the long part instead of putting it in the key: ${truncate(key)}`
    );
  }
}

/**
 * UTF-8 bytes, not characters. The limit is a byte limit, and an emoji or a CJK name in
 * a key part costs three or four bytes each — a 400-character key can be over 512 bytes.
 */
export function keyByteLength(key: string): number {
  return encoder.encode(key).length;
}

function assertPiece(label: string, value: string): void {
  if (value.length === 0) {
    throw new KvError("invalid_key", `The ${label} is empty.`);
  }
  if (value.includes(KEY_SEPARATOR)) {
    throw new KvError(
      "invalid_key",
      `The ${label} ${JSON.stringify(value)} contains "${KEY_SEPARATOR}", which ` +
        `separates the parts of a key. Pass it as its own part instead.`
    );
  }
}

function truncate(key: string): string {
  return key.length > 64 ? `${key.slice(0, 64)}…` : key;
}
