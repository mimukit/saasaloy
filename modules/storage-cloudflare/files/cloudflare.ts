import { AwsClient } from "aws4fetch";
import { StorageError } from "../provider";
import type {
  ListOptions,
  ListResult,
  MultipartUpload,
  PresignedRequest,
  PresignOptions,
  PutOptions,
  StorageBody,
  StorageEnv,
  StorageErrorCode,
  StorageObject,
  StorageObjectBody,
  StorageProvider,
  UploadedPart,
} from "../provider";

// Cloudflare R2, in the two ways R2 can be reached, because neither one alone is
// enough.
//
// 1. The **binding** (`BUCKET` in apps/api/wrangler.jsonc) does every read and write.
//    It needs no secret — the binding is the credential — and it is the only path that
//    works with nothing else configured.
// 2. The **S3-compatible API**, signed with `aws4fetch`, produces the presigned PUT and
//    GET a browser uses directly. The binding cannot sign a URL, so this is not
//    optional decoration: without it every byte would stream through the Worker.
//
// Signing needs an R2 API token, which the binding does not supply. So `R2_ACCOUNT_ID`,
// `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET_NAME` are all optional, and
// with any one of them missing `presignPut` / `presignGet` return `undefined`. That is
// not a failure: the core reads it as "this provider cannot sign" and hands back its
// own proxy URL instead, so an R2 bucket with no API token serves the same upload UI as
// a fully configured one. One module, both modes.
//
// `R2Bucket`, `R2Object` and friends are ambient globals from
// @cloudflare/workers-types, which packages/storage already carries as a devDependency.
// The single npm dependency is `aws4fetch` (zero dependencies of its own), patched into
// packages/storage/package.json by this module's descriptor — ADR 0020 keeps a vendor
// package inside the capability that owns it.

export interface CloudflareStorageOptions {
  /** Binding name in wrangler.jsonc. The module's own patch writes `BUCKET`. */
  binding?: string;
}

/** The four values that must all be present before this provider can sign a URL. */
interface R2ApiCredentials {
  accessKeyId: string;
  accountId: string;
  bucketName: string;
  secretAccessKey: string;
}

/**
 * R2 reports a failure two ways, and this table covers both. The binding throws an
 * error carrying a numeric `code`; the S3 API answers with an XML error whose `Code` is
 * a name. Anything unlisted falls through to `provider_error` / `retryable: false`,
 * because guessing that an unknown failure is safe to retry is the more expensive
 * mistake — a hot loop against a hard rejection, or a duplicate write. Add a row when
 * you meet a new code in the wild.
 */
const ERROR_CODES: Record<
  string,
  { code: StorageErrorCode; retryable: boolean }
> = {
  // Binding codes. 10006 is a deploy fault, not a caller fault: the bucket named in
  // wrangler.jsonc does not exist, and retrying will not create it.
  "10006": { code: "provider_error", retryable: false },
  "10007": { code: "not_found", retryable: false },
  // A status, for an error that carries nothing else. Only the three that say something
  // a caller can act on.
  "429": { code: "rate_limited", retryable: true },
  "500": { code: "provider_error", retryable: true },
  "503": { code: "provider_error", retryable: true },
  EntityTooLarge: { code: "too_large", retryable: false },
  // S3-compatible API codes.
  InternalError: { code: "provider_error", retryable: true },
  NoSuchBucket: { code: "provider_error", retryable: false },
  NoSuchKey: { code: "not_found", retryable: false },
  NoSuchUpload: { code: "not_found", retryable: false },
  ServiceUnavailable: { code: "provider_error", retryable: true },
  SlowDown: { code: "rate_limited", retryable: true },
  TooManyRequests: { code: "rate_limited", retryable: true },
};

