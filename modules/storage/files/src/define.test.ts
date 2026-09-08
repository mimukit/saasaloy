// Tests for the vendor-blind half of packages/storage: provider selection, the
// presign-or-proxy choice, expiry clamping, the `not_supported` answer for an optional
// method the provider lacks, and the wrapping that keeps one error shape at the
// boundary. Repo-only, run by `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineStorage,
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from "./define.ts";
import { StorageError } from "./provider.ts";
import type {
  PresignedRequest,
  StorageEnv,
  StorageObject,
  StorageProvider,
} from "./provider.ts";
import { verifyToken } from "./token.ts";

const KEY = "t/t1/uploads/i/a.txt";

const env: StorageEnv = {
  STORAGE_PROVIDER: "fake",
  STORAGE_URL_SECRET: "test-secret-value-not-a-real-key",
};

/** A provider that records what it was handed instead of storing it anywhere. */
function fake(overrides: Partial<StorageProvider> = {}): StorageProvider {
  const object: StorageObject = { key: KEY, size: 3 };
  return {
    delete: () => Promise.resolve(),
    get: () => Promise.resolve(null),
    head: () => Promise.resolve(object),
    list: () => Promise.resolve({ objects: [object], truncated: false }),
    name: "fake",
    put: () => Promise.resolve(object),
    ...overrides,
  };
}

/** A provider that signs, so the direct path is exercised. */
function signing(): StorageProvider {
  const signed = (method: "GET" | "PUT"): PresignedRequest => ({
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    method,
    url: `https://acct.r2.cloudflarestorage.com/bucket/${KEY}?X-Amz-Signature=abc`,
  });
  return fake({
    presignGet: () => Promise.resolve(signed("GET")),
    presignPut: () => Promise.resolve(signed("PUT")),
  });
}

describe("STORAGE_PROVIDER selection", () => {
  it("throws when it is unset, naming the variable", () => {
    const registry = defineStorage({ providers: [fake()] });
    assert.throws(() => registry.create({}), /STORAGE_PROVIDER is not set/);
  });

  it("throws when it names a provider that is not registered", () => {
    const registry = defineStorage({ providers: [fake()] });
    assert.throws(
      () => registry.create({ STORAGE_PROVIDER: "nope" }),
      /STORAGE_PROVIDER is "nope", which is not registered/
    );
  });

  it("never falls back to the only installed provider", () => {
    assert.throws(
      () => defineStorage({ providers: [fake()] }).create({}),
      /STORAGE_PROVIDER/
    );
  });

  it("says so when nothing at all is registered", () => {
    assert.throws(
      () => defineStorage({ providers: [] }).create({ STORAGE_PROVIDER: "x" }),
      /No providers are registered/
    );
  });

  it("selects the named provider and reports its name", () => {
    const client = defineStorage({ providers: [fake()] }).create(env);
    assert.equal(client.provider, "fake");
    assert.equal(client.maxUploadBytes, DEFAULT_MAX_UPLOAD_BYTES);
  });
});

describe("STORAGE_MAX_UPLOAD_BYTES", () => {
  it("reads a configured cap", () => {
    const client = defineStorage({ providers: [fake()] }).create({
      ...env,
      STORAGE_MAX_UPLOAD_BYTES: "512",
    });
    assert.equal(client.maxUploadBytes, 512);
  });

  it("throws on a value that is not a positive whole number", () => {
    for (const value of ["big", "-1", "1.5"]) {
      assert.throws(
        () =>
          defineStorage({ providers: [fake()] }).create({
            ...env,
            STORAGE_MAX_UPLOAD_BYTES: value,
          }),
        /STORAGE_MAX_UPLOAD_BYTES/
      );
    }
  });
});

describe("key checking", () => {
  it("refuses a key the capability did not build", async () => {
    const client = defineStorage({ providers: [fake()] }).create(env);
    await assert.rejects(
      () => client.put("../secrets", "x"),
      (error: unknown) =>
        error instanceof StorageError && error.code === "invalid_key"
    );
  });
});

