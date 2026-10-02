// Tests for the Upstash provider: the SCAN cursor over 2,500 keys, the glob the `MATCH`
// argument carries, the fixed-window counter behind `consume`, the error table, and the
// three preconditions that throw before a request leaves.
//
// Nothing here reaches Upstash, and `@upstash/redis` is not installed in this repo. The
// provider builds its client through a dynamic `await import()` and takes an already-built
// one through `UpstashKvOptions.client`, so passing the fake below never triggers the
// import. Everything else is real: `../index` and `../provider` resolve through the shims
// beside this module to the actual `packages/kv` core, so these assertions go through the
// same key building, JSON encoding, size cap and TTL floor a deployed Worker uses.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { upstash } from "./upstash.ts";
import type { UpstashRedisClient } from "./upstash.ts";
import { defineKv, definePolicy } from "../index.ts";
import { KvError } from "../provider.ts";
import type { KvClient } from "../index.ts";

const ENV = { KV_KEY_PREFIX: "app:", KV_PROVIDER: "upstash" };

const STRICT = definePolicy({ limit: 3, name: "strict", periodSeconds: 60 });
const LOOSE = definePolicy({ limit: 100, name: "loose", periodSeconds: 60 });

interface Call {
  args: unknown[];
  name: string;
}

interface Fake extends UpstashRedisClient {
  calls: Call[];
  entries: Map<string, string>;
  /** Milliseconds left on a limiter bucket, as `PTTL` would report them. */
  ttlMs: Map<string, number>;
}

/** How many keys one `SCAN` iteration walks when the caller asks for no `count`. */
const FAKE_SCAN_COUNT = 10;

/**
 * A Redis stand-in: a `Map`, a real glob matcher, and a SCAN cursor that is an index into
 * the sorted keyspace. It walks a fixed slice per call and filters it, so an iteration
 * over a slice holding no match returns an empty page with a live cursor — the case that
 * breaks a caller who pages until a page comes back empty.
 */
function fake(overrides: Partial<UpstashRedisClient> = {}): Fake {
  const calls: Call[] = [];
  const entries = new Map<string, string>();
  const ttlMs = new Map<string, number>();

  function record(name: string, ...args: unknown[]): void {
    calls.push({ args, name });
  }

  const redis: Fake = {
    calls,

    del(...keys: string[]): Promise<number> {
      record("del", ...keys);
      let removed = 0;
      for (const key of keys) {
        if (entries.delete(key)) {
          removed += 1;
        }
      }
      return Promise.resolve(removed);
    },

    entries,

    eval(
      script: string,
      keys: string[],
      args: (number | string)[]
    ): Promise<[number, number]> {
      record("eval", script, keys, args);
      // INCR, then EXPIRE NX, then PTTL — the three the Lua script runs.
      const key = keys[0] as string;
      const count = Number(entries.get(key) ?? "0") + 1;
      entries.set(key, String(count));
      if (!ttlMs.has(key)) {
        ttlMs.set(key, Number(args[0]) * 1000);
      }
      return Promise.resolve([count, ttlMs.get(key) as number]);
    },

    get(key: string): Promise<string | null> {
      record("get", key);
      return Promise.resolve(entries.get(key) ?? null);
    },

    scan(
      cursor: string,
      options: { count?: number; match: string }
    ): Promise<[string, string[]]> {
      record("scan", cursor, options);
      const all = [...entries.keys()].toSorted();
      const start = Number(cursor);
      const end = Math.min(
        all.length,
        start + (options.count ?? FAKE_SCAN_COUNT)
      );
      const matcher = globToRegExp(options.match);
      const keys = all.slice(start, end).filter((key) => matcher.test(key));
      return Promise.resolve([end >= all.length ? "0" : String(end), keys]);
    },

    set(
      key: string,
      value: string,
      setOptions?: { ex?: number }
    ): Promise<string> {
      record("set", key, value, setOptions);
      entries.set(key, value);
      return Promise.resolve("OK");
    },

    ttlMs,

    ...overrides,
  };

  return redis;
}

/** Redis `MATCH` semantics, backslash escapes included, as a regular expression. */
function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index] as string;
    if (character === "\\") {
      index += 1;
      pattern += escapeLiteral(glob[index] ?? "\\");
    } else if (character === "*") {
      pattern += ".*";
    } else if (character === "?") {
      pattern += ".";
    } else {
      pattern += escapeLiteral(character);
    }
  }
  return new RegExp(`^${pattern}$`);
}

