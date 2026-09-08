// The signed token that authorizes the proxy route. `createUploadUrl` puts one in the
// query string and `@api/routes/storage.ts` verifies it before it reads a byte of the
// request body.
//
// Web Crypto (HMAC-SHA256) rather than a JWT library, for one reason: `packages/storage`
// has zero runtime dependencies, and a signed blob with five fields needs no library.
// The token is a bearer credential — whoever holds it can do exactly what it says until
// it expires, which is why every expiry the core issues is short.
//
// The proxy route is authorized by this token and not by a session on purpose. It is
// what makes the two upload targets interchangeable: the browser does the same PUT to a
// presigned R2 URL or to the proxy, and neither one carries a cookie.

import { StorageError } from "./provider";
import type { StorageEnv } from "./provider";

/** What a token says. Everything the proxy route needs, and nothing else. */
export interface StorageTokenClaims {
  /** The one key this token authorizes. */
  key: string;
  method: "GET" | "PUT";
  /** Expiry, as whole seconds since the epoch. */
  exp: number;
  /** The cap the route enforces on an inbound `content-length`. */
  maxBytes?: number;
  /** The content type the route stores the body as. */
  contentType?: string;
}

const encoder = new TextEncoder();

/**
 * Sign the claims. Returns `<payload>.<signature>`, both base64url, safe in a query
 * string.
 */
export async function signToken(
  env: StorageEnv,
  claims: StorageTokenClaims
): Promise<string> {
  const key = await importSecret(env);
  const payload = encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verify a token and return its claims. Throws `StorageError` code `invalid_key` when
 * the token is malformed, was signed with another secret, was edited, or has expired —
 * one code for every "this token does not authorize this request", so the route answers
 * a 403 without telling the holder which check failed.
 *
 * `now` exists for the tests; leave it unset in a route.
 */
export async function verifyToken(
  env: StorageEnv,
  token: string,
  now: Date = new Date()
): Promise<StorageTokenClaims> {
  const key = await importSecret(env);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    throw invalidToken("malformed");
  }

  // `crypto.subtle.verify` does the constant-time compare itself, so no signature bytes
  // are compared in JavaScript.
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(signature),
    encoder.encode(payload)
  );
  if (!ok) {
    throw invalidToken("signature does not match");
  }

  const claims = parseClaims(payload);
  if (claims.exp * 1000 <= now.getTime()) {
    throw invalidToken("expired");
  }
  return claims;
}

function parseClaims(payload: string): StorageTokenClaims {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
  } catch (error) {
    throw invalidToken("payload is not JSON", error);
  }

  // The signature already proves we wrote this, so these checks catch our own mistakes
  // rather than an attacker's. They still run: a route that trusts `claims.key` without
  // one would be trusting the shape of a string.
  if (typeof parsed !== "object" || parsed === null) {
    throw invalidToken("payload is not an object");
  }
  const claims = parsed as Partial<StorageTokenClaims>;
  if (
    typeof claims.key !== "string" ||
    typeof claims.exp !== "number" ||
    (claims.method !== "GET" && claims.method !== "PUT")
  ) {
    throw invalidToken("payload is missing key, method or exp");
  }
  return claims as StorageTokenClaims;
}

function invalidToken(reason: string, cause?: unknown): StorageError {
  return new StorageError("invalid_key", `Storage token rejected: ${reason}.`, {
    cause,
  });
}

/**
 * A signing key that silently defaults is worse than a loud failure, so nothing here
 * generates one. The message names the variable and the command, because this fires on
 * a developer's first upload in local dev, which is exactly where it should.
 */
async function importSecret(env: StorageEnv): Promise<CryptoKey> {
  const secret = env.STORAGE_URL_SECRET;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(
      "STORAGE_URL_SECRET is not set, so storage cannot sign or verify an upload link. " +
        "Generate one with `openssl rand -base64 32`, put it in `.dev.vars` for local dev, " +
        "and set it in production with `wrangler secret put STORAGE_URL_SECRET`."
    );
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"]
  );
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

// The `Uint8Array<ArrayBuffer>` return type is load-bearing: `crypto.subtle` takes a
// `BufferSource`, and a plain `Uint8Array` is `Uint8Array<ArrayBufferLike>`, which could
// be backed by a `SharedArrayBuffer` and is therefore not assignable.
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch (error) {
    throw invalidToken("not base64url", error);
  }
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  return bytes;
}
