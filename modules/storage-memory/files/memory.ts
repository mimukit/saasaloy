import { StorageError } from "../provider";
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
} from "../provider";

// Objects in a `Map`, for local development and tests. No account, no binding, no
// network, no secret — which is why this provider declares no envVars and patches no
// wrangler.jsonc. `STORAGE_PROVIDER=memory` is the whole configuration.
//
// It signs nothing: `presignPut` and `presignGet` are absent, so `createUploadUrl`
// falls back to the capability's proxy route and the browser does the same PUT it would
// do against R2. That fallback is the reason the presign methods are optional in the
// contract at all.
//
// Multipart is implemented for real, not stubbed. The export job in `file-uploads`
// chains pages into one multipart upload, so a stub here would make the local
// development story stop exactly where the interesting job starts.
//
// The store lives as long as the isolate does. Two Workers isolates do not share it, a
// deploy empties it, and `wrangler dev` empties it on reload. That is a development
// tool's honest behaviour, and it is the one reason not to reach for this provider in
// production.

/** What the store keeps per key. `bytes` is a copy, never a caller's buffer. */
interface StoredObject {
  bytes: Uint8Array;
  contentType?: string;
  etag: string;
  metadata?: Record<string, string>;
  uploadedAt: Date;
}

/** A multipart upload in progress: its target key, its options, and its parts so far. */
interface StoredUpload {
  key: string;
  options?: PutOptions;
  parts: Map<number, { bytes: Uint8Array; etag: string }>;
}

export interface MemoryStorageOptions {
  /**
   * Seed the store, so a test or a demo starts with objects in it. Keys go in as
   * written — `buildKey` is the caller's job here as everywhere else.
   */
  seed?: Record<string, StorageBody>;
}

/** R2 and S3 both default a page to 1000 keys. Matching it keeps callers portable. */
const DEFAULT_LIST_LIMIT = 1000;

export function memory(options: MemoryStorageOptions = {}): StorageProvider {
  const objects = new Map<string, StoredObject>();
  const uploads = new Map<string, StoredUpload>();
  let uploadCounter = 0;

  const seeded = options.seed
    ? Promise.all(
        Object.entries(options.seed).map(async ([key, body]) => {
          objects.set(key, await store(await toBytes(body)));
        })
      )
    : undefined;

  /** Every operation waits for the seed once; after that this resolves immediately. */
  async function ready(): Promise<void> {
    await seeded;
  }

  return {
    async abortMultipart(
      _env: StorageEnv,
      upload: MultipartUpload
    ): Promise<void> {
      await ready();
      // Aborting an upload that is already gone is not a failure: the caller wanted it
      // gone and it is. A sweep job that retries an abort must not be punished for it.
      uploads.delete(upload.uploadId);
    },

    async completeMultipart(
      _env: StorageEnv,
      upload: MultipartUpload,
      parts: UploadedPart[]
    ): Promise<StorageObject> {
      await ready();
      const pending = takeUpload(uploads, upload);

      // Concatenated in the order the caller listed, not in the order the parts
      // arrived, because that is the order S3 and R2 assemble in.
      const chunks = parts.map((part) => {
        const held = pending.parts.get(part.partNumber);
        if (!held) {
          throw new StorageError(
            "not_found",
            `Part ${part.partNumber} was never uploaded to "${upload.uploadId}".`
          );
        }
        if (held.etag !== part.etag) {
          throw new StorageError(
            "provider_error",
            `Part ${part.partNumber} has etag "${held.etag}", not "${part.etag}".`
          );
        }
        return held.bytes;
      });

      uploads.delete(upload.uploadId);
      const stored = await store(concat(chunks), pending.options);
      objects.set(pending.key, stored);
      return describe(pending.key, stored);
    },

    async createMultipartUpload(
      _env: StorageEnv,
      key: string,
      putOptions?: PutOptions
    ): Promise<MultipartUpload> {
      await ready();
      uploadCounter += 1;
      const uploadId = `memory-upload-${uploadCounter}`;
      uploads.set(uploadId, { key, options: putOptions, parts: new Map() });
      return { key, uploadId };
    },

    async delete(_env: StorageEnv, key: string): Promise<void> {
      await ready();
      // Deleting an absent key succeeds, as it does on R2 and S3. Delete is an
      // assertion about the end state, not about what was there first.
      objects.delete(key);
    },

    async get(
      _env: StorageEnv,
      key: string
    ): Promise<StorageObjectBody | null> {
      await ready();
      const held = objects.get(key);
      if (!held) {
        return null;
      }
      return {
        ...describe(key, held),
        arrayBuffer: () => Promise.resolve(toArrayBuffer(held.bytes)),
        // A fresh stream per call: a `ReadableStream` is consumed once, and a caller
        // that reads the same object twice is doing nothing wrong.
        body: streamOf(held.bytes),
        text: () => Promise.resolve(new TextDecoder().decode(held.bytes)),
      };
    },

    async head(_env: StorageEnv, key: string): Promise<StorageObject | null> {
      await ready();
      const held = objects.get(key);
      return held ? describe(key, held) : null;
    },

    async list(
      _env: StorageEnv,
      listOptions: ListOptions = {}
    ): Promise<ListResult> {
      await ready();
      const prefix = listOptions.prefix ?? "";
      const limit = Math.max(1, listOptions.limit ?? DEFAULT_LIST_LIMIT);
      const after = listOptions.cursor;

      // Sorted by key, because a cursor that means "the key after this one" needs a
      // stable order to be a cursor at all. `Map` iteration order is insertion order.
      const matching = [...objects.entries()]
        .filter(
          ([key]) =>
            key.startsWith(prefix) && (after === undefined || key > after)
        )
        .toSorted(([left], [right]) => (left < right ? -1 : 1));

      const page = matching.slice(0, limit);
      const truncated = matching.length > page.length;
      const last = page.at(-1);

      return {
        objects: page.map(([key, held]) => describe(key, held)),
        ...(truncated && last ? { cursor: last[0] } : {}),
        truncated,
      };
    },

    name: "memory",

    async put(
      _env: StorageEnv,
      key: string,
      body: StorageBody,
      putOptions?: PutOptions
    ): Promise<StorageObject> {
      await ready();
      const stored = await store(await toBytes(body), putOptions);
      objects.set(key, stored);
      return describe(key, stored);
    },

    async uploadPart(
      _env: StorageEnv,
      upload: MultipartUpload,
      partNumber: number,
      body: StorageBody
    ): Promise<UploadedPart> {
      await ready();
      const pending = takeUpload(uploads, upload);
      if (!Number.isInteger(partNumber) || partNumber < 1) {
        throw new StorageError(
          "provider_error",
          `Part number must be a whole number of 1 or more: got ${String(partNumber)}.`
        );
      }
      const bytes = await toBytes(body);
      const etag = await digest(bytes);
      // A re-uploaded part replaces the one before it, as it does on R2.
      pending.parts.set(partNumber, { bytes, etag });
      return { etag, partNumber };
    },
  };
}

