// Tests for the per-route limiter. Repo-only: the descriptor ships `ratelimit.ts` and
// the policy file, never this one.
//
// Two things are faked and nothing else. `hono` is not a dependency of this repo, so the
// Hono context is a hand-built object carrying the four members the middleware actually
// reads (`env`, `req.header`, `req.routePath`, `json`) plus the `res` it writes headers
// onto. And `@repo/kv` is a bare specifier that only exists inside a scaffolded project,
// so the resolve hook below points it at the real `modules/kv` core — the same code a
// generated project gets, with no stub in between.
//
// The providers are the real `kv-memory` one, plus two deliberately broken ones: a
// provider with no `consume` at all, and one whose `consume` throws.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

const KV_CORE = new URL("../../../../kv/files/src/index.ts", import.meta.url)
  .href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "@repo/kv"
      ? nextResolve(KV_CORE, context)
      : nextResolve(specifier, context);
  },
});

// Dynamic, and after the hook: a static import is hoisted above `registerHooks`, so
// `@repo/kv` would be resolved before the mapping exists.
const { definePolicy, KvError, kv } = await import(KV_CORE);
const { memory } = await import("../../../../kv-memory/files/memory.ts");
const { rateLimit } = await import("./ratelimit.ts");

// `kv` is the module singleton a scaffolded project patches. Registering into its arrays
// is exactly what `saasaloy add kv-memory` and `saasaloy add ratelimit` do, so the
// middleware below runs against a registry assembled the same way a real one is.
const store = memory();

kv.providers.push(
  store,
  // A provider that cannot count — what `kv` looks like before any counting provider is
  // installed, or on a future store that has no limiter.
  {
    name: "counterless",
    minTtlSeconds: 0,
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ complete: true, keys: [] }),
  },
  // A provider whose limiter is broken rather than absent — the `onError` case.
  {
    name: "broken",
    minTtlSeconds: 0,
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ complete: true, keys: [] }),
    consume: () => {
      throw new KvError(
        "provider_error",
        "the limiter binding is having a day"
      );
    },
  }
);
kv.policies.push(
  definePolicy({ limit: 10, name: "strict", periodSeconds: 10 })
);

const MEMORY = { KV_PROVIDER: "memory" };

/** The slice of Hono's context the middleware reads, and the response it writes onto. */
function honoContext(env, routePath, ip) {
  return {
    env,
    req: {
      routePath,
      header: (name) =>
        name.toLowerCase() === "cf-connecting-ip" ? ip : undefined,
    },
    res: new Response(null, { status: 200 }),
    json: (body, status, headers) => Response.json(body, { headers, status }),
  };
}

/** Run one request through the middleware; returns the response and whether the route ran. */
async function request(middleware, c) {
  let reached = false;
  const answer = await middleware(c, () => {
    reached = true;
    return Promise.resolve();
  });
  return { reached, response: answer ?? c.res };
}

beforeEach(() => {
  store.reset();
});

describe("rateLimit middleware", () => {
  it("answers the eleventh strict request with 429 and a Retry-After", async () => {
    const middleware = rateLimit({ policy: "strict" });
    const statuses = [];
    let last;

    for (let i = 0; i < 11; i++) {
      last = await request(
        middleware,
        honoContext(MEMORY, "/auth/sign-in", "203.0.113.7")
      );
      statuses.push(last.response.status);
    }

    assert.deepEqual(
      statuses.slice(0, 10),
      Array.from({ length: 10 }, () => 200)
    );
    assert.equal(statuses[10], 429);
    assert.equal(last.reached, false, "the route must not run once refused");

    const retryAfter = last.response.headers.get("Retry-After");
    assert.match(retryAfter ?? "", /^\d+$/);
    assert.ok(Number(retryAfter) > 0, `Retry-After was ${String(retryAfter)}`);

    const body = await last.response.json();
    assert.equal(body.error.code, "rate_limited");
  });

  it("gives two routes on one policy their own budget", async () => {
    const middleware = rateLimit({ policy: "strict" });
    const ip = "203.0.113.8";

    for (let i = 0; i < 10; i++) {
      await request(middleware, honoContext(MEMORY, "/auth/sign-in", ip));
    }
    const spent = await request(
      middleware,
      honoContext(MEMORY, "/auth/sign-in", ip)
    );
    const other = await request(
      middleware,
      honoContext(MEMORY, "/auth/sign-up", ip)
    );

    assert.equal(spent.response.status, 429);
    assert.equal(other.response.status, 200, "a second route shares no bucket");
    assert.equal(other.reached, true);
  });

  it("counts each address separately", async () => {
    const middleware = rateLimit({ policy: "strict" });

    for (let i = 0; i < 11; i++) {
      await request(middleware, honoContext(MEMORY, "/search", "198.51.100.1"));
    }
    const other = await request(
      middleware,
      honoContext(MEMORY, "/search", "198.51.100.2")
    );

    assert.equal(other.response.status, 200);
  });

  it("lets a route override the key so two routes share one budget", async () => {
    const middleware = rateLimit({
      policy: "strict",
      key: (c) => `signin:${c.req.header("CF-Connecting-IP") ?? "unknown"}`,
    });
    const ip = "198.51.100.9";

    for (let i = 0; i < 10; i++) {
      await request(middleware, honoContext(MEMORY, "/auth/sign-in", ip));
    }
    const other = await request(
      middleware,
      honoContext(MEMORY, "/auth/sign-up", ip)
    );

    assert.equal(other.response.status, 429, "the explicit key is shared");
  });

  it("sends the RateLimit headers only when the provider reported a count", async () => {
    const middleware = rateLimit({ policy: "strict" });

    const { response } = await request(
      middleware,
      honoContext(MEMORY, "/search", "198.51.100.20")
    );

    assert.equal(response.headers.get("RateLimit-Limit"), "10");
    assert.equal(response.headers.get("RateLimit-Remaining"), "9");
  });

  it("throws not_supported on the first request when the provider cannot count", async () => {
    // Building the middleware touches no provider — a Worker has no env at module scope.
    const middleware = rateLimit({ policy: "strict" });

    await assert.rejects(
      () =>
        request(
          middleware,
          honoContext(
            { KV_PROVIDER: "counterless" },
            "/search",
            "198.51.100.30"
          )
        ),
      (error) => {
        assert.ok(error instanceof KvError);
        assert.equal(error.code, "not_supported");
        assert.match(error.message, /counterless/);
        return true;
      }
    );
  });

  it("throws not_supported for a policy nobody registered", async () => {
    const middleware = rateLimit({ policy: "nope" });

    await assert.rejects(
      () =>
        request(middleware, honoContext(MEMORY, "/search", "198.51.100.31")),
      (error) => {
        assert.equal(error.code, "not_supported");
        assert.match(error.message, /nope/);
        return true;
      }
    );
  });

  it("fails open when the limiter itself errors", async () => {
    const middleware = rateLimit({ policy: "strict" });

    const { reached, response } = await request(
      middleware,
      honoContext({ KV_PROVIDER: "broken" }, "/search", "198.51.100.40")
    );

    assert.equal(reached, true);
    assert.equal(response.status, 200);
  });

  it("fails closed on a route that asked for it", async () => {
    const middleware = rateLimit({ policy: "strict", onError: "deny" });

    const { reached, response } = await request(
      middleware,
      honoContext({ KV_PROVIDER: "broken" }, "/search", "198.51.100.41")
    );

    assert.equal(reached, false);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "10");
  });
});
