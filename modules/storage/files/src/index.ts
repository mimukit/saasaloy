import { defineStorage } from "./define";
import type { StorageEnv } from "./provider";

export { defineStorage } from "./define";
export {
  DEFAULT_MAX_UPLOAD_BYTES,
  DOWNLOAD_URL_TTL_SECONDS,
  MAX_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from "./define";
export type {
  DownloadTarget,
  DownloadUrlOptions,
  StorageClient,
  StorageConfig,
  StorageRegistry,
  UploadTarget,
  UploadUrlOptions,
} from "./define";
export {
  assertValidKey,
  buildKey,
  isValidKey,
  sanitizeFilename,
  tenantPrefix,
} from "./keys";
export type { KeyParts } from "./keys";
export { StorageError } from "./provider";
export type {
  ListOptions,
  ListResult,
  MultipartUpload,
  PresignedRequest,
  PresignOptions,
  PutOptions,
  StorageBody,
  StorageEnv,
  StorageErrorCode,
  StorageErrorOptions,
  StorageObject,
  StorageObjectBody,
  StorageProvider,
  UploadedPart,
} from "./provider";
export { signToken, verifyToken } from "./token";
export type { StorageTokenClaims } from "./token";

// The provider registry, and the patch point every `storage-<provider>` module writes
// into. `saasaloy add storage-cloudflare` adds its import and appends `cloudflare()`
// here — idempotently, so re-running it changes nothing.
//
// Keep this line in exactly this shape: `export const <name> = <fn>({ <prop>: [...] })`
// with a real array literal. The codemod behind the `plugin-array` patch kind
// (packages/cli/src/lib/patch/ts-module.ts) has nothing to push into otherwise, and a
// provider install fails silently. Never omit `providers`, even while it's empty.
export const storage = defineStorage({ providers: [] });

/**
 * Get a storage client for this request's environment. Mirrors `createEmail(c.env)`:
 * it takes the whole `env`, because which key the active provider reads (an R2
 * binding, an API secret, nothing) is precisely what a calling route isn't supposed to
 * know.
 *
 * ```ts
 * const files = createStorage(c.env);
 * const key = buildKey({ tenantId, scope: "uploads", id, filename });
 * const target = await files.createUploadUrl(key, { contentType });
 * ```
 *
 * Throws when `STORAGE_PROVIDER` is unset or names a provider that isn't installed.
 */
export function createStorage(env: StorageEnv) {
  return storage.create(env);
}