function takeUpload(
  uploads: Map<string, StoredUpload>,
  upload: MultipartUpload
): StoredUpload {
  const pending = uploads.get(upload.uploadId);
  if (!pending) {
    throw new StorageError(
      "not_found",
      `No multipart upload "${upload.uploadId}". It was completed, aborted, or never started on this isolate.`
    );
  }
  return pending;
}

async function store(
  bytes: Uint8Array,
  options?: PutOptions
): Promise<StoredObject> {
  return {
    bytes,
    ...(options?.contentType ? { contentType: options.contentType } : {}),
    etag: await digest(bytes),
    ...(options?.metadata ? { metadata: { ...options.metadata } } : {}),
    uploadedAt: new Date(),
  };
}

function describe(key: string, held: StoredObject): StorageObject {
  return {
    etag: held.etag,
    key,
    size: held.bytes.byteLength,
    uploadedAt: held.uploadedAt,
    ...(held.contentType ? { contentType: held.contentType } : {}),
    ...(held.metadata ? { metadata: { ...held.metadata } } : {}),
  };
}

/**
 * An etag a caller can compare, from the bytes themselves. SHA-256 rather than R2's MD5
 * because Web Crypto has no MD5 and nothing here needs to match R2's value — an etag is
 * an opaque version marker in this contract, never parsed.
 */
async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return [...new Uint8Array(hash)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Every body shape the contract admits, read fully into one buffer. */
async function toBytes(body: StorageBody): Promise<Uint8Array> {
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    );
  }
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  return await readStream(body);
}

async function readStream(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let done = false;
  while (!done) {
    // Sequential by nature: the next chunk is not requestable until this one arrives.
    const read = await reader.read();
    done = read.done;
    if (read.value !== undefined) {
      chunks.push(
        typeof read.value === "string"
          ? new TextEncoder().encode(read.value)
          : new Uint8Array(read.value)
      );
    }
  }
  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function streamOf(bytes: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}