describe("createUploadUrl", () => {
  it("returns the proxy target when the provider cannot sign", async () => {
    const client = defineStorage({ providers: [fake()] }).create(env);
    const target = await client.createUploadUrl(KEY, {
      contentType: "text/plain",
    });

    assert.equal(target.direct, false);
    assert.equal(target.method, "PUT");
    assert.ok(target.url.startsWith("/storage/objects?token="));

    const token = new URL(target.url, "https://x.test").searchParams.get(
      "token"
    );
    assert.ok(token);
    const claims = await verifyToken(env, token);
    assert.equal(claims.key, KEY);
    assert.equal(claims.method, "PUT");
    assert.equal(claims.maxBytes, DEFAULT_MAX_UPLOAD_BYTES);
    assert.equal(claims.contentType, "text/plain");
  });

  it("puts STORAGE_PROXY_URL in front of a proxy link", async () => {
    const client = defineStorage({ providers: [fake()] }).create({
      ...env,
      STORAGE_PROXY_URL: "https://api.x.test/",
    });
    const target = await client.createUploadUrl(KEY);
    assert.ok(
      target.url.startsWith("https://api.x.test/storage/objects?token=")
    );
  });

  it("returns the signed target when the provider can sign", async () => {
    const client = defineStorage({ providers: [signing()] }).create({
      ...env,
      STORAGE_PROVIDER: "fake",
    });
    const target = await client.createUploadUrl(KEY);
    assert.equal(target.direct, true);
    assert.ok(target.url.includes("X-Amz-Signature"));
  });

  it("clamps expiresIn at 24 hours and defaults to 5 minutes", async () => {
    const client = defineStorage({ providers: [fake()] }).create(env);

    const capped = await client.createUploadUrl(KEY, { expiresIn: 999_999 });
    const cappedSeconds = Math.round(
      (capped.expiresAt.getTime() - Date.now()) / 1000
    );
    assert.ok(cappedSeconds <= MAX_URL_TTL_SECONDS);
    assert.ok(cappedSeconds > MAX_URL_TTL_SECONDS - 5);

    const preset = await client.createUploadUrl(KEY);
    const presetSeconds = Math.round(
      (preset.expiresAt.getTime() - Date.now()) / 1000
    );
    assert.ok(Math.abs(presetSeconds - UPLOAD_URL_TTL_SECONDS) <= 2);
  });
});

describe("createDownloadUrl", () => {
  it("signs a GET token for the proxy path", async () => {
    const client = defineStorage({ providers: [fake()] }).create(env);
    const target = await client.createDownloadUrl(KEY);
    assert.equal(target.direct, false);
    const token = new URL(target.url, "https://x.test").searchParams.get(
      "token"
    );
    assert.equal((await verifyToken(env, token!)).method, "GET");
  });
});

describe("optional methods", () => {
  it("answers not_supported when the provider lacks one", async () => {
    const client = defineStorage({ providers: [fake()] }).create(env);
    const calls: Promise<unknown>[] = [
      client.createMultipartUpload(KEY),
      client.uploadPart({ key: KEY, uploadId: "u" }, 1, "x"),
      client.completeMultipart({ key: KEY, uploadId: "u" }, []),
      client.abortMultipart({ key: KEY, uploadId: "u" }),
    ];
    for (const call of calls) {
      await assert.rejects(
        () => call,
        (error: unknown) =>
          error instanceof StorageError && error.code === "not_supported"
      );
    }
  });

  it("calls through when the provider has one", async () => {
    const client = defineStorage({
      providers: [
        fake({
          createMultipartUpload: (_env, key) =>
            Promise.resolve({ key, uploadId: "u1" }),
        }),
      ],
    }).create(env);
    assert.deepEqual(await client.createMultipartUpload(KEY), {
      key: KEY,
      uploadId: "u1",
    });
  });
});

describe("error normalization", () => {
  it("wraps a raw provider throw as provider_error, keeping the cause", async () => {
    const boom = new TypeError("fetch failed");
    const client = defineStorage({
      providers: [
        fake({
          head: () => Promise.reject(boom),
        }),
      ],
    }).create(env);

    await assert.rejects(
      () => client.head(KEY),
      (error: unknown) =>
        error instanceof StorageError &&
        error.code === "provider_error" &&
        error.retryable === false &&
        error.cause === boom
    );
  });

  it("re-throws a well-formed StorageError untouched", async () => {
    const original = new StorageError("rate_limited", "slow down", {
      providerCode: "SlowDown",
      retryable: true,
    });
    const client = defineStorage({
      providers: [fake({ head: () => Promise.reject(original) })],
    }).create(env);

    await assert.rejects(
      () => client.head(KEY),
      (error: unknown) => error === original
    );
  });
});
