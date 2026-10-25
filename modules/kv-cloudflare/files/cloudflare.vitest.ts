// Tests for the Workers KV provider against stub bindings. It ships as
// `cloudflare.test.ts` beside the provider when testing is on, and `pnpm test:modules`
// runs it in place in the saasaloy repo.
//
// There is no Cloudflare account in the loop. What is worth checking here is the part
// that is ours: which binding name each call reaches for, how a `list` page is mapped
// onto `KvListResult`, and how a KV status becomes a `KvError` code. `../provider`
// resolves by its project path to the real contract.

import { describe, expect, it } from "vitest";
import { cloudflare } from "./cloudflare";
import { KvError } from "../provider";
import type { KvEnv, Policy } from "../provider";

const STRICT: Policy = { limit: 10, name: "strict", periodSeconds: 10 };

interface ListPage {
  keys: { name: string }[];
  list_complete: boolean;
  cursor?: string;
}

/** The four KV methods the provider calls, and a record of what it passed. */
function namespaceStub(page?: ListPage) {
  const puts: { key: string; options: unknown; value: string }[] = [];
  const lists: unknown[] = [];

  return {
    delete: (_key: string) => Promise.resolve(),
    get: (_key: string, _type: string) => Promise.resolve('"stored"'),
    list: (options: unknown) => {
      lists.push(options);
      return Promise.resolve(
        page ?? { keys: [], list_complete: true as const }
      );
    },
    lists,
    put: (key: string, value: string, options: unknown) => {
      puts.push({ key, options, value });
      return Promise.resolve();
    },
    puts,
  };
}

function env(extra: Record<string, unknown> = {}): KvEnv {
  return { KV: namespaceStub(), KV_PROVIDER: "cloudflare", ...extra };
}

describe("cloudflare kv provider", () => {
  it("declares the platform's TTL floor", () => {
    const provider = cloudflare();
    expect(provider.name).toBe("cloudflare");
    expect(provider.minTtlSeconds).toBe(60);
  });

  it("passes a TTL as expirationTtl, and omits the property without one", async () => {
    const provider = cloudflare();
    const namespace = namespaceStub();
    const scope = { KV: namespace } as unknown as KvEnv;

    await provider.set(scope, "k", "v", { ttlSeconds: 300 });
    await provider.set(scope, "k2", "v", {});

    expect(namespace.puts[0]?.options).toStrictEqual({ expirationTtl: 300 });
    expect(namespace.puts[1]?.options).toStrictEqual({});
  });

  it("maps an incomplete list page onto a cursor, and a complete one onto none", async () => {
    const withMore = namespaceStub({
      cursor: "c1",
      keys: [{ name: "a" }, { name: "b" }],
      list_complete: false,
    });
    const result = await cloudflare().list(
      { KV: withMore } as unknown as KvEnv,
      { limit: 2, prefix: "a" }
    );
    expect(result).toStrictEqual({
      complete: false,
      cursor: "c1",
      keys: ["a", "b"],
    });
    expect(withMore.lists[0]).toStrictEqual({ limit: 2, prefix: "a" });

    const last = namespaceStub({ keys: [{ name: "z" }], list_complete: true });
    await expect(
      cloudflare().list({ KV: last } as unknown as KvEnv, {})
    ).resolves.toStrictEqual({ complete: true, keys: ["z"] });
  });

  it("names the KV binding when it is absent", async () => {
    await expect(() => cloudflare().get({}, "k")).rejects.toThrow(
      expect.toSatisfy((error: KvError) => {
        expect(error).toBeInstanceOf(KvError);
        expect(error.code).toBe("provider_error");
        expect(error.message).toMatch(/`KV` KV binding/);
        expect(error.message).toMatch(/kv_namespaces/);
        return true;
      })
    );
  });

  it("names the missing rate limit binding, and reports it as not_supported", async () => {
    const provider = cloudflare();
    // Non-null: the provider declares `consume`.
    const consume = provider.consume as NonNullable<typeof provider.consume>;

    await expect(
      consume(env(), { key: "1.2.3.4", policy: STRICT })
    ).rejects.toThrow(
      expect.toSatisfy((error: KvError) => {
        expect(error).toBeInstanceOf(KvError);
        expect(error.code).toBe("not_supported");
        expect(error.message).toMatch(/RL_STRICT/);
        expect(error.message).toMatch(/ratelimits/);
        return true;
      })
    );
  });

  it("returns success alone, with no invented remaining or resetAt", async () => {
    const provider = cloudflare();
    const consume = provider.consume as NonNullable<typeof provider.consume>;
    const calls: { key: string }[] = [];
    const scope = env({
      RL_STRICT: {
        limit: (options: { key: string }) => {
          calls.push(options);
          return Promise.resolve({ success: false });
        },
      },
    });

    const result = await consume(scope, { key: "1.2.3.4", policy: STRICT });
    expect(result).toStrictEqual({ success: false });
    expect(calls).toStrictEqual([{ key: "1.2.3.4" }]);
  });

  it("refuses a period the binding cannot express", async () => {
    const provider = cloudflare();
    const consume = provider.consume as NonNullable<typeof provider.consume>;

    await expect(
      consume(env(), {
        key: "k",
        policy: { limit: 5, name: "odd", periodSeconds: 30 },
      })
    ).rejects.toThrow(
      expect.toSatisfy((error: KvError) => {
        expect(error).toBeInstanceOf(KvError);
        expect(error.code).toBe("not_supported");
        expect(error.message).toMatch(/10 or 60/);
        return true;
      })
    );
  });

  it("maps a KV status onto a code, and keeps the raw one", async () => {
    const failing = {
      KV: {
        get: () =>
          Promise.reject(new Error("KV GET failed: 429 Too Many Requests")),
      },
    } as unknown as KvEnv;

    await expect(() => cloudflare().get(failing, "k")).rejects.toThrow(
      expect.toSatisfy((error: KvError) => {
        expect(error).toBeInstanceOf(KvError);
        expect(error.code).toBe("rate_limited");
        expect(error.providerCode).toBe("429");
        expect(error.retryable).toBeTruthy();
        return true;
      })
    );
  });

  it("treats an unrecognized failure as non-retryable", async () => {
    const failing = {
      KV: { get: () => Promise.reject(new Error("something odd")) },
    } as unknown as KvEnv;

    await expect(() => cloudflare().get(failing, "k")).rejects.toThrow(
      expect.toSatisfy((error: KvError) => {
        expect(error).toBeInstanceOf(KvError);
        expect(error.code).toBe("provider_error");
        expect(error.providerCode).toBeUndefined();
        expect(error.retryable).toBeFalsy();
        return true;
      })
    );
  });

  it("honours a custom binding name", async () => {
    const namespace = namespaceStub();
    const scope = { CACHE: namespace } as unknown as KvEnv;
    await expect(
      cloudflare({ binding: "CACHE" }).get(scope, "k")
    ).resolves.toBe('"stored"');
  });
});
