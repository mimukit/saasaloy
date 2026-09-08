// The provider contract every `storage-<provider>` module implements, plus the single
// error type providers normalize their failures into. Nothing in this file imports a
// vendor SDK or a Workers binding — the core of `packages/storage` is provider-agnostic
// and has zero runtime dependencies (ADR 0020, ADR 0035).

/**
 * The Worker environment, handed to `createStorage(env)` whole rather than one binding
 * at a time. Deliberately opaque: *which* key a provider reads (a `BUCKET` R2 binding,
 * an `R2_SECRET_ACCESS_KEY` secret, nothing at all) is exactly what the calling route
 * must not have to know for providers to stay swappable.
 */
export interface StorageEnv {
  /** Which registered provider stores bytes. Always required — there is no default. */
  STORAGE_PROVIDER?: string;
  /** HMAC key for the signed proxy links. Generate with `openssl rand -base64 32`. */
  STORAGE_URL_SECRET?: string;
  /** Per-file upload cap in bytes. Defaults to 104857600 (100 MiB). */
  STORAGE_MAX_UPLOAD_BYTES?: string | number;
  /**
   * Absolute origin the proxy route answers on (e.g. `https://api.x.com`). Optional:
   * with it unset a proxy target is a root-relative URL, which is right whenever the
   * uploader and the api share an origin.
   */
  STORAGE_PROXY_URL?: string;
  [key: string]: unknown;
}

/** What a provider accepts as a body. Every shape a Worker can already hand a binding. */
export type StorageBody =
  ArrayBuffer | ArrayBufferView | Blob | ReadableStream | string;

/** An object's metadata, with no body attached. Returned by `head`, `put` and `list`. */
export interface StorageObject {
  key: string;
  size: number;
  /** The provider's version marker, when it has one. Never parsed by the core. */
  etag?: string;
  contentType?: string;
  uploadedAt?: Date;
  /** Small user metadata the provider round-trips verbatim. */
  metadata?: Record<string, string>;
}

/** `head` plus the bytes. `body` is a stream so a proxy route never buffers a file. */
export interface StorageObjectBody extends StorageObject {
  body: ReadableStream | null;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface PutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface ListOptions {
  prefix?: string;
  limit?: number;
  /** Opaque continuation token from a previous `ListResult`. */
  cursor?: string;
}

export interface ListResult {
  objects: StorageObject[];
  truncated: boolean;
  cursor?: string;
}

/**
 * What a provider returns from `presignPut` / `presignGet`, or `undefined` when it
 * cannot sign — no API credentials, or no signing at all. `undefined` is not a failure:
 * the core falls back to the proxy route, so `storage-memory` and an R2 bucket with no
 * API token both accept the same upload from the same UI.
 */
export interface PresignedRequest {
  url: string;
  method: "GET" | "PUT";
  headers?: Record<string, string>;
  expiresAt: Date;
}

export interface PresignOptions {
  /** Seconds until the link stops working. The core clamps this before it gets here. */
  expiresIn: number;
  contentType?: string;
}

/** A multipart upload in progress. `uploadId` is the provider's own handle. */
export interface MultipartUpload {
  key: string;
  uploadId: string;
}

/** One finished part. Handed back to `completeMultipart` in part-number order. */
export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/**
 * The contract. `put`, `get`, `head`, `delete` and `list` are required of every
 * provider. Presigning and multipart are optional, and the core answers a call to an
 * absent one with `StorageError` code `not_supported`, so a caller branches on a stable
 * code rather than on a missing function.
 */
export interface StorageProvider {
  /** The value `STORAGE_PROVIDER` must hold to select this provider (e.g. "cloudflare"). */
  name: string;

  put(
    env: StorageEnv,
    key: string,
    body: StorageBody,
    options?: PutOptions
  ): Promise<StorageObject>;
  /** Resolves `null` for an object that is not there — absence is not an error. */
  get(env: StorageEnv, key: string): Promise<StorageObjectBody | null>;
  head(env: StorageEnv, key: string): Promise<StorageObject | null>;
  delete(env: StorageEnv, key: string): Promise<void>;
  list(env: StorageEnv, options?: ListOptions): Promise<ListResult>;

  presignPut?(
    env: StorageEnv,
    key: string,
    options: PresignOptions
  ): Promise<PresignedRequest | undefined>;
  presignGet?(
    env: StorageEnv,
    key: string,
    options: PresignOptions
  ): Promise<PresignedRequest | undefined>;

  createMultipartUpload?(
    env: StorageEnv,
    key: string,
    options?: PutOptions
  ): Promise<MultipartUpload>;
  /**
   * Write one part through the binding. Optional like the rest of multipart, and the
   * path `storage-memory` and the export job use — `presignPart` is the browser's path
   * and only a signing provider has it.
   */
  uploadPart?(
    env: StorageEnv,
    upload: MultipartUpload,
    partNumber: number,
    body: StorageBody
  ): Promise<UploadedPart>;
  presignPart?(
    env: StorageEnv,
    upload: MultipartUpload,
    partNumber: number,
    options: PresignOptions
  ): Promise<PresignedRequest | undefined>;
  completeMultipart?(
    env: StorageEnv,
    upload: MultipartUpload,
    parts: UploadedPart[]
  ): Promise<StorageObject>;
  abortMultipart?(env: StorageEnv, upload: MultipartUpload): Promise<void>;
}

/**
 * Normalized failure codes. Providers map their own vendor codes onto these and keep
 * the raw one in `providerCode`, so a caller can branch on a stable value without
 * learning any provider's error vocabulary.
 *
 * - `not_found` — the key names no object, on an operation that needs one.
 * - `invalid_key` — the key (or a signed token carrying it) failed the core's checks.
 * - `too_large` — the body exceeds a cap the provider or the token enforces.
 * - `rate_limited` — the vendor asked for a slower caller. Usually `retryable`.
 * - `not_supported` — the selected provider does not implement this optional method.
 * - `provider_error` — everything else the vendor reported.
 */
export type StorageErrorCode =
  | "not_found"
  | "invalid_key"
  | "too_large"
  | "rate_limited"
  | "not_supported"
  | "provider_error";

export interface StorageErrorOptions {
  /** Whether repeating the same call could plausibly succeed. */
  retryable?: boolean;
  /** The provider's own code, verbatim (e.g. "NoSuchKey"). */
  providerCode?: string;
  cause?: unknown;
}

/**
 * The one error a storage call throws, so a caller's `catch` only ever has one shape to
 * handle. (Selecting the provider happens earlier, in `createStorage(env)`, and a bad
 * `STORAGE_PROVIDER` throws a plain `Error` there: it is a deploy-time
 * misconfiguration, not a failed object operation. A missing `STORAGE_URL_SECRET` is
 * the same kind of fault and throws the same way.)
 *
 * The package never retries — a retry loop inside a request handler holds the Worker's
 * response open. `retryable` is the hook for a caller, or a queue consumer, to decide.
 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly retryable: boolean;
  readonly providerCode?: string;

  constructor(
    code: StorageErrorCode,
    message: string,
    options: StorageErrorOptions = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "StorageError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerCode = options.providerCode;
  }
}
