// Tests for the R2 provider: that reads and writes go through the binding, that
// presigning happens only when all four R2 API values are set, and that an R2 failure
// arrives as a `StorageError` with the raw code kept. This file is NOT in the
// descriptor's `files[]`, so `saasaloy add storage-cloudflare` never copies it into a
// project. Run it with `pnpm test:modules`.
//
// The R2 binding here is a fake object, because workerd is not running. `aws4fetch` is
// the repo-only stub in ../aws4fetch-stub.ts, mapped onto the `aws4fetch` specifier by
// the resolve hook below: this repo's root node_modules holds dev tooling and nothing
// else, so the real package is not installed. That splits the proof in two — this file
// proves the provider signs the right URL with the right options, and check P3-6 (a
// real bucket) proves the signature itself.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import { signCalls } from "../aws4fetch-stub.ts";
import { defineStorage } from "../../storage/files/src/define.ts";
import { StorageError } from "../../storage/files/src/provider.ts";
import type { StorageEnv } from "../../storage/files/src/provider.ts";

const STUB = new URL("../aws4fetch-stub.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "aws4fetch") {
      return { shortCircuit: true, url: STUB };
    }
    return nextResolve(specifier, context);
  },
});

// Imported after the hook is registered, because the provider imports `aws4fetch` at
// the top of its own file, exactly as the shipped code does.
const { cloudflare } = await import("./cloudflare.ts");

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
    assert.equal(cloudflare().name, "cloudflare");
  });

  it("puts through the binding, with the content type as http metadata", async () => {
    const bucket = fakeBucket();
    const env = envWith({ BUCKET: bucket });

    const written = await client(env).put(KEY, "hello", {
      contentType: "text/plain",
      metadata: { ownerId: "u1" },
    });

    assert.equal(written.key, KEY);
    assert.equal(written.size, 5);
    assert.equal(written.contentType, "text/plain");

    const put = bucket.calls.find((call) => call.name === "put");
    assert.deepEqual(put?.args[2], {
      customMetadata: { ownerId: "u1" },
      httpMetadata: { contentType: "text/plain" },
    });
  });

  it("reads head, get, list and delete through the binding", async () => {
    const bucket = fakeBucket();
    const files = client(envWith({ BUCKET: bucket }));

    assert.equal((await files.head(KEY))?.size, 5);
    assert.equal(await (await files.get(KEY))?.text(), "hello");

    const listed = await files.list({ limit: 10, prefix: "t/t1/" });
    assert.equal(listed.truncated, true);
    assert.equal(listed.cursor, "next-page");
    assert.deepEqual(
      listed.objects.map((entry) => entry.key),
      [KEY]
    );

    await files.delete(KEY);
    assert.deepEqual(
      bucket.calls.map((call) => call.name).filter((name) => name !== "put"),
      ["head", "get", "list", "delete"]
    );
  });

  it("reads an absent object as null, not as an error", async () => {
    const env = envWith({
      BUCKET: fakeBucket({
        get: () => Promise.resolve(null),
        head: () => Promise.resolve(null),
      }),
    });
    assert.equal(await client(env).head(KEY), null);
    assert.equal(await client(env).get(KEY), null);
  });

  it("names the wrangler entry when the binding is missing", async () => {
    const env = envWith({ BUCKET: undefined });
    await assert.rejects(
      () => client(env).head(KEY),
      (error: unknown) =>
        error instanceof StorageError &&
        error.code === "provider_error" &&
        error.message.includes("r2_buckets") &&
        error.message.includes("BUCKET")
    );
  });

  it("runs multipart through the binding's own multipart api", async () => {
    const bucket = fakeBucket();
    const files = client(envWith({ BUCKET: bucket }));

    const upload = await files.createMultipartUpload(KEY);
    assert.deepEqual(upload, { key: KEY, uploadId: "upload-1" });

    const part = await files.uploadPart(upload, 1, "hello");
    assert.deepEqual(part, { etag: "part-etag", partNumber: 1 });

    const completed = await files.completeMultipart(upload, [part]);
    assert.equal(completed.key, KEY);

    await files.abortMultipart(upload);
    const complete = bucket.calls.find((call) => call.name === "complete");
    assert.deepEqual(complete?.args[0], [{ etag: "part-etag", partNumber: 1 }]);
    assert.ok(bucket.calls.some((call) => call.name === "abort"));
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

  it("maps each R2 failure it knows onto a code, keeping the raw one", async () => {
    for (const [label, raw, code, retryable] of cases) {
      const env = envWith({
        BUCKET: fakeBucket({
          head: () => Promise.reject(raw),
        }),
      });

      await assert.rejects(
        () => client(env).head(KEY),
        (error: unknown) => {
          assert.ok(error instanceof StorageError, label);
          assert.equal(error.code, code, label);
          assert.equal(error.retryable, retryable, label);
          assert.ok(error.providerCode, label);
          assert.equal(error.cause, raw, label);
          return true;
        }
      );
    }
  });

  it("falls through an unknown failure to a non-retryable provider_error", async () => {
    const env = envWith({
      BUCKET: fakeBucket({
        head: () => Promise.reject(new Error("something new")),
      }),
    });

    await assert.rejects(
      () => client(env).head(KEY),
      (error: unknown) =>
        error instanceof StorageError &&
        error.code === "provider_error" &&
        error.retryable === false &&
        error.providerCode === undefined
    );
  });
});

