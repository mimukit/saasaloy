// Tests for the vendor-blind core: provider selection, the TTL floor, the size cap, the
// policy table, JSON round-tripping and error normalization.
//
// This file is NOT in the descriptor's `scaffolds[].files` list, so `add kv` never copies
// it into a user's project. See the header of `keys.test.ts` for why it runs on
// `node:test` with `.ts` imports.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineKv, definePolicy, MAX_VALUE_BYTES } from "./define.ts";
import { KvError } from "./provider.ts";
import type {
  ConsumeResult,
  KvEnv,
  KvListOptions,
  KvListResult,
  KvProvider,
  KvSetOptions,
  ResolvedConsumeRequest,
} from "./provider.ts";

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
  try {
    await fn();
  } catch (error) {
    assert.ok(
      error instanceof KvError,
      `expected a KvError, got ${String(error)}`
    );
    return error.code;
  }
  assert.fail("expected a throw");
}

describe("KV_PROVIDER selection", () => {
  it("selects the named provider", () => {
    assert.equal(client().kv.provider, "stub");
  });

  // Required even with one provider installed. A default in either direction is a silent
  // failure: a deploy that quietly reads an empty map, or a test that quietly writes to
  // the real namespace.
  it("throws when KV_PROVIDER is unset, and never falls back", () => {
    assert.throws(() => registry().kv.create({}), /KV_PROVIDER is not set/);
  });

  it("throws when KV_PROVIDER names an uninstalled provider", () => {
    assert.throws(
      () => registry().kv.create({ KV_PROVIDER: "nope" }),
      /KV_PROVIDER is "nope", which is not registered/
    );
  });

  it("names the registered providers in both messages", () => {
    assert.throws(() => registry().kv.create({}), /Registered providers: stub/);
  });

  it("tells an empty registry to install a provider", () => {
    const empty = defineKv({ policies: [], providers: [] });
    assert.throws(() => empty.create({}), /saasaloy add kv-memory/);
  });
});

describe("get, set and delete", () => {
  it("round-trips a value through JSON", async () => {
    const { kv } = client();
    await kv.set("a", { n: 1, xs: ["b"] });
    assert.deepEqual(await kv.get<{ n: number; xs: string[] }>("a"), {
      n: 1,
      xs: ["b"],
    });
  });

  it("returns null for a missing key rather than throwing", async () => {
    assert.equal(await client().kv.get("absent"), null);
  });

  it("stores a string, so a provider never sees a structure", async () => {
    const { kv, store } = client();
    await kv.set("a", { n: 1 });
    assert.equal(store.get("a"), '{"n":1}');
  });

  it("deletes, and deleting an absent key succeeds", async () => {
    const { kv } = client();
    await kv.set("a", 1);
    await kv.delete("a");
    assert.equal(await kv.get("a"), null);
    await assert.doesNotReject(() => kv.delete("a"));
  });

  it("lists by prefix", async () => {
    const { kv } = client();
    await kv.set("p:1", 1);
    await kv.set("p:2", 2);
    await kv.set("q:1", 3);
    const page = await kv.list({ prefix: "p:" });
    assert.deepEqual(page.keys.toSorted(), ["p:1", "p:2"]);
    assert.equal(page.complete, true);
  });

  it("validates the key before the provider is reached", async () => {
    assert.equal(
      await codeOf(() => client().kv.get("k".repeat(513))),
      "invalid_key"
    );
  });

  it("applies KV_KEY_PREFIX through key()", () => {
    const { kv } = client({ KV_KEY_PREFIX: "staging:", KV_PROVIDER: "stub" });
    assert.equal(
      kv.key({ namespace: "flags", parts: ["doc"] }),
      "staging:flags:doc"
    );
  });
});

