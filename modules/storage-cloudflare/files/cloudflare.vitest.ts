// Tests for the R2 provider: that reads and writes go through the binding, that
// presigning happens only when all four R2 API values are set, and that an R2 failure
// arrives as a `StorageError` with the raw code kept. It ships as
// `packages/storage/src/providers/cloudflare.test.ts` when testing is on, and
// `pnpm test:modules` runs it in place in the saasaloy repo.
//
// The R2 binding here is a fake object, because workerd is not running. `aws4fetch` is
// mocked below with a client that records each `sign` call and stamps a fixed signature,
// so the test runs offline and in the saasaloy repo, which does not install the package.
// That splits the proof in two: this file proves the provider signs the right URL with
// the right options, and check P3-6 (a real bucket) proves the signature itself.

import type { AwsClient } from "aws4fetch";
import { defineStorage } from "../define";
import { StorageError } from "../provider";
import type { StorageEnv } from "../provider";
import { describe, expect, it, vi } from "vitest";
import { cloudflare } from "./cloudflare";

interface SignCall {
  method: string;
  signQuery: boolean | undefined;
  url: string;
}

/** Every `sign` the mocked client has been asked for, in order. Tests read and clear it. */
const { signCalls } = vi.hoisted(() => ({ signCalls: [] as SignCall[] }));

vi.mock(import("aws4fetch"), () => {
  class FakeAwsClient {
    readonly accessKeyId: string;
    readonly region: string | undefined;
    readonly service: string | undefined;

    constructor(init: {
      accessKeyId: string;
      region?: string;
      service?: string;
    }) {
      this.accessKeyId = init.accessKeyId;
      this.region = init.region;
      this.service = init.service;
    }

    sign(
      request: Request,
      options?: { aws?: { signQuery?: boolean } }
    ): Promise<Request> {
      signCalls.push({
        method: request.method,
        signQuery: options?.aws?.signQuery,
        url: request.url,
      });
      const url = new URL(request.url);
      url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
      url.searchParams.set(
        "X-Amz-Credential",
        `${this.accessKeyId}/20260908/${this.region}/${this.service}/aws4_request`
      );
      url.searchParams.set("X-Amz-Signature", "stub-signature");
      return Promise.resolve(new Request(url, { method: request.method }));
    }
  }
  // The provider calls only the constructor and `sign`; the rest of the client is not faked.
  return { AwsClient: FakeAwsClient as unknown as typeof AwsClient };
});

const KEY = "t/t1/uploads/i1/notes.txt";

const API_CREDENTIALS = {
  R2_ACCESS_KEY_ID: "access-key-id",
  R2_ACCOUNT_ID: "acct123",
  R2_BUCKET_NAME: "app-storage",
  R2_SECRET_ACCESS_KEY: "secret-access-key",
};

/** An R2 object as the binding hands one back. */
function r2Object(overrides: Record<string, unknown> = {}) {
  return {
    customMetadata: undefined,
    httpEtag: '"abc123"',
    httpMetadata: { contentType: "text/plain" },
    key: KEY,
    size: 5,
    uploaded: new Date("2026-09-08T00:00:00.000Z"),
    ...overrides,
  };
}

/** A fake `BUCKET` binding that records calls instead of storing anything. */
function fakeBucket(overrides: Record<string, unknown> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    (name: string, result: unknown) =>
    (...args: unknown[]) => {
      calls.push({ args, name });
      return result;
    };

  return {
    calls,
    createMultipartUpload: record(
      "createMultipartUpload",
      Promise.resolve({ key: KEY, uploadId: "upload-1" })
    ),
    delete: record("delete", Promise.resolve()),
    get: record(
      "get",
      Promise.resolve({
        ...r2Object(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(5)),
        body: null,
        text: () => Promise.resolve("hello"),
      })
    ),
    head: record("head", Promise.resolve(r2Object())),
    list: record(
      "list",
      Promise.resolve({
        cursor: "next-page",
        objects: [r2Object()],
        truncated: true,
      })
    ),
    put: record("put", Promise.resolve(r2Object())),
    resumeMultipartUpload(key: string, uploadId: string) {
      calls.push({ args: [key, uploadId], name: "resumeMultipartUpload" });
      return {
        abort: record("abort", Promise.resolve()),
        complete: record("complete", Promise.resolve(r2Object())),
        uploadPart: record(
          "uploadPart",
          Promise.resolve({ etag: "part-etag", partNumber: 1 })
        ),
      };
    },
    ...overrides,
  };
}

