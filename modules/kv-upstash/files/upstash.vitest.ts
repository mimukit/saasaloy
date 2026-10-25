// Tests for the Upstash provider: the SCAN cursor over 2,500 keys, the glob the `MATCH`
// argument carries, the fixed-window counter behind `consume`, the error table, and the
// three preconditions that throw before a request leaves.
//
// Nothing here reaches Upstash, and `@upstash/redis` is not installed in this repo. The
// provider builds its client through a dynamic `await import()` and takes an
// already-built one through `UpstashKvOptions.client`, so passing the fake below never
// triggers the import. Everything else is real: `../index` and `../provider` resolve by
// their project paths to the actual `packages/kv` core, so these assertions go through
// the same key building, JSON encoding, size cap and TTL floor a deployed Worker uses.

import { describe, expect, it } from "vitest";
import { upstash } from "./upstash";
import type { UpstashRedisClient } from "./upstash";
import { defineKv, definePolicy } from "../index";
import { KvError } from "../provider";
import type { KvClient } from "../index";

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
  expect(matching).toHaveLength(1);
  return (matching[0] as Call).args;
}

describe("upstash kv provider", () => {
  it("selects on KV_PROVIDER and round-trips a value through the core", async () => {
    const redis = fake();
    const store = client(redis);
    expect(store.provider).toBe("upstash");

    const key = store.key({ namespace: "widget", parts: ["w_1"] });
    expect(key).toBe("app:widget:w_1");

    await expect(store.get(key)).resolves.toBeNull();
    await store.set(key, { count: 2, name: "hello" });
    await expect(store.get(key)).resolves.toStrictEqual({
      count: 2,
      name: "hello",
    });

    // The core owns the JSON, so what reaches Redis is the encoded string and nothing
    // else. This is what `automaticDeserialization: false` protects.
    expect(redis.entries.get(key)).toBe('{"count":2,"name":"hello"}');
  });

  it("deletes a value through the core", async () => {
    const store = client(fake());
    const key = store.key({ namespace: "widget", parts: ["w_1"] });
    await store.set(key, { count: 2, name: "hello" });

    await store.delete(key);
    await expect(store.get(key)).resolves.toBeNull();
  });

  it("passes `ex` only when the call carries a TTL", async () => {
    const redis = fake();
    const store = client(redis);

    await store.set("app:ttl:none", "kept");
    expect(onlyCall(redis, "set")).toStrictEqual([
      "app:ttl:none",
      '"kept"',
      undefined,
    ]);

    redis.calls.length = 0;
    await store.set("app:ttl:hour", "kept", { ttlSeconds: 3600 });
    expect(onlyCall(redis, "set")).toStrictEqual([
      "app:ttl:hour",
      '"kept"',
      { ex: 3600 },
    ]);
  });

  it("declares a one-second floor and refuses anything under it", async () => {
    const store = client(fake());
    await store.set("app:ttl:one", "ok", { ttlSeconds: 1 });

    await expect(() =>
      store.set("app:ttl:zero", "no", { ttlSeconds: 0 })
    ).rejects.toThrow(
      expect.toSatisfy((error: KvError) => {
        expect(error).toBeInstanceOf(KvError);
        expect(error.code).toBe("invalid_ttl");
        return true;
      })
    );
  });

  it("deletes an absent key without failing", async () => {
    const redis = fake();
    const store = client(redis);
    await store.delete("app:gone");
    expect(onlyCall(redis, "del")).toStrictEqual(["app:gone"]);
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
        prefix: "app:page:",
        ...(cursor === undefined ? {} : { cursor }),
      });
      pages += 1;
      for (const key of result.keys) {
        expect(seen.has(key), `duplicate key ${key}`).toBeFalsy();
        seen.add(key);
      }
      ({ complete, cursor } = result);
      expect(complete).toBe(cursor === undefined);
      expect(pages <= 20, "the cursor is not advancing").toBeTruthy();
    } while (!complete);

    expect(seen.size).toBe(total);
    expect(seen.has("app:page:0000")).toBeTruthy();
    expect(seen.has("app:page:2499")).toBeTruthy();
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

    const first = await store.list({ limit: 10, prefix: "app:wanted:" });
    expect(first.keys).toStrictEqual([]);
    // Empty, and not the end. A caller that stops here misses both keys.
    expect(first.complete).toBeFalsy();
    expect(first.cursor).toBeTypeOf("string");

    const keys: string[] = [];
    let { cursor } = first;
    while (cursor !== undefined) {
      const page = await store.list({
        cursor,
        limit: 10,
        prefix: "app:wanted:",
      });
      keys.push(...page.keys);
      ({ cursor } = page);
    }
    expect(keys).toStrictEqual(["app:wanted:1", "app:wanted:2"]);
  });

  it("scopes the MATCH glob with KV_KEY_PREFIX", async () => {
    const redis = fake();
    await client(redis).list({});
    expect(onlyCall(redis, "scan")).toStrictEqual(["0", { match: "app:*" }]);
  });

  it("finds the keys under a prefix client.key() produced", async () => {
    const redis = fake();
    const store = client(redis);
    const first = store.key({ namespace: "cache", parts: ["a"] });
    const second = store.key({ namespace: "cache", parts: ["b"] });
    await store.set(first, 1);
    await store.set(second, 2);
    await store.set(store.key({ namespace: "other", parts: ["c"] }), 3);

    // The prefix a caller builds the way the contract says: from `client.key()`, so it
    // already carries KV_KEY_PREFIX. kv-memory and kv-cloudflare read it the same way.
    const prefix = store.key({ namespace: "cache", parts: ["x"] }).slice(0, -1);
    expect(prefix).toBe("app:cache:");

    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await store.list({
        prefix,
        ...(cursor === undefined ? {} : { cursor }),
      });
      keys.push(...page.keys);
      ({ cursor } = page);
    } while (cursor !== undefined);

    expect(keys.toSorted()).toStrictEqual([first, second]);
    const scan = redis.calls.find((call) => call.name === "scan");
    expect(scan?.args[1]).toStrictEqual({ match: "app:cache:*" });
  });

  it("keeps a prefix shorter than KV_KEY_PREFIX inside this project", async () => {
    const redis = fake();
    await client(redis).list({ prefix: "ap" });
    expect(onlyCall(redis, "scan")).toStrictEqual(["0", { match: "app:*" }]);
  });

  it("answers a prefix outside KV_KEY_PREFIX with no keys and no request", async () => {
    const redis = fake();
    const page = await client(redis).list({ prefix: "other:" });
    expect(page).toStrictEqual({ complete: true, keys: [] });
    expect(redis.calls).toStrictEqual([]);
  });

  it("escapes glob characters in the prefix and in KV_KEY_PREFIX", async () => {
    const redis = fake();
    const env = { ...ENV, KV_KEY_PREFIX: "a[1]:" };
    const store = client(redis, env);

    await store.set("a[1]:cache:*raw", "mine");
    await store.set("a[1]:cacheX:other", "theirs");

    const page = await store.list({ prefix: "a[1]:cache:*" });
    // Without the escape, `[1]` is a character class and `*` matches anything, so both
    // keys would come back.
    expect(page.keys).toStrictEqual(["a[1]:cache:*raw"]);
    expect(onlyCall(redis, "scan")[1]).toStrictEqual({
      match: String.raw`a\[1\]:cache:\**`,
    });
  });

  it("passes the caller's limit through as SCAN's COUNT", async () => {
    const redis = fake();
    await client(redis).list({ limit: 250, prefix: "app:x:" });
    expect(onlyCall(redis, "scan")).toStrictEqual([
      "0",
      { count: 250, match: "app:x:*" },
    ]);
  });

  it("reports remaining and resetAt on the first consume of a window", async () => {
    const redis = fake();
    const store = client(redis);
    const before = Date.now();

    const first = await store.consume({ key: "1.2.3.4", policy: "strict" });
    expect(first.success).toBeTruthy();
    expect(first.remaining).toBe(2);
    expect((first.resetAt ?? 0) > before).toBeTruthy();
  });

  it("counts a fixed window in consume down to a refusal", async () => {
    const store = client(fake());
    await store.consume({ key: "1.2.3.4", policy: "strict" });

    const second = await store.consume({ key: "1.2.3.4", policy: "strict" });
    expect(second.remaining).toBe(1);
    const third = await store.consume({ key: "1.2.3.4", policy: "strict" });
    expect(third.remaining).toBe(0);

    const fourth = await store.consume({ key: "1.2.3.4", policy: "strict" });
    // A refusal is a value, never a throw.
    expect(fourth.success).toBeFalsy();
    expect(fourth.remaining).toBe(0);
  });

  it("puts KV_KEY_PREFIX and the policy name in the bucket key", async () => {
    const redis = fake();
    const store = client(redis);

    await store.consume({ key: "1.2.3.4", policy: "strict" });
    const [, keys, args] = onlyCall(redis, "eval");
    expect(keys).toStrictEqual(["app:rl:strict:1.2.3.4"]);
    expect(args).toStrictEqual([60]);

    // A second policy over the same IP counts in its own bucket.
    await store.consume({ key: "1.2.3.4", policy: "loose" });
    expect(redis.entries.get("app:rl:strict:1.2.3.4")).toBe("1");
    expect(redis.entries.get("app:rl:loose:1.2.3.4")).toBe("1");
  });

  it("gives each key its own budget", async () => {
    const store = client(fake());
    for (let index = 0; index < 3; index += 1) {
      await store.consume({ key: "1.2.3.4", policy: "strict" });
    }
    const spent = await store.consume({ key: "1.2.3.4", policy: "strict" });
    expect(spent.success).toBeFalsy();
    const fresh = await store.consume({ key: "5.6.7.8", policy: "strict" });
    expect(fresh.success).toBeTruthy();
  });

  it("leaves the policy lookup to the core", async () => {
    const store = client(fake());
    await expect(() =>
      store.consume({ key: "k", policy: "nope" })
    ).rejects.toThrow(
      expect.toSatisfy((error: KvError) => {
        expect(error).toBeInstanceOf(KvError);
        expect(error.code).toBe("not_supported");
        return true;
      })
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

    it.each(rows)("maps $providerCode", async (row) => {
      const store = client(
        fake({
          get(): Promise<string | null> {
            return Promise.reject(new Error(row.message));
          },
        })
      );

      await expect(() => store.get("app:k")).rejects.toThrow(
        expect.toSatisfy((error: KvError) => {
          expect(error).toBeInstanceOf(KvError);
          expect(error.code).toBe(row.code);
          expect(error.providerCode).toBe(row.providerCode);
          expect(error.retryable).toBe(row.retryable);
          return true;
        })
      );
    });

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

      await expect(() => store.set("app:big", "x")).rejects.toThrow(
        expect.toSatisfy((error: KvError) => {
          expect(error).toBeInstanceOf(KvError);
          expect(error.code).toBe("too_large");
          return true;
        })
      );
    });

    const transport: { error: Error; providerCode: string | undefined }[] = [
      {
        error: Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(
            new Error("getaddrinfo ENOTFOUND x.upstash.io"),
            {
              code: "ENOTFOUND",
            }
          ),
        }),
        providerCode: "ENOTFOUND",
      },
      {
        error: new TypeError("fetch failed"),
        providerCode: "TypeError",
      },
      {
        error: Object.assign(new Error("The operation timed out."), {
          name: "TimeoutError",
        }),
        providerCode: "TimeoutError",
      },
      {
        error: Object.assign(new Error("This operation was aborted"), {
          name: "AbortError",
        }),
        providerCode: "AbortError",
      },
      { error: new Error("socket hang up"), providerCode: undefined },
      {
        error: new Error(
          "internal error; reference = cq2s681jn930r5ntghpjcfu3"
        ),
        providerCode: undefined,
      },
    ];

    it.each(transport)(
      "maps a transport failure ($error.name: $error.message) to a retryable provider_error",
      async (row) => {
        const store = client(
          fake({
            get(): Promise<string | null> {
              return Promise.reject(row.error);
            },
          })
        );

        await expect(() => store.get("app:k")).rejects.toThrow(
          expect.toSatisfy((error: KvError) => {
            expect(error).toBeInstanceOf(KvError);
            expect(error.code).toBe("provider_error");
            expect(error.retryable).toBeTruthy();
            expect(error.providerCode).toBe(row.providerCode);
            return true;
          })
        );
      }
    );

    it("refuses a limiter reply that is not two numbers", async () => {
      const store = client(
        fake({
          eval(): Promise<unknown> {
            return Promise.resolve(["many", "soon"]);
          },
        })
      );

      await expect(() =>
        store.consume({ key: "1.2.3.4", policy: "strict" })
      ).rejects.toThrow(
        expect.toSatisfy((error: KvError) => {
          expect(error).toBeInstanceOf(KvError);
          expect(error.code).toBe("provider_error");
          expect(error.retryable).toBeFalsy();
          return true;
        })
      );
    });

    it("falls through to provider_error, not retryable, on an unknown failure", async () => {
      const store = client(
        fake({
          get(): Promise<string | null> {
            return Promise.reject(new Error("unexpected reply shape"));
          },
        })
      );

      await expect(() => store.get("app:k")).rejects.toThrow(
        expect.toSatisfy((error: KvError) => {
          expect(error).toBeInstanceOf(KvError);
          expect(error.code).toBe("provider_error");
          expect(error.retryable).toBeFalsy();
          return true;
        })
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

      await expect(() => store.get("k")).rejects.toThrow(
        expect.toSatisfy((error: KvError) => {
          expect(error).toBeInstanceOf(KvError);
          expect(error.code).toBe("provider_error");
          expect(error.message).toMatch(/KV_KEY_PREFIX/);
          return true;
        })
      );
      // Nothing left for Upstash.
      expect(redis.calls).toStrictEqual([]);
    });

    it("throws provider_error naming KV_KEY_PREFIX when it is unset", async () => {
      const store = client(fake(), { KV_PROVIDER: "upstash" });
      await expect(() => store.list({})).rejects.toThrow(
        expect.toSatisfy((error: KvError) => {
          expect(error).toBeInstanceOf(KvError);
          expect(error.message).toMatch(/KV_KEY_PREFIX/);
          return true;
        })
      );
    });

    it("does not cache a failed client build", async () => {
      const env: Record<string, unknown> = {
        KV_KEY_PREFIX: "app:",
        KV_PROVIDER: "upstash",
        UPSTASH_REDIS_REST_TOKEN: "token",
      };
      const store = defineKv({ policies: [], providers: [upstash()] }).create(
        env
      );

      await expect(() => store.get("app:k")).rejects.toThrow(
        /UPSTASH_REDIS_REST_URL/
      );
      // The same env object, now complete. A cached rejection would name the URL again;
      // a fresh build passes the secret check and fails later, on the absent package.
      env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
      await expect(() => store.get("app:k")).rejects.toThrow(
        expect.toSatisfy((error: KvError) => {
          expect(error).toBeInstanceOf(KvError);
          expect(error.message).not.toMatch(/No `UPSTASH_REDIS_REST_URL`/);
          return true;
        })
      );
    });

    it.each(["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"])(
      "throws provider_error naming %s when it is missing",
      async (name) => {
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

        await expect(() => store.get("app:k")).rejects.toThrow(
          expect.toSatisfy((error: KvError) => {
            expect(error).toBeInstanceOf(KvError);
            expect(error.code).toBe("provider_error");
            expect(error.message).toMatch(new RegExp(name));
            return true;
          })
        );
      }
    );
  });
});