describe("the TTL floor", () => {
  it("passes a TTL at or above the floor straight through", async () => {
    const { kv, writes } = client();
    await kv.set("a", 1, { ttlSeconds: 60 });
    assert.equal(writes[0]?.options.ttlSeconds, 60);
  });

  // Rounding 5 up to 60 would make the same call expire at a different time on a
  // different provider, with nothing in the logs to say so.
  it("throws invalid_ttl below the floor and never rounds", async () => {
    const { kv, writes } = client();
    assert.equal(
      await codeOf(() => kv.set("a", 1, { ttlSeconds: 5 })),
      "invalid_ttl"
    );
    assert.equal(writes.length, 0, "nothing was written");
    assert.equal(await kv.get("a"), null);
  });

  it("names the floor and the provider in the message", async () => {
    const { kv } = client();
    await assert.rejects(
      () => kv.set("a", 1, { ttlSeconds: 5 }),
      /"stub".*60 seconds/s
    );
  });

  it("refuses a fractional or negative TTL", async () => {
    const { kv } = client();
    assert.equal(
      await codeOf(() => kv.set("a", 1, { ttlSeconds: 1.5 })),
      "invalid_ttl"
    );
    assert.equal(
      await codeOf(() => kv.set("a", 1, { ttlSeconds: -1 })),
      "invalid_ttl"
    );
  });

  it("allows no TTL at all", async () => {
    const { kv, writes } = client();
    await kv.set("a", 1);
    assert.equal(writes[0]?.options.ttlSeconds, undefined);
  });
});

describe("the value size cap", () => {
  it("throws too_large before any provider call", async () => {
    const { kv, writes } = client();
    const big = "x".repeat(MAX_VALUE_BYTES + 1);
    assert.equal(await codeOf(() => kv.set("a", big)), "too_large");
    assert.equal(writes.length, 0);
  });

  it("refuses a value that JSON cannot encode", async () => {
    const { kv } = client();
    assert.equal(await codeOf(() => kv.set("a", undefined)), "not_supported");
    assert.equal(await codeOf(() => kv.set("a", 1n)), "not_supported");
  });

  it("stores null, which is a value rather than an absence at write time", async () => {
    const { kv, store } = client();
    await kv.set("a", null);
    assert.equal(store.get("a"), "null");
  });
});

describe("the policy table", () => {
  it("resolves a registered policy by name", () => {
    assert.deepEqual(client().kv.policy("strict"), strict);
  });

  it("raises not_supported for an unregistered name", async () => {
    const { kv } = client();
    assert.equal(await codeOf(() => kv.policy("nope")), "not_supported");
    assert.equal(
      await codeOf(() => kv.consume({ key: "ip", policy: "nope" })),
      "not_supported"
    );
  });

  it("names the registered policies in the message", async () => {
    await assert.rejects(
      () => client().kv.consume({ key: "ip", policy: "nope" }),
      /Registered policies: strict/
    );
  });

  it("hands the provider the resolved policy, not the name", async () => {
    const { kv } = client();
    const first = await kv.consume({ key: "ip", policy: "strict" });
    assert.equal(first.success, true);
    assert.equal(first.remaining, 2);
  });

  it("returns success: false past the limit instead of throwing", async () => {
    const { kv } = client();
    for (let i = 0; i < 3; i++) {
      await kv.consume({ key: "ip", policy: "strict" });
    }
    const fourth = await kv.consume({ key: "ip", policy: "strict" });
    assert.equal(fourth.success, false);
    assert.equal(fourth.remaining, 0);
  });

  it("throws not_supported when the provider cannot count, naming it", async () => {
    const { kv } = registry({ consume: undefined });
    const store = kv.create({ KV_PROVIDER: "stub" });
    await assert.rejects(
      () => store.consume({ key: "ip", policy: "strict" }),
      (error: unknown) =>
        error instanceof KvError &&
        error.code === "not_supported" &&
        error.message.includes('"stub"')
    );
  });

  it("rejects a policy name that cannot become an RL_ binding", () => {
    assert.throws(
      () => definePolicy({ limit: 1, name: "Strict!", periodSeconds: 10 }),
      /must be lower-case/
    );
    assert.throws(
      () => definePolicy({ limit: 0, name: "strict", periodSeconds: 10 }),
      /positive integer/
    );
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
    await assert.rejects(
      () => store.get("a"),
      (error: unknown) =>
        error instanceof KvError &&
        error.code === "provider_error" &&
        error.retryable === false &&
        error.cause === boom &&
        error.message === "stub: get failed"
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
    await assert.rejects(
      () => store.set("a", 1),
      (error: unknown) => error === mapped
    );
  });

  it("reports a stored value that is not JSON as provider_error", async () => {
    const { kv, store } = client();
    store.set("a", "not json");
    assert.equal(await codeOf(() => kv.get("a")), "provider_error");
  });
});
