// Tests for the Workers KV provider against stub bindings. Repo-only — the descriptor
// ships `cloudflare.ts` and nothing else — and it runs on `node:test` via
// `pnpm test:modules`.
//
// There is no Cloudflare account in the loop. What is worth checking here is the part
// that is ours: which binding name each call reaches for, how a `list` page is mapped
// onto `KvListResult`, and how a KV status becomes a `KvError` code. `../provider`
// resolves through the shim beside this module to the real contract.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cloudflare } from "./cloudflare.ts";
import { KvError } from "../provider.ts";
import type { KvEnv, Policy } from "../provider.ts";

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
    assert.equal(provider.name, "cloudflare");
    assert.equal(provider.minTtlSeconds, 60);
  });

  it("passes a TTL as expirationTtl, and omits the property without one", async () => {
    const provider = cloudflare();
    const namespace = namespaceStub();
    const scope = { KV: namespace } as unknown as KvEnv;

    await provider.set(scope, "k", "v", { ttlSeconds: 300 });
    await provider.set(scope, "k2", "v", {});

    assert.deepEqual(namespace.puts[0]?.options, { expirationTtl: 300 });
    assert.deepEqual(namespace.puts[1]?.options, {});
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
    assert.deepEqual(result, {
      complete: false,
      cursor: "c1",
      keys: ["a", "b"],
    });
    assert.deepEqual(withMore.lists[0], { limit: 2, prefix: "a" });

    const last = namespaceStub({ keys: [{ name: "z" }], list_complete: true });
    assert.deepEqual(
      await cloudflare().list({ KV: last } as unknown as KvEnv, {}),
      { complete: true, keys: ["z"] }
    );
  });

  it("names the KV binding when it is absent", async () => {
    await assert.rejects(
      () => cloudflare().get({}, "k"),
      (error: unknown) => {
        assert.ok(error instanceof KvError);
        assert.equal(error.code, "provider_error");
        assert.match(error.message, /`KV` KV binding/);
        assert.match(error.message, /kv_namespaces/);
        return true;
      }
    );
  });

  it("names the missing rate limit binding, and reports it as not_supported", async () => {
    const provider = cloudflare();
    // Non-null: the provider declares `consume`.
    const consume = provider.consume as NonNullable<typeof provider.consume>;

    await assert.rejects(
      async () => await consume(env(), { key: "1.2.3.4", policy: STRICT }),
      (error: unknown) => {
        assert.ok(error instanceof KvError);
        assert.equal(error.code, "not_supported");
        assert.match(error.message, /RL_STRICT/);
        assert.match(error.message, /ratelimits/);
        return true;
      }
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
    assert.deepEqual(result, { success: false });
    assert.deepEqual(calls, [{ key: "1.2.3.4" }]);
  });

  it("refuses a period the binding cannot express", async () => {
    const provider = cloudflare();
    const consume = provider.consume as NonNullable<typeof provider.consume>;

    await assert.rejects(
      async () =>
        await consume(env(), {
          key: "k",
          policy: { limit: 5, name: "odd", periodSeconds: 30 },
        }),
      (error: unknown) => {
        assert.ok(error instanceof KvError);
        assert.equal(error.code, "not_supported");
        assert.match(error.message, /10 or 60/);
        return true;
      }
    );
  });

  it("maps a KV status onto a code, and keeps the raw one", async () => {
    const failing = {
      KV: {
        get: () =>
          Promise.reject(new Error("KV GET failed: 429 Too Many Requests")),
      },
    } as unknown as KvEnv;

    await assert.rejects(
      () => cloudflare().get(failing, "k"),
      (error: unknown) => {
        assert.ok(error instanceof KvError);
        assert.equal(error.code, "rate_limited");
        assert.equal(error.providerCode, "429");
        assert.equal(error.retryable, true);
        return true;
      }
    );
  });

  it("treats an unrecognized failure as non-retryable", async () => {
    const failing = {
      KV: { get: () => Promise.reject(new Error("something odd")) },
    } as unknown as KvEnv;

    await assert.rejects(
      () => cloudflare().get(failing, "k"),
      (error: unknown) => {
        assert.ok(error instanceof KvError);
        assert.equal(error.code, "provider_error");
        assert.equal(error.providerCode, undefined);
        assert.equal(error.retryable, false);
        return true;
      }
    );
  });

  it("honours a custom binding name", async () => {
    const namespace = namespaceStub();
    const scope = { CACHE: namespace } as unknown as KvEnv;
    assert.equal(
      await cloudflare({ binding: "CACHE" }).get(scope, "k"),
      '"stored"'
    );
  });
});
