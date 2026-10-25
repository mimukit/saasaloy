// Tests for the vendor-blind core: provider selection, the TTL floor, the size cap, the
// policy table, JSON round-tripping and error normalization.
//
// It ships as `src/define.test.ts` when testing is on, and `pnpm test:modules` runs it in
// place in the saasaloy repo.

import { describe, expect, it } from "vitest";
import { defineKv, definePolicy, MAX_VALUE_BYTES } from "./define";
import { KvError } from "./provider";
import type {
  ConsumeResult,
  KvEnv,
  KvListOptions,
  KvListResult,
  KvProvider,
  KvSetOptions,
  ResolvedConsumeRequest,
} from "./provider";

interface StubCall {
  key: string;
  options: KvSetOptions;
  value: string;
}

/** A minimal counting provider, so the core's behaviour is what the tests observe. */
function stub(overrides: Partial<KvProvider> = {}) {
  const store = new Map<string, string>();
  const writes: StubCall[] = [];
  const counters = new Map<string, number>();

  const provider: KvProvider = {
    consume(_env: KvEnv, request: ResolvedConsumeRequest): ConsumeResult {
      const used = (counters.get(request.key) ?? 0) + 1;
      counters.set(request.key, used);
      return {
        remaining: Math.max(0, request.policy.limit - used),
        success: used <= request.policy.limit,
      };
    },
    delete(_env: KvEnv, key: string): Promise<void> {
      store.delete(key);
      return Promise.resolve();
    },
    get(_env: KvEnv, key: string): Promise<string | null> {
      return Promise.resolve(store.get(key) ?? null);
    },
    list(_env: KvEnv, options: KvListOptions): Promise<KvListResult> {
      const keys = [...store.keys()].filter((k) =>
        k.startsWith(options.prefix ?? "")
      );
      return Promise.resolve({ complete: true, keys });
    },
    minTtlSeconds: 60,
    name: "stub",
    set(
      _env: KvEnv,
      key: string,
      value: string,
      options: KvSetOptions
    ): Promise<void> {
      writes.push({ key, options, value });
      store.set(key, value);
      return Promise.resolve();
    },
    ...overrides,
  };

  return { provider, store, writes };
}

const strict = definePolicy({ limit: 3, name: "strict", periodSeconds: 10 });

function registry(overrides: Partial<KvProvider> = {}) {
  const { provider, store, writes } = stub(overrides);
  return {
    kv: defineKv({ policies: [strict], providers: [provider] }),
    store,
    writes,
  };
}

function client(env?: KvEnv) {
  const built = registry();
  return { ...built, kv: built.kv.create(env ?? { KV_PROVIDER: "stub" }) };
}

async function codeOf(fn: () => unknown): Promise<string> {
  let thrown: unknown;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  // Fails with the thrown value in the diff, or `undefined` when nothing threw.
  expect(thrown).toBeInstanceOf(KvError);
  return (thrown as KvError).code;
}

describe("KV_PROVIDER selection", () => {
  it("selects the named provider", () => {
    expect(client().kv.provider).toBe("stub");
  });

  // Required even with one provider installed. A default in either direction is a silent
  // failure: a deploy that quietly reads an empty map, or a test that quietly writes to
  // the real namespace.
  it("throws when KV_PROVIDER is unset, and never falls back", () => {
    expect(() => registry().kv.create({})).toThrow(/KV_PROVIDER is not set/);
  });

  it("throws when KV_PROVIDER names an uninstalled provider", () => {
    expect(() => registry().kv.create({ KV_PROVIDER: "nope" })).toThrow(
      /KV_PROVIDER is "nope", which is not registered/
    );
  });

  it("names the registered providers in both messages", () => {
    expect(() => registry().kv.create({})).toThrow(
      /Registered providers: stub/
    );
  });

  it("tells an empty registry to install a provider", () => {
    const empty = defineKv({ policies: [], providers: [] });
    expect(() => empty.create({})).toThrow(/saasaloy add kv-memory/);
  });
});

describe("get, set and delete", () => {
  it("round-trips a value through JSON", async () => {
    const { kv } = client();
    await kv.set("a", { n: 1, xs: ["b"] });
    await expect(
      kv.get<{ n: number; xs: string[] }>("a")
    ).resolves.toStrictEqual({
      n: 1,
      xs: ["b"],
    });
  });

  it("returns null for a missing key rather than throwing", async () => {
    await expect(client().kv.get("absent")).resolves.toBeNull();
  });

  it("stores a string, so a provider never sees a structure", async () => {
    const { kv, store } = client();
    await kv.set("a", { n: 1 });
    expect(store.get("a")).toBe('{"n":1}');
  });

  it("deletes, and deleting an absent key succeeds", async () => {
    const { kv } = client();
    await kv.set("a", 1);
    await kv.delete("a");
    await expect(kv.get("a")).resolves.toBeNull();
    await expect(kv.delete("a")).resolves.toBeUndefined();
  });

  it("lists by prefix", async () => {
    const { kv } = client();
    await kv.set("p:1", 1);
    await kv.set("p:2", 2);
    await kv.set("q:1", 3);
    const page = await kv.list({ prefix: "p:" });
    expect(page.keys.toSorted()).toStrictEqual(["p:1", "p:2"]);
    expect(page.complete).toBeTruthy();
  });

  it("validates the key before the provider is reached", async () => {
    await expect(codeOf(() => client().kv.get("k".repeat(513)))).resolves.toBe(
      "invalid_key"
    );
  });

  it("applies KV_KEY_PREFIX through key()", () => {
    const { kv } = client({ KV_KEY_PREFIX: "staging:", KV_PROVIDER: "stub" });
    expect(kv.key({ namespace: "flags", parts: ["doc"] })).toBe(
      "staging:flags:doc"
    );
  });
});