function envWith(extra: Record<string, unknown> = {}): StorageEnv {
  return {
    BUCKET: fakeBucket(),
    STORAGE_PROVIDER: "cloudflare",
    STORAGE_URL_SECRET: "test-secret-value-not-a-real-key",
    ...extra,
  };
}

function client(env: StorageEnv) {
  return defineStorage({ providers: [cloudflare()] }).create(env);
}

describe("cloudflare provider: the binding path", () => {
  it("names itself `cloudflare`, the value STORAGE_PROVIDER must hold", () => {
    expect(cloudflare().name).toBe("cloudflare");
  });

  it("puts through the binding, with the content type as http metadata", async () => {
    const bucket = fakeBucket();
    const env = envWith({ BUCKET: bucket });

    const written = await client(env).put(KEY, "hello", {
      contentType: "text/plain",
      metadata: { ownerId: "u1" },
    });

    expect(written.key).toBe(KEY);
    expect(written.size).toBe(5);
    expect(written.contentType).toBe("text/plain");

    const put = bucket.calls.find((call) => call.name === "put");
    expect(put?.args[2]).toStrictEqual({
      customMetadata: { ownerId: "u1" },
      httpMetadata: { contentType: "text/plain" },
    });
  });

  it("reads head, get, list and delete through the binding", async () => {
    const bucket = fakeBucket();
    const files = client(envWith({ BUCKET: bucket }));

    const head = await files.head(KEY);
    expect(head?.size).toBe(5);
    const object = await files.get(KEY);
    await expect(object?.text()).resolves.toBe("hello");

    const listed = await files.list({ limit: 10, prefix: "t/t1/" });
    expect({
      cursor: listed.cursor,
      keys: listed.objects.map((entry) => entry.key),
      truncated: listed.truncated,
    }).toStrictEqual({ cursor: "next-page", keys: [KEY], truncated: true });

    await files.delete(KEY);
    expect(
      bucket.calls.map((call) => call.name).filter((name) => name !== "put")
    ).toStrictEqual(["head", "get", "list", "delete"]);
  });

  it("reads an absent object as null, not as an error", async () => {
    const env = envWith({
      BUCKET: fakeBucket({
        get: () => Promise.resolve(null),
        head: () => Promise.resolve(null),
      }),
    });
    await expect(client(env).head(KEY)).resolves.toBeNull();
    await expect(client(env).get(KEY)).resolves.toBeNull();
  });

  it("names the wrangler entry when the binding is missing", async () => {
    const env = envWith({ BUCKET: undefined });
    await expect(() => client(env).head(KEY)).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof StorageError &&
          error.code === "provider_error" &&
          error.message.includes("r2_buckets") &&
          error.message.includes("BUCKET")
      )
    );
  });

  it("runs multipart through the binding's own multipart api", async () => {
    const bucket = fakeBucket();
    const files = client(envWith({ BUCKET: bucket }));

    const upload = await files.createMultipartUpload(KEY);
    expect(upload).toStrictEqual({ key: KEY, uploadId: "upload-1" });

    const part = await files.uploadPart(upload, 1, "hello");
    expect(part).toStrictEqual({ etag: "part-etag", partNumber: 1 });

    const completed = await files.completeMultipart(upload, [part]);
    expect(completed.key).toBe(KEY);

    await files.abortMultipart(upload);
    const complete = bucket.calls.find((call) => call.name === "complete");
    expect(complete?.args[0]).toStrictEqual([
      { etag: "part-etag", partNumber: 1 },
    ]);
    expect(bucket.calls.some((call) => call.name === "abort")).toBeTruthy();
  });
});