export function cloudflare(
  options: CloudflareStorageOptions = {}
): StorageProvider {
  const bindingName = options.binding ?? "BUCKET";

  /** The binding, or a `StorageError` that names the wrangler entry to add. */
  function bucketOf(env: StorageEnv): R2Bucket {
    const binding = env[bindingName] as R2Bucket | undefined;
    if (!binding || typeof binding.put !== "function") {
      throw new StorageError(
        "provider_error",
        `No \`${bindingName}\` R2 binding on this Worker's env. Add an r2_buckets entry ` +
          `with binding "${bindingName}" to apps/api/wrangler.jsonc, and create the ` +
          "bucket with `wrangler r2 bucket create <name>`."
      );
    }
    return binding;
  }

  /**
   * Sign one request against the S3-compatible endpoint, or return `undefined` when the
   * four API values are not all set. `signQuery: true` puts the whole signature in the
   * query string, so the browser sends no Authorization header and no header the
   * signature depends on.
   *
   * The content type is deliberately NOT signed on a PUT. A signed header must be
   * reproduced byte for byte or R2 answers 403, and a browser normalizes what it sends;
   * the object's real type is confirmed by the feature's `complete` step, which heads
   * the object anyway.
   */
  async function sign(
    env: StorageEnv,
    method: "GET" | "PUT",
    key: string,
    presignOptions: PresignOptions,
    query: Record<string, string> = {}
  ): Promise<PresignedRequest | undefined> {
    const credentials = readCredentials(env);
    if (!credentials) {
      return undefined;
    }

    const url = new URL(objectUrl(credentials, key));
    url.searchParams.set("X-Amz-Expires", String(presignOptions.expiresIn));
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value);
    }

    const client = new AwsClient({
      accessKeyId: credentials.accessKeyId,
      // R2 has one region and it is spelled "auto". A real AWS region here signs a
      // request R2 rejects.
      region: "auto",
      secretAccessKey: credentials.secretAccessKey,
      service: "s3",
    });

    try {
      const signed = await client.sign(new Request(url, { method }), {
        aws: { signQuery: true },
      });
      return {
        expiresAt: new Date(Date.now() + presignOptions.expiresIn * 1000),
        method,
        url: signed.url,
      };
    } catch (error) {
      throw normalize(error);
    }
  }

  return {
    async abortMultipart(
      env: StorageEnv,
      upload: MultipartUpload
    ): Promise<void> {
      try {
        await bucketOf(env)
          .resumeMultipartUpload(upload.key, upload.uploadId)
          .abort();
      } catch (error) {
        throw normalize(error);
      }
    },

    async completeMultipart(
      env: StorageEnv,
      upload: MultipartUpload,
      parts: UploadedPart[]
    ): Promise<StorageObject> {
      try {
        const object = await bucketOf(env)
          .resumeMultipartUpload(upload.key, upload.uploadId)
          .complete(
            parts.map((part) => ({
              etag: part.etag,
              partNumber: part.partNumber,
            }))
          );
        return describe(object);
      } catch (error) {
        throw normalize(error);
      }
    },

    async createMultipartUpload(
      env: StorageEnv,
      key: string,
      putOptions?: PutOptions
    ): Promise<MultipartUpload> {
      try {
        const upload = await bucketOf(env).createMultipartUpload(
          key,
          putMetadata(putOptions)
        );
        return { key: upload.key, uploadId: upload.uploadId };
      } catch (error) {
        throw normalize(error);
      }
    },

    async delete(env: StorageEnv, key: string): Promise<void> {
      try {
        await bucketOf(env).delete(key);
      } catch (error) {
        throw normalize(error);
      }
    },

    async get(env: StorageEnv, key: string): Promise<StorageObjectBody | null> {
      try {
        const object = await bucketOf(env).get(key);
        if (!object) {
          // Absence is not an error in this contract: the core and the proxy route both
          // read `null` and answer 404 themselves.
          return null;
        }
        return {
          ...describe(object),
          arrayBuffer: () => object.arrayBuffer(),
          body: object.body,
          text: () => object.text(),
        };
      } catch (error) {
        throw normalize(error);
      }
    },

    async head(env: StorageEnv, key: string): Promise<StorageObject | null> {
      try {
        const object = await bucketOf(env).head(key);
        return object ? describe(object) : null;
      } catch (error) {
        throw normalize(error);
      }
    },

    async list(
      env: StorageEnv,
      listOptions: ListOptions = {}
    ): Promise<ListResult> {
      try {
        const result = await bucketOf(env).list({
          ...(listOptions.prefix ? { prefix: listOptions.prefix } : {}),
          ...(listOptions.limit ? { limit: listOptions.limit } : {}),
          ...(listOptions.cursor ? { cursor: listOptions.cursor } : {}),
        });
        return {
          objects: result.objects.map((object) => describe(object)),
          truncated: result.truncated,
          ...(result.truncated && result.cursor
            ? { cursor: result.cursor }
            : {}),
        };
      } catch (error) {
        throw normalize(error);
      }
    },

    name: "cloudflare",

    presignGet(
      env: StorageEnv,
      key: string,
      presignOptions: PresignOptions
    ): Promise<PresignedRequest | undefined> {
      return sign(env, "GET", key, presignOptions);
    },

    presignPart(
      env: StorageEnv,
      upload: MultipartUpload,
      partNumber: number,
      presignOptions: PresignOptions
    ): Promise<PresignedRequest | undefined> {
      return sign(env, "PUT", upload.key, presignOptions, {
        partNumber: String(partNumber),
        uploadId: upload.uploadId,
      });
    },

    presignPut(
      env: StorageEnv,
      key: string,
      presignOptions: PresignOptions
    ): Promise<PresignedRequest | undefined> {
      return sign(env, "PUT", key, presignOptions);
    },

    async put(
      env: StorageEnv,
      key: string,
      body: StorageBody,
      putOptions?: PutOptions
    ): Promise<StorageObject> {
      try {
        const object = await bucketOf(env).put(
          key,
          body as ReadableStream | ArrayBuffer | string,
          putMetadata(putOptions)
        );
        if (!object) {
          // R2 answers `null` when a conditional put does not run. Nothing here sends a
          // condition, so this means the write did not happen and the caller must not
          // be told it did.
          throw new StorageError(
            "provider_error",
            `R2 did not store "${key}".`,
            { retryable: true }
          );
        }
        return describe(object);
      } catch (error) {
        throw normalize(error);
      }
    },

    async uploadPart(
      env: StorageEnv,
      upload: MultipartUpload,
      partNumber: number,
      body: StorageBody
    ): Promise<UploadedPart> {
      try {
        const part = await bucketOf(env)
          .resumeMultipartUpload(upload.key, upload.uploadId)
          .uploadPart(
            partNumber,
            body as ReadableStream | ArrayBuffer | string
          );
        return { etag: part.etag, partNumber: part.partNumber };
      } catch (error) {
        throw normalize(error);
      }
    },
  };
}