describe("the TTL floor", () => {
  it("passes a TTL at or above the floor straight through", async () => {
    const { kv, writes } = client();
    await kv.set("a", 1, { ttlSeconds: 60 });
    expect(writes[0]?.options.ttlSeconds).toBe(60);
  });

  // Rounding 5 up to 60 would make the same call expire at a different time on a
  // different provider, with nothing in the logs to say so.
  it("throws invalid_ttl below the floor and never rounds", async () => {
    const { kv, writes } = client();
    await expect(codeOf(() => kv.set("a", 1, { ttlSeconds: 5 }))).resolves.toBe(
      "invalid_ttl"
    );
    expect(writes).toHaveLength(0);
    await expect(kv.get("a")).resolves.toBeNull();
  });

  it("names the floor and the provider in the message", async () => {
    const { kv } = client();
    await expect(() => kv.set("a", 1, { ttlSeconds: 5 })).rejects.toThrow(
      /"stub".*60 seconds/s
    );
  });

  it("refuses a fractional or negative TTL", async () => {
    const { kv } = client();
    await expect(
      codeOf(() => kv.set("a", 1, { ttlSeconds: 1.5 }))
    ).resolves.toBe("invalid_ttl");
    await expect(
      codeOf(() => kv.set("a", 1, { ttlSeconds: -1 }))
    ).resolves.toBe("invalid_ttl");
  });

  it("allows no TTL at all", async () => {
    const { kv, writes } = client();
    await kv.set("a", 1);
    expect(writes[0]?.options.ttlSeconds).toBeUndefined();
  });
});

describe("the value size cap", () => {
  it("throws too_large before any provider call", async () => {
    const { kv, writes } = client();
    const big = "x".repeat(MAX_VALUE_BYTES + 1);
    await expect(codeOf(() => kv.set("a", big))).resolves.toBe("too_large");
    expect(writes).toHaveLength(0);
  });

  it("refuses a value that JSON cannot encode", async () => {
    const { kv } = client();
    await expect(codeOf(() => kv.set("a", undefined))).resolves.toBe(
      "not_supported"
    );
    await expect(codeOf(() => kv.set("a", 1n))).resolves.toBe("not_supported");
  });

  it("stores null, which is a value rather than an absence at write time", async () => {
    const { kv, store } = client();
    await kv.set("a", null);
    expect(store.get("a")).toBe("null");
  });
});

describe("the policy table", () => {
  it("resolves a registered policy by name", () => {
    expect(client().kv.policy("strict")).toStrictEqual(strict);
  });

  it("raises not_supported for an unregistered name", async () => {
    const { kv } = client();
    await expect(codeOf(() => kv.policy("nope"))).resolves.toBe(
      "not_supported"
    );
    await expect(
      codeOf(() => kv.consume({ key: "ip", policy: "nope" }))
    ).resolves.toBe("not_supported");
  });

  it("names the registered policies in the message", async () => {
    await expect(() =>
      client().kv.consume({ key: "ip", policy: "nope" })
    ).rejects.toThrow(/Registered policies: strict/);
  });

  it("hands the provider the resolved policy, not the name", async () => {
    const { kv } = client();
    const first = await kv.consume({ key: "ip", policy: "strict" });
    expect(first.success).toBeTruthy();
    expect(first.remaining).toBe(2);
  });

  it("returns success: false past the limit instead of throwing", async () => {
    const { kv } = client();
    for (let i = 0; i < 3; i++) {
      await kv.consume({ key: "ip", policy: "strict" });
    }
    const fourth = await kv.consume({ key: "ip", policy: "strict" });
    expect(fourth.success).toBeFalsy();
    expect(fourth.remaining).toBe(0);
  });

  it("throws not_supported when the provider cannot count, naming it", async () => {
    const { kv } = registry({ consume: undefined });
    const store = kv.create({ KV_PROVIDER: "stub" });
    await expect(() =>
      store.consume({ key: "ip", policy: "strict" })
    ).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof KvError &&
          error.code === "not_supported" &&
          error.message.includes('"stub"')
      )
    );
  });

  it("rejects a policy name that cannot become an RL_ binding", () => {
    expect(() =>
      definePolicy({ limit: 1, name: "Strict!", periodSeconds: 10 })
    ).toThrow(/must be lower-case/);
    expect(() =>
      definePolicy({ limit: 0, name: "strict", periodSeconds: 10 })
    ).toThrow(/positive integer/);
  });
});

describe("error normalization", () => {
  it("wraps a raw provider throw as provider_error, keeping the cause", async () => {
    const boom = new TypeError("fetch failed");
    const { kv } = registry({
      get() {
        throw boom;
      },
    });
    const store = kv.create({ KV_PROVIDER: "stub" });
    await expect(() => store.get("a")).rejects.toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof KvError &&
          error.code === "provider_error" &&
          error.retryable === false &&
          error.cause === boom &&
          error.message === "stub: get failed"
      )
    );
  });

  it("re-throws a KvError a provider raised, untouched", async () => {
    const mapped = new KvError("rate_limited", "one write per second", {
      providerCode: "KV_PUT_RATE_LIMITED",
      retryable: true,
    });
    const { kv } = registry({
      set() {
        return Promise.reject(mapped);
      },
    });
    const store = kv.create({ KV_PROVIDER: "stub" });
    await expect(() => store.set("a", 1)).rejects.toThrow(
      expect.toSatisfy((error: unknown) => error === mapped)
    );
  });

  it("reports a stored value that is not JSON as provider_error", async () => {
    const { kv, store } = client();
    store.set("a", "not json");
    await expect(codeOf(() => kv.get("a"))).resolves.toBe("provider_error");
  });
});
