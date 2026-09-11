// The provider registry and the `createStorage(env)` factory behind it. This file holds
// everything that is true of *every* provider — selection, the presign-or-proxy choice,
// link expiry, the `not_supported` answer for an optional method a provider lacks, and
// the wrap that keeps one error shape at the boundary — so a provider module only ever
// ships the operations that differ per vendor.

import { assertValidKey } from "./keys";
import { StorageError } from "./provider";
import { signToken } from "./token";
import type {
  ListOptions,
  ListResult,
  MultipartUpload,
  PutOptions,
  StorageBody,
  StorageEnv,
  StorageObject,
  StorageObjectBody,
  StorageProvider,
  UploadedPart,
} from "./provider";

/** How long an upload link lives. Short: it is a bearer credential for one key. */
export const UPLOAD_URL_TTL_SECONDS = 300;
/** How long a download link lives. */
export const DOWNLOAD_URL_TTL_SECONDS = 3600;
/**
 * The ceiling on any `expiresIn`. A presigned R2 URL cannot be revoked before it
 * expires, so the cap is the only control the capability has over a forwarded link.
 */
export const MAX_URL_TTL_SECONDS = 86_400;
/** The per-file cap when `STORAGE_MAX_UPLOAD_BYTES` is unset: 100 MiB. */
export const DEFAULT_MAX_UPLOAD_BYTES = 104_857_600;

/** Where the proxy route is mounted, by `modules/storage`'s `chained-route` patch. */
const PROXY_PATH = "/storage/objects";

export interface StorageConfig {
  providers: StorageProvider[];
}

/**
 * A URL the browser sends a file to. `direct: true` is a presigned URL on the vendor,
 * so the bytes never touch the Worker; `direct: false` is the capability's own proxy
 * route, which streams them through the binding. The caller does the same PUT either
 * way — that is what lets `storage-memory` and an R2 bucket with no API token serve the
 * same UI.
 */
export interface UploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: Date;
  direct: boolean;
}

/** The mirror of `UploadTarget` for reading. */
export interface DownloadTarget {
  url: string;
  method: "GET";
  headers: Record<string, string>;
  expiresAt: Date;
  direct: boolean;
}

export interface UploadUrlOptions {
  /** Seconds until the link expires. Defaults to 300, clamped at 86400. */
  expiresIn?: number;
  contentType?: string;
  /** Caps the body the proxy route accepts. Defaults to `client.maxUploadBytes`. */
  maxBytes?: number;
  /** Overrides `STORAGE_PROXY_URL` for one link. */
  baseUrl?: string;
}

export interface DownloadUrlOptions {
  /** Seconds until the link expires. Defaults to 3600, clamped at 86400. */
  expiresIn?: number;
  baseUrl?: string;
}

/** What a caller stores with. Returned by `createStorage(env)`. */
export interface StorageClient {
  /** The selected provider's name — handy in logs, in a record, and in a `doctor` check. */
  provider: string;
  /** The resolved per-file cap in bytes, from `STORAGE_MAX_UPLOAD_BYTES`. */
  maxUploadBytes: number;

  put(
    key: string,
    body: StorageBody,
    options?: PutOptions
  ): Promise<StorageObject>;
  get(key: string): Promise<StorageObjectBody | null>;
  head(key: string): Promise<StorageObject | null>;
  delete(key: string): Promise<void>;
  list(options?: ListOptions): Promise<ListResult>;

  createUploadUrl(
    key: string,
    options?: UploadUrlOptions
  ): Promise<UploadTarget>;
  createDownloadUrl(
    key: string,
    options?: DownloadUrlOptions
  ): Promise<DownloadTarget>;

  createMultipartUpload(
    key: string,
    options?: PutOptions
  ): Promise<MultipartUpload>;
  uploadPart(
    upload: MultipartUpload,
    partNumber: number,
    body: StorageBody
  ): Promise<UploadedPart>;
  completeMultipart(
    upload: MultipartUpload,
    parts: UploadedPart[]
  ): Promise<StorageObject>;
  abortMultipart(upload: MultipartUpload): Promise<void>;
}

export interface StorageRegistry {
  providers: StorageProvider[];
  create(env: StorageEnv): StorageClient;
}

/**
 * Build the provider registry. The `providers` array is the patch point every
 * `storage-<provider>` module appends to — see `src/index.ts`.
 */