describe("cloudflare provider: presign or proxy", () => {
  it("signs a direct upload url when all four R2 API values are set", async () => {
    signCalls.length = 0;
    const target = await client(envWith(API_CREDENTIALS)).createUploadUrl(KEY, {
      contentType: "text/plain",
    });

    assert.equal(target.direct, true);
    assert.equal(target.method, "PUT");

    const url = new URL(target.url);
    assert.equal(url.host, "acct123.r2.cloudflarestorage.com");
    assert.equal(url.pathname, `/app-storage/${KEY}`);
    assert.ok(url.searchParams.get("X-Amz-Signature"));
    assert.equal(url.searchParams.get("X-Amz-Expires"), "300");

    // The header is deliberately unsigned: a signed content-type a browser normalizes
    // differently is a 403 the caller cannot fix.
    assert.deepEqual(target.headers, {});
    assert.deepEqual(
      signCalls.map((call) => [call.method, call.signQuery]),
      [["PUT", true]]
    );
  });

  it("signs a direct download url with the one-hour default", async () => {
    const target = await client(envWith(API_CREDENTIALS)).createDownloadUrl(
      KEY
    );

    assert.equal(target.direct, true);
    assert.equal(new URL(target.url).searchParams.get("X-Amz-Expires"), "3600");
  });

  it("signs a part url carrying the upload id and the part number", async () => {
    const signed = await cloudflare().presignPart?.(
      envWith(API_CREDENTIALS),
      { key: KEY, uploadId: "upload-1" },
      2,
      { expiresIn: 300 }
    );

    const url = new URL(signed?.url ?? "");
    assert.equal(url.searchParams.get("uploadId"), "upload-1");
    assert.equal(url.searchParams.get("partNumber"), "2");
  });

  it("falls back to the proxy when any one of the four is missing", async () => {
    for (const missing of Object.keys(API_CREDENTIALS)) {
      const partial = { ...API_CREDENTIALS, [missing]: undefined };
      const target = await client(envWith(partial)).createUploadUrl(KEY);

      assert.equal(target.direct, false, missing);
      assert.match(target.url, /^\/storage\/objects\?token=/, missing);
    }
  });

  it("returns undefined from presignPut, so the core knows to proxy", async () => {
    const signed = await cloudflare().presignPut?.(envWith(), KEY, {
      expiresIn: 300,
    });
    assert.equal(signed, undefined);
  });
});