describe("cloudflare provider: error mapping", () => {
  // R2 reports a failure as an `Error` carrying a numeric `code` from the binding, a
  // name from the S3 API, or only a status.
  const cases: [string, Error, string, boolean][] = [
    [
      "a binding code for a missing key",
      Object.assign(new Error("The specified key does not exist. (10007)"), {
        code: 10_007,
      }),
      "not_found",
      false,
    ],
    [
      "a binding code for a missing bucket",
      Object.assign(new Error("The specified bucket does not exist. (10006)"), {
        code: 10_006,
      }),
      "provider_error",
      false,
    ],
    [
      "an S3 throttle",
      Object.assign(new Error("slow down"), { code: "SlowDown" }),
      "rate_limited",
      true,
    ],
    [
      "an oversize body",
      Object.assign(new Error("too big"), { code: "EntityTooLarge" }),
      "too_large",
      false,
    ],
    [
      "a bare 503",
      Object.assign(new Error("unavailable"), { status: 503 }),
      "provider_error",
      true,
    ],
  ];

  it.each(cases)(
    "maps %s onto its code, keeping the raw one",
    async (_label, raw, code, retryable) => {
      const env = envWith({
        BUCKET: fakeBucket({
          head: () => Promise.reject(raw),
        }),
      });

      // A head that resolves leaves its value here, which fails the instanceof check.
      const outcome: unknown = await client(env)
        .head(KEY)
        .catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(StorageError);
      expect(outcome).toMatchObject({ code, retryable });
      expect((outcome as StorageError).providerCode).toBeTruthy();
      expect((outcome as StorageError).cause).toBe(raw);
    }
  );

  it("falls through an unknown failure to a non-retryable provider_error", async () => {
    const env = envWith({
      BUCKET: fakeBucket({
        head: () => Promise.reject(new Error("something new")),
      }),
    });

    await expect(() => client(env).head(KEY)).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof StorageError &&
          error.code === "provider_error" &&
          error.retryable === false &&
          error.providerCode === undefined
      )
    );
  });
});

describe("cloudflare provider: presign or proxy", () => {
  it("signs a direct upload url when all four R2 API values are set", async () => {
    signCalls.length = 0;
    const target = await client(envWith(API_CREDENTIALS)).createUploadUrl(KEY, {
      contentType: "text/plain",
    });

    expect(target).toMatchObject({ direct: true, method: "PUT" });

    const url = new URL(target.url);
    expect({
      expires: url.searchParams.get("X-Amz-Expires"),
      host: url.host,
      pathname: url.pathname,
    }).toStrictEqual({
      expires: "300",
      host: "acct123.r2.cloudflarestorage.com",
      pathname: `/app-storage/${KEY}`,
    });
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();

    // The header is deliberately unsigned: a signed content-type a browser normalizes
    // differently is a 403 the caller cannot fix.
    expect(target.headers).toStrictEqual({});
    expect(
      signCalls.map((call) => [call.method, call.signQuery])
    ).toStrictEqual([["PUT", true]]);
  });

  it("signs a direct download url with the one-hour default", async () => {
    const target = await client(envWith(API_CREDENTIALS)).createDownloadUrl(
      KEY
    );

    expect(target.direct).toBeTruthy();
    expect(new URL(target.url).searchParams.get("X-Amz-Expires")).toBe("3600");
  });

  it("signs a part url carrying the upload id and the part number", async () => {
    const signed = await cloudflare().presignPart?.(
      envWith(API_CREDENTIALS),
      { key: KEY, uploadId: "upload-1" },
      2,
      { expiresIn: 300 }
    );

    const url = new URL(signed?.url ?? "");
    expect(url.searchParams.get("uploadId")).toBe("upload-1");
    expect(url.searchParams.get("partNumber")).toBe("2");
  });

  it.each(Object.keys(API_CREDENTIALS))(
    "falls back to the proxy when %s is missing",
    async (missing) => {
      const partial = { ...API_CREDENTIALS, [missing]: undefined };
      const target = await client(envWith(partial)).createUploadUrl(KEY);

      expect(target.direct).toBeFalsy();
      expect(target.url).toMatch(/^\/storage\/objects\?token=/);
    }
  );

  it("returns undefined from presignPut, so the core knows to proxy", async () => {
    const signed = await cloudflare().presignPut?.(envWith(), KEY, {
      expiresIn: 300,
    });
    expect(signed).toBeUndefined();
  });
});