function escapeLiteral(character: string): string {
  return character.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function client(
  redis: UpstashRedisClient,
  env: Record<string, unknown> = ENV
): KvClient {
  return defineKv({
    policies: [LOOSE, STRICT],
    providers: [upstash({ client: redis })],
  }).create(env);
}

/** The arguments of the one call to `name`, which must be the only one. */
function onlyCall(redis: Fake, name: string): unknown[] {
  const matching = redis.calls.filter((call) => call.name === name);
  assert.equal(matching.length, 1, `expected one ${name} call`);
  return (matching[0] as Call).args;
}

describe("upstash kv provider", () => {
  it("selects on KV_PROVIDER and round-trips a value through the core", async () => {
    const redis = fake();
    const store = client(redis);
    assert.equal(store.provider, "upstash");

    const key = store.key({ namespace: "widget", parts: ["w_1"] });
    assert.equal(key, "app:widget:w_1");

    assert.equal(await store.get(key), null);
    await store.set(key, { count: 2, name: "hello" });
    assert.deepEqual(await store.get(key), { count: 2, name: "hello" });

    // The core owns the JSON, so what reaches Redis is the encoded string and nothing
    // else. This is what `automaticDeserialization: false` protects.
    assert.equal(redis.entries.get(key), '{"count":2,"name":"hello"}');

    await store.delete(key);
    assert.equal(await store.get(key), null);
  });

  it("passes `ex` only when the call carries a TTL", async () => {
    const redis = fake();
    const store = client(redis);

    await store.set("app:ttl:none", "kept");
    assert.deepEqual(onlyCall(redis, "set"), [
      "app:ttl:none",
      '"kept"',
      undefined,
    ]);

    redis.calls.length = 0;
    await store.set("app:ttl:hour", "kept", { ttlSeconds: 3600 });
    assert.deepEqual(onlyCall(redis, "set"), [
      "app:ttl:hour",
      '"kept"',
      { ex: 3600 },
    ]);
  });

  it("declares a one-second floor and refuses anything under it", async () => {
    const store = client(fake());
    await store.set("app:ttl:one", "ok", { ttlSeconds: 1 });

    await assert.rejects(
      () => store.set("app:ttl:zero", "no", { ttlSeconds: 0 }),
      (error: unknown) => {
        assert.ok(error instanceof KvError);
        assert.equal(error.code, "invalid_ttl");
        return true;
      }
    );
  });

  it("deletes an absent key without failing", async () => {
    const redis = fake();
    const store = client(redis);
    await store.delete("app:gone");
    assert.deepEqual(onlyCall(redis, "del"), ["app:gone"]);
  });

  it("pages 2,500 keys with the cursor SCAN issued", async () => {
    const redis = fake();
    const store = client(redis);
    const total = 2500;

    for (let index = 0; index < total; index += 1) {
      await store.set(`app:page:${String(index).padStart(4, "0")}`, index);
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    let complete = false;

    do {
      const result = await store.list({
        limit: 500,
        prefix: "page:",
        ...(cursor === undefined ? {} : { cursor }),
      });
      pages += 1;
      for (const key of result.keys) {
        assert.equal(seen.has(key), false, `duplicate key ${key}`);
        seen.add(key);
      }
      complete = result.complete;
      cursor = result.cursor;
      assert.equal(complete, cursor === undefined);
      assert.ok(pages <= 20, "the cursor is not advancing");
    } while (!complete);

    assert.equal(seen.size, total);
    assert.equal(seen.has("app:page:0000"), true);
    assert.equal(seen.has("app:page:2499"), true);
  });

  it("reports an empty page with a live cursor as incomplete", async () => {
    const redis = fake();
    const store = client(redis);

    // Two matching keys, sorted last, behind 30 keys that match nothing. The first
    // iteration therefore walks a slice holding no match.
    for (let index = 0; index < 30; index += 1) {
      await store.set(`app:other:${String(index).padStart(2, "0")}`, index);
    }
    await store.set("app:wanted:1", 1);
    await store.set("app:wanted:2", 2);

    const first = await store.list({ limit: 10, prefix: "wanted:" });
    assert.deepEqual(first.keys, []);
    // Empty, and not the end. A caller that stops here misses both keys.
    assert.equal(first.complete, false);
    assert.equal(typeof first.cursor, "string");

    const keys: string[] = [];
    let cursor = first.cursor;
    while (cursor !== undefined) {
      const page = await store.list({ cursor, limit: 10, prefix: "wanted:" });
      keys.push(...page.keys);
      cursor = page.cursor;
    }
    assert.deepEqual(keys, ["app:wanted:1", "app:wanted:2"]);
  });

  it("scopes the MATCH glob with KV_KEY_PREFIX", async () => {
    const redis = fake();
    await client(redis).list({});
    assert.deepEqual(onlyCall(redis, "scan"), ["0", { match: "app:*" }]);
  });

  it("escapes glob characters in the prefix and in KV_KEY_PREFIX", async () => {
    const redis = fake();
    const env = { ...ENV, KV_KEY_PREFIX: "a[1]:" };
    const store = client(redis, env);

    await store.set("a[1]:cache:*raw", "mine");
    await store.set("a[1]:cacheX:other", "theirs");

    const page = await store.list({ prefix: "cache:*" });
    // Without the escape, `[1]` is a character class and `*` matches anything, so both
    // keys would come back.
    assert.deepEqual(page.keys, ["a[1]:cache:*raw"]);
    assert.deepEqual(onlyCall(redis, "scan")[1], {
      match: String.raw`a\[1\]:cache:\**`,
    });
  });

  it("passes the caller's limit through as SCAN's COUNT", async () => {
    const redis = fake();
    await client(redis).list({ limit: 250, prefix: "x:" });
    assert.deepEqual(onlyCall(redis, "scan"), [
      "0",
      { count: 250, match: "app:x:*" },
    ]);
  });

  it("counts a fixed window in consume, and reports remaining and resetAt", async () => {
    const redis = fake();
    const store = client(redis);
    const before = Date.now();

    const first = await store.consume({ key: "1.2.3.4", policy: "strict" });
    assert.equal(first.success, true);
    assert.equal(first.remaining, 2);
    assert.ok((first.resetAt ?? 0) > before);

    assert.equal(
      (await store.consume({ key: "1.2.3.4", policy: "strict" })).remaining,
      1
    );
    assert.equal(
      (await store.consume({ key: "1.2.3.4", policy: "strict" })).remaining,
      0
    );

    const fourth = await store.consume({ key: "1.2.3.4", policy: "strict" });
    // A refusal is a value, never a throw.
    assert.equal(fourth.success, false);
    assert.equal(fourth.remaining, 0);
  });

  it("puts KV_KEY_PREFIX and the policy name in the bucket key", async () => {
    const redis = fake();
    const store = client(redis);

    await store.consume({ key: "1.2.3.4", policy: "strict" });
    const [, keys, args] = onlyCall(redis, "eval");
    assert.deepEqual(keys, ["app:rl:strict:1.2.3.4"]);
    assert.deepEqual(args, [60]);

    // A second policy over the same IP counts in its own bucket.
    await store.consume({ key: "1.2.3.4", policy: "loose" });
    assert.equal(redis.entries.get("app:rl:strict:1.2.3.4"), "1");
    assert.equal(redis.entries.get("app:rl:loose:1.2.3.4"), "1");
  });

  it("gives each key its own budget", async () => {
    const store = client(fake());
    for (let index = 0; index < 3; index += 1) {
      await store.consume({ key: "1.2.3.4", policy: "strict" });
    }
    assert.equal(
      (await store.consume({ key: "1.2.3.4", policy: "strict" })).success,
      false
    );
    assert.equal(
      (await store.consume({ key: "5.6.7.8", policy: "strict" })).success,
      true
    );
  });

  it("leaves the policy lookup to the core", async () => {
    const store = client(fake());
    await assert.rejects(
      () => store.consume({ key: "k", policy: "nope" }),
      (error: unknown) => {
        assert.ok(error instanceof KvError);
        assert.equal(error.code, "not_supported");
        return true;
      }
    );
  });

  describe("error mapping", () => {
    const rows: {
      code: string;
      message: string;
      providerCode: string;
      retryable: boolean;
    }[] = [
      {
        code: "provider_error",
        message: "Upstash Redis request failed: 401 Unauthorized",
        providerCode: "401",
        retryable: false,
      },
      {
        code: "provider_error",
        message: "Upstash Redis request failed: 403 Forbidden",
        providerCode: "403",
        retryable: false,
      },
      {
        code: "rate_limited",
        message:
          "Upstash Redis request failed: 429 max daily request limit exceeded",
        providerCode: "429",
        retryable: true,
      },
      {
        code: "too_large",
        message: "Upstash Redis request failed: 413 Payload Too Large",
        providerCode: "413",
        retryable: false,
      },
      {
        code: "provider_error",
        message: "Upstash Redis request failed: 500 Internal Server Error",
        providerCode: "500",
        retryable: true,
      },
      {
        code: "provider_error",
        message: "Upstash Redis request failed: 503 Service Unavailable",
        providerCode: "503",
        retryable: true,
      },
      {
        code: "provider_error",
        message:
          "WRONGTYPE Operation against a key holding the wrong kind of value",
        providerCode: "WRONGTYPE",
        retryable: false,
      },
    ];

    for (const row of rows) {
      it(`maps ${row.providerCode}`, async () => {
        const store = client(
          fake({
            get(): Promise<string | null> {
              return Promise.reject(new Error(row.message));
            },
          })
        );

        await assert.rejects(
          () => store.get("app:k"),
          (error: unknown) => {
            assert.ok(error instanceof KvError);
            assert.equal(error.code, row.code);
            assert.equal(error.providerCode, row.providerCode);
            assert.equal(error.retryable, row.retryable);
            return true;
          }
        );
      });
    }

    it("maps an oversize record reported without a 413", async () => {
      const store = client(
        fake({
          set(): Promise<string> {
            return Promise.reject(
              new Error("ERR max request size exceeded, limit is 1048576 bytes")
            );
          },
        })
      );

      await assert.rejects(
        () => store.set("app:big", "x"),
        (error: unknown) => {
          assert.ok(error instanceof KvError);
          assert.equal(error.code, "too_large");
          return true;
        }
      );
    });

    it("falls through to provider_error, not retryable, on an unknown failure", async () => {
      const store = client(
        fake({
          get(): Promise<string | null> {
            return Promise.reject(new Error("socket hang up"));
          },
        })
      );

      await assert.rejects(
        () => store.get("app:k"),
        (error: unknown) => {
          assert.ok(error instanceof KvError);
          assert.equal(error.code, "provider_error");
          assert.equal(error.retryable, false);
          return true;
        }
      );
    });
  });

  describe("preconditions", () => {
    it("throws provider_error naming KV_KEY_PREFIX when it is empty", async () => {
      const redis = fake();
      const store = client(redis, {
        KV_KEY_PREFIX: "",
        KV_PROVIDER: "upstash",
      });

      await assert.rejects(
        () => store.get("k"),
        (error: unknown) => {
          assert.ok(error instanceof KvError);
          assert.equal(error.code, "provider_error");
          assert.match(error.message, /KV_KEY_PREFIX/);
          return true;
        }
      );
      // Nothing left for Upstash.
      assert.deepEqual(redis.calls, []);
    });

    it("throws provider_error naming KV_KEY_PREFIX when it is unset", async () => {
      const store = client(fake(), { KV_PROVIDER: "upstash" });
      await assert.rejects(
        () => store.list({}),
        (error: unknown) => {
          assert.ok(error instanceof KvError);
          assert.match(error.message, /KV_KEY_PREFIX/);
          return true;
        }
      );
    });

    for (const name of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
      it(`throws provider_error naming ${name} when it is missing`, async () => {
        // No injected client here, so the provider takes the build path and checks the
        // two secrets. It throws before the dynamic import, which is what keeps this
        // test runnable with `@upstash/redis` absent from the repo.
        const env: Record<string, unknown> = {
          KV_KEY_PREFIX: "app:",
          KV_PROVIDER: "upstash",
          UPSTASH_REDIS_REST_TOKEN: "token",
          UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        };
        delete env[name];

        const store = defineKv({
          policies: [],
          providers: [upstash()],
        }).create(env);

        await assert.rejects(
          () => store.get("app:k"),
          (error: unknown) => {
            assert.ok(error instanceof KvError);
            assert.equal(error.code, "provider_error");
            assert.match(error.message, new RegExp(name));
            return true;
          }
        );
      });
    }
  });
});