export function defineStorage(config: StorageConfig): StorageRegistry {
  const { providers } = config;

  return {
    create(env: StorageEnv): StorageClient {
      const provider = selectProvider(providers, env.STORAGE_PROVIDER);
      const maxUploadBytes = resolveMaxUploadBytes(env);

      /**
       * Every provider call goes through here. A provider is contractually responsible
       * for normalizing its own failures, but a bespoke one written in a consumer's
       * project may not, and a raw `TypeError` from a failed `fetch` reaching the caller
       * would break the single-error-shape promise `provider.ts` makes.
       */
      async function run<T>(
        operation: string,
        call: () => Promise<T>
      ): Promise<T> {
        try {
          return await call();
        } catch (error) {
          if (error instanceof StorageError) {
            throw error;
          }
          throw new StorageError(
            "provider_error",
            `${provider.name}: ${operation} failed`,
            { cause: error, retryable: false }
          );
        }
      }

      /** An optional method the selected provider does not implement. */
      function unsupported(operation: string): StorageError {
        return new StorageError(
          "not_supported",
          `Provider "${provider.name}" does not implement ${operation}. Select a provider that does, or use the proxy path.`
        );
      }

      /**
       * A presigned request when the provider can sign one, `undefined` when it cannot.
       * `undefined` is not a failure: it is how a provider says "no API credentials", and
       * the caller below falls back to the proxy route.
       */
      async function presign(
        method: "GET" | "PUT",
        key: string,
        expiresIn: number,
        contentType?: string
      ) {
        const sign =
          method === "PUT" ? provider.presignPut : provider.presignGet;
        if (!sign) {
          return;
        }
        return run(`presign ${method}`, () =>
          sign.call(provider, env, key, { contentType, expiresIn })
        );
      }

      /** The capability's own route, authorized by a short-lived HMAC token. */
      async function proxyUrl(
        method: "GET" | "PUT",
        key: string,
        expiresAt: Date,
        extra: {
          maxBytes?: number;
          contentType?: string;
          baseUrl?: string;
        } = {}
      ): Promise<string> {
        const token = await signToken(env, {
          contentType: extra.contentType,
          exp: Math.floor(expiresAt.getTime() / 1000),
          key,
          maxBytes: extra.maxBytes,
          method,
        });
        // With no origin configured the link is root-relative, which is right whenever
        // the uploader and the api share an origin. A separate admin SPA sets
        // `STORAGE_PROXY_URL` to the api's origin, or passes `baseUrl` per link.
        const configured =
          extra.baseUrl ??
          (typeof env.STORAGE_PROXY_URL === "string"
            ? env.STORAGE_PROXY_URL
            : "");
        return `${trimSlash(configured)}${PROXY_PATH}?token=${encodeURIComponent(token)}`;
      }

      return {
        async abortMultipart(upload: MultipartUpload): Promise<void> {
          const abort = provider.abortMultipart;
          if (!abort) {
            throw unsupported("abortMultipart");
          }
          return run("abortMultipart", () => abort.call(provider, env, upload));
        },

        async completeMultipart(
          upload: MultipartUpload,
          parts: UploadedPart[]
        ): Promise<StorageObject> {
          const complete = provider.completeMultipart;
          if (!complete) {
            throw unsupported("completeMultipart");
          }
          return run("completeMultipart", () =>
            complete.call(provider, env, upload, parts)
          );
        },

        createDownloadUrl: async (
          key: string,
          options: DownloadUrlOptions = {}
        ): Promise<DownloadTarget> => {
          assertValidKey(key);
          const expiresIn = clampTtl(
            options.expiresIn ?? DOWNLOAD_URL_TTL_SECONDS
          );
          const expiresAt = new Date(Date.now() + expiresIn * 1000);

          const signed = await presign("GET", key, expiresIn);
          if (signed) {
            return {
              direct: true,
              expiresAt: signed.expiresAt,
              headers: signed.headers ?? {},
              method: "GET",
              url: signed.url,
            };
          }
          return {
            direct: false,
            expiresAt,
            headers: {},
            method: "GET",
            url: await proxyUrl("GET", key, expiresAt, {
              baseUrl: options.baseUrl,
            }),
          };
        },

        async createMultipartUpload(
          key: string,
          options?: PutOptions
        ): Promise<MultipartUpload> {
          assertValidKey(key);
          const start = provider.createMultipartUpload;
          if (!start) {
            throw unsupported("createMultipartUpload");
          }
          return run("createMultipartUpload", () =>
            start.call(provider, env, key, options)
          );
        },

        createUploadUrl: async (
          key: string,
          options: UploadUrlOptions = {}
        ): Promise<UploadTarget> => {
          assertValidKey(key);
          const expiresIn = clampTtl(
            options.expiresIn ?? UPLOAD_URL_TTL_SECONDS
          );
          const expiresAt = new Date(Date.now() + expiresIn * 1000);
          const maxBytes = options.maxBytes ?? maxUploadBytes;

          const signed = await presign(
            "PUT",
            key,
            expiresIn,
            options.contentType
          );
          if (signed) {
            // A presigned PUT carries no size cap: S3 query signing has nothing to
            // enforce one with. `maxBytes` still rides in the token on the proxy path,
            // and the feature's `complete` step is what catches an oversize object on
            // either path.
            return {
              direct: true,
              expiresAt: signed.expiresAt,
              headers: signed.headers ?? {},
              method: "PUT",
              url: signed.url,
            };
          }
          return {
            direct: false,
            expiresAt,
            headers: options.contentType
              ? { "content-type": options.contentType }
              : {},
            method: "PUT",
            url: await proxyUrl("PUT", key, expiresAt, {
              baseUrl: options.baseUrl,
              contentType: options.contentType,
              maxBytes,
            }),
          };
        },

        async delete(key: string): Promise<void> {
          assertValidKey(key);
          return run("delete", () => provider.delete(env, key));
        },

        async get(key: string): Promise<StorageObjectBody | null> {
          assertValidKey(key);
          return run("get", () => provider.get(env, key));
        },

        async head(key: string): Promise<StorageObject | null> {
          assertValidKey(key);
          return run("head", () => provider.head(env, key));
        },

        async list(options?: ListOptions): Promise<ListResult> {
          return run("list", () => provider.list(env, options));
        },

        maxUploadBytes,

        provider: provider.name,

        async put(
          key: string,
          body: StorageBody,
          options?: PutOptions
        ): Promise<StorageObject> {
          assertValidKey(key);
          return run("put", () => provider.put(env, key, body, options));
        },

        async uploadPart(
          upload: MultipartUpload,
          partNumber: number,
          body: StorageBody
        ): Promise<UploadedPart> {
          const write = provider.uploadPart;
          if (!write) {
            throw unsupported("uploadPart");
          }
          return run("uploadPart", () =>
            write.call(provider, env, upload, partNumber, body)
          );
        },
      };
    },
    providers,
  };
}

