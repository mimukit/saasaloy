// The checks an api route runs when the bytes come through the Worker: read the body with
// a cap, name the file by its signature, and check later that a key a caller sends back
// is one this caller was given. They are plain functions over bytes and strings, so the
// core stays vendor-blind and a route composes them with `buildKey` and `put`:
//
//   const bytes = await readLimited(c.req.raw.body, 5 * 1024 * 1024);
//   if (bytes === null) return c.json(errorBody("too_large", "…"), 413);
//   const sniffed = sniffType(bytes, ["image/jpeg", "image/png"]);
//   if (sniffed === null) return c.json(errorBody("invalid_input", "…"), 415);
//   const key = buildKey({ tenantId, scope, id, filename: `${crypto.randomUUID()}.${sniffed.extension}` });
//   await createStorage(c.env).put(key, bytes, { contentType: sniffed.type });
//
// A refusal returns null and the route picks the status. Only a programmer error throws:
// a cap that is not a positive whole number, or key parts `buildKey` rejects.
//
// The direct-to-bucket path (a presigned PUT) never passes through these. That path
// belongs to the `file-uploads` module, which checks what arrived after the fact.

import { buildKey, isValidKey } from "./keys";
import type { KeyParts } from "./keys";

/**
 * Read a request body into memory, and give up at `maxBytes`.
 *
 * The cap is counted on the bytes that arrive, not on `Content-Length`, so a chunked
 * body with no length header is capped the same way. Past the cap the stream is
 * cancelled and the result is `null`; a missing body reads as zero bytes.
 *
 * It buffers the whole file, so keep `maxBytes` far below the Worker's memory. Above
 * about 10 MB use the `file-uploads` module's direct path instead.
 */
export async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    // A NaN cap would let every body through, because `size > NaN` is never true.
    throw new RangeError(
      `readLimited: maxBytes must be a positive whole number, got ${String(maxBytes)}.`
    );
  }
  if (body === null) {
    return new Uint8Array();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** The types `sniffType` can name from a file signature. */
export type SniffedType =
  "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf";

export interface Sniffed {
  type: SniffedType;
  /** Without the dot: "jpg", "png", "webp", "gif", "pdf". */
  extension: string;
}

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCodePoint(...bytes.subarray(start, end));

const SIGNATURES: readonly {
  type: SniffedType;
  extension: string;
  matches: (bytes: Uint8Array) => boolean;
}[] = [
  {
    type: "image/jpeg",
    extension: "jpg",
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: "image/png",
    extension: "png",
    matches: (b) =>
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => b[index] === value
      ),
  },
  {
    type: "image/webp",
    extension: "webp",
    matches: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  },
  {
    type: "image/gif",
    extension: "gif",
    matches: (b) => ["GIF87a", "GIF89a"].includes(ascii(b, 0, 6)),
  },
  {
    type: "application/pdf",
    extension: "pdf",
    matches: (b) => ascii(b, 0, 5) === "%PDF-",
  },
];

/**
 * Name a file by its first bytes, never by the browser's content type or the filename.
 *
 * Returns the type and an extension to build the key with, or `null` when the bytes
 * match none of `allowed`. A PNG renamed `receipt.pdf` comes back as a PNG, so a route
 * that allows only PDF refuses it.
 */
export function sniffType(
  bytes: Uint8Array,
  allowed: readonly SniffedType[]
): Sniffed | null {
  for (const signature of SIGNATURES) {
    if (allowed.includes(signature.type) && signature.matches(bytes)) {
      return { type: signature.type, extension: signature.extension };
    }
  }
  return null;
}

export interface OwnsKeyOptions {
  /** Checked against the last key segment, the filename. */
  filename?: RegExp;
}

/**
 * True when `key` is an object `buildKey` would have made for these parts.
 *
 * Run it on the later request that saves a key a caller sent back, such as a form that
 * uploads a receipt first and submits the payment second. A key under another tenant,
 * another scope or another record is refused, and so is anything `isValidKey` rejects.
 * Pass `filename` to pin the name too, for example `/^[a-f\d-]{36}\.(jpg|png)$/` when
 * the route named the file itself.
 *
 * Throws `StorageError` with code `invalid_key` when the parts themselves are not valid
 * key segments, because that is the route's bug, not the caller's.
 */
export function ownsKey(
  key: string,
  parts: Omit<KeyParts, "filename">,
  options: OwnsKeyOptions = {}
): boolean {
  // `buildKey` validates every part, so the prefix is built exactly as an upload builds it.
  const prefix = buildKey({ ...parts, filename: "x" }).slice(0, -1);
  if (!isValidKey(key) || !key.startsWith(prefix)) {
    return false;
  }
  const filename = key.slice(prefix.length);
  return options.filename === undefined || options.filename.test(filename);
}
