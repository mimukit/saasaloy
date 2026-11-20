import { defineStorage } from "./define";
import type { StorageEnv } from "./provider";
import { storageProviders } from "./providers.generated";

export { defineStorage } from "./define";
export {
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
export { ownsKey, readLimited, sniffType } from "./upload";
export type { OwnsKeyOptions, Sniffed, SniffedType } from "./upload";

// The provider registry. Every `storage-<provider>` module adds a row to the
// `storage.providers` table, and the CLI writes `./providers.generated.ts` from those rows
// on every run: `saasaloy add storage-cloudflare` adds `cloudflare()`, and
// `saasaloy remove` takes it back out. A provider of your own goes after the spread, never in the generated
// file: the CLI overwrites it, and `saasaloy update` refuses when it was edited.
export const storage = defineStorage({ providers: [...storageProviders] });

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