/**
 * `STORAGE_PROVIDER` is required even when exactly one provider is installed, and an
 * unknown value is an error rather than a fallback. Both directions of the silent
 * failure are worse than a throw: a production deploy that quietly writes nowhere, and
 * a test run that quietly writes to a real bucket.
 */
function selectProvider(
  providers: StorageProvider[],
  selected: string | undefined
): StorageProvider {
  const registered = providers.map((p) => p.name);
  const known =
    registered.length > 0
      ? `Registered providers: ${registered.join(", ")}.`
      : "No providers are registered — install one, e.g. `saasaloy add storage-memory`.";

  if (!selected) {
    throw new Error(`STORAGE_PROVIDER is not set. ${known}`);
  }

  const provider = providers.find((p) => p.name === selected);
  if (!provider) {
    throw new Error(
      `STORAGE_PROVIDER is "${selected}", which is not registered. ${known}`
    );
  }
  return provider;
}

/** An unreadable cap is a deploy-time mistake, so it throws where the provider does. */
function resolveMaxUploadBytes(env: StorageEnv): number {
  const raw = env.STORAGE_MAX_UPLOAD_BYTES;
  if (raw === undefined || raw === "") {
    return DEFAULT_MAX_UPLOAD_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `STORAGE_MAX_UPLOAD_BYTES is "${String(raw)}", which is not a positive whole number of bytes.`
    );
  }
  return parsed;
}

function clampTtl(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return UPLOAD_URL_TTL_SECONDS;
  }
  return Math.min(Math.floor(seconds), MAX_URL_TTL_SECONDS);
}

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
