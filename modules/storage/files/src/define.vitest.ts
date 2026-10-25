// Tests for the vendor-blind half of packages/storage: provider selection, the
// presign-or-proxy choice, expiry clamping, the `not_supported` answer for an optional
// method the provider lacks, and the wrapping that keeps one error shape at the
// boundary. It ships as `packages/storage/src/define.test.ts` when testing is on, and
// `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.

import { assert, describe, expect, it } from "vitest";
import {
  defineStorage,
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from "./define";
import { StorageError } from "./provider";
import type {
  PresignedRequest,
  StorageEnv,
  StorageObject,
  StorageProvider,
} from "./provider";
import { verifyToken } from "./token";

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
    expect(() => registry.create({})).toThrow(/STORAGE_PROVIDER is not set/);
  });

  it("throws when it names a provider that is not registered", () => {
    const registry = defineStorage({ providers: [fake()] });
    expect(() => registry.create({ STORAGE_PROVIDER: "nope" })).toThrow(
      /STORAGE_PROVIDER is "nope", which is not registered/
    );
  });

  it("never falls back to the only installed provider", () => {
    expect(() => defineStorage({ providers: [fake()] }).create({})).toThrow(
      /STORAGE_PROVIDER/
    );
  });

  it("says so when nothing at all is registered", () => {
    expect(() =>
      defineStorage({ providers: [] }).create({ STORAGE_PROVIDER: "x" })
    ).toThrow(/No providers are registered/);
  });

  it("selects the named provider and reports its name", () => {
    const client = defineStorage({ providers: [fake()] }).create(env);
    expect(client.provider).toBe("fake");
    expect(client.maxUploadBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });
});

describe("STORAGE_MAX_UPLOAD_BYTES", () => {
  it("reads a configured cap", () => {
    const client = defineStorage({ providers: [fake()] }).create({
      ...env,
      STORAGE_MAX_UPLOAD_BYTES: "512",
    });
    expect(client.maxUploadBytes).toBe(512);
  });

  it("throws on a value that is not a positive whole number", () => {
    for (const value of ["big", "-1", "1.5"]) {
      expect(() =>
        defineStorage({ providers: [fake()] }).create({
          ...env,
          STORAGE_MAX_UPLOAD_BYTES: value,
        })
      ).toThrow(/STORAGE_MAX_UPLOAD_BYTES/);
    }
  });
});

describe("key checking", () => {
  it("refuses a key the capability did not build", async () => {
    const client = defineStorage({ providers: [fake()] }).create(env);
    await expect(() => client.put("../secrets", "x")).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof StorageError && error.code === "invalid_key"
      )
    );
  });
});

describe("createUploadUrl", () => {
  it("returns the proxy target when the provider cannot sign", async () => {
    const client = defineStorage({ providers: [fake()] }).create(env);
    const target = await client.createUploadUrl(KEY, {
      contentType: "text/plain",
    });

    expect(target.direct).toBeFalsy();
    expect(target.method).toBe("PUT");
    expect(target.url.startsWith("/storage/objects?token=")).toBeTruthy();

    const token = new URL(target.url, "https://x.test").searchParams.get(
      "token"
    );
    assert(token, "the upload url carries no token");
    const claims = await verifyToken(env, token);
    expect(claims).toMatchObject({
      contentType: "text/plain",
      key: KEY,
      maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
      method: "PUT",
    });
  });

  it("puts STORAGE_PROXY_URL in front of a proxy link", async () => {
    const client = defineStorage({ providers: [fake()] }).create({
      ...env,
      STORAGE_PROXY_URL: "https://api.x.test/",
    });
    const target = await client.createUploadUrl(KEY);
    expect(
      target.url.startsWith("https://api.x.test/storage/objects?token=")
    ).toBeTruthy();
  });

  it("returns the signed target when the provider can sign", async () => {
    const client = defineStorage({ providers: [signing()] }).create({
      ...env,
      STORAGE_PROVIDER: "fake",
    });
    const target = await client.createUploadUrl(KEY);
    expect(target.direct).toBeTruthy();
    expect(target.url.includes("X-Amz-Signature")).toBeTruthy();
  });

  it("clamps expiresIn at 24 hours and defaults to 5 minutes", async () => {
    const client = defineStorage({ providers: [fake()] }).create(env);

    const capped = await client.createUploadUrl(KEY, { expiresIn: 999_999 });
    const cappedSeconds = Math.round(
      (capped.expiresAt.getTime() - Date.now()) / 1000
    );
    expect(cappedSeconds <= MAX_URL_TTL_SECONDS).toBeTruthy();
    expect(cappedSeconds > MAX_URL_TTL_SECONDS - 5).toBeTruthy();

    const preset = await client.createUploadUrl(KEY);
    const presetSeconds = Math.round(
      (preset.expiresAt.getTime() - Date.now()) / 1000
    );
    expect(Math.abs(presetSeconds - UPLOAD_URL_TTL_SECONDS) <= 2).toBeTruthy();
  });
});

describe("createDownloadUrl", () => {
  it("signs a GET token for the proxy path", async () => {
    const client = defineStorage({ providers: [fake()] }).create(env);
    const target = await client.createDownloadUrl(KEY);
    expect(target.direct).toBeFalsy();
    // A missing token reads as "", which verifyToken refuses, so the test still fails.
    const token =
      new URL(target.url, "https://x.test").searchParams.get("token") ?? "";
    const claims = await verifyToken(env, token);
    expect(claims.method).toBe("GET");
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
      await expect(() => call).rejects.toThrow(
        expect.toSatisfy(
          (error: unknown) =>
            error instanceof StorageError && error.code === "not_supported"
        )
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
    await expect(client.createMultipartUpload(KEY)).resolves.toStrictEqual({
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

    await expect(() => client.head(KEY)).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof StorageError &&
          error.code === "provider_error" &&
          error.retryable === false &&
          error.cause === boom
      )
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

    await expect(() => client.head(KEY)).rejects.toThrow(
      expect.toSatisfy((error: unknown) => error === original)
    );
  });
});