/** All four, or nothing. A partial set signs a URL that R2 refuses. */
function readCredentials(env: StorageEnv): R2ApiCredentials | undefined {
  const accountId = readString(env.R2_ACCOUNT_ID);
  const accessKeyId = readString(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = readString(env.R2_SECRET_ACCESS_KEY);
  const bucketName = readString(env.R2_BUCKET_NAME);

  if (!(accountId && accessKeyId && secretAccessKey && bucketName)) {
    return undefined;
  }
  return { accessKeyId, accountId, bucketName, secretAccessKey };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The S3-compatible address of one object. Each key segment is escaped separately, so
 * the `/` that separates them survives and anything inside a segment does not.
 */
function objectUrl(credentials: R2ApiCredentials, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `https://${credentials.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(credentials.bucketName)}/${path}`;
}

function putMetadata(options?: PutOptions): R2PutOptions {
  return {
    ...(options?.contentType
      ? { httpMetadata: { contentType: options.contentType } }
      : {}),
    ...(options?.metadata ? { customMetadata: { ...options.metadata } } : {}),
  };
}

function describe(object: R2Object): StorageObject {
  return {
    etag: object.httpEtag,
    key: object.key,
    size: object.size,
    uploadedAt: object.uploaded,
    ...(object.httpMetadata?.contentType
      ? { contentType: object.httpMetadata.contentType }
      : {}),
    ...(object.customMetadata ? { metadata: object.customMetadata } : {}),
  };
}

function normalize(cause: unknown): StorageError {
  if (cause instanceof StorageError) {
    return cause;
  }

  const providerCode = readCode(cause);
  const mapped = providerCode ? ERROR_CODES[providerCode] : undefined;
  const message = cause instanceof Error ? cause.message : String(cause);

  return new StorageError(mapped?.code ?? "provider_error", message, {
    cause,
    retryable: mapped?.retryable ?? false,
    ...(providerCode ? { providerCode } : {}),
  });
}

/**
 * The vendor's own code, kept verbatim in `providerCode` whatever shape it arrives in:
 * a number on a binding error, a name on an S3 XML error, or an HTTP status when the
 * error carries only that.
 */
function readCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) {
    return undefined;
  }
  const { code, name, status } = cause as {
    code?: unknown;
    name?: unknown;
    status?: unknown;
  };
  if (typeof code === "string" && code.length > 0) {
    return code;
  }
  if (typeof code === "number") {
    return String(code);
  }
  if (typeof name === "string" && name in ERROR_CODES) {
    return name;
  }
  if (typeof status === "number") {
    return String(status);
  }
  return undefined;
}
