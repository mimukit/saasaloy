// Tests for the per-route limiter. It ships as `ratelimit.test.ts` beside the middleware
// when testing is on, and `pnpm test:modules` runs it in place in the saasaloy repo.
//
// Two things are faked and nothing else. `hono` is not a dependency of this repo, so the
// Hono context is a hand-built object carrying the four members the middleware actually
// reads (`env`, `req.header`, `req.routePath`, `json`) plus the `res` it writes headers
// onto. `@repo/kv` is the real core: the project's workspace, or in the saasaloy repo the
// `modules/kv` files the module layout of `pnpm test:modules` resolves it to.
//
// The providers are the real `kv-memory` one, plus two deliberately broken ones: a
// provider with no `consume` at all, and one whose `consume` throws.

import { definePolicy, KvError, kv } from "@repo/kv";
import { memory } from "@repo/kv/providers/memory";
import type { Context, MiddlewareHandler } from "hono";
import { assert, beforeEach, describe, expect, it } from "vitest";
import { rateLimit } from "./ratelimit";

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
function honoContext(
  env: Record<string, string>,
  routePath: string,
  ip: string
): Context {
  const slice = {
    env,
    req: {
      routePath,
      header: (name: string) =>
        name.toLowerCase() === "cf-connecting-ip" ? ip : undefined,
    },
    res: new Response(null, { status: 200 }),
    json: (body: unknown, status: number, headers: Record<string, string>) =>
      Response.json(body, { headers, status }),
  };
  // The middleware reads only these members; a full Hono Context is not built here.
  return slice as unknown as Context;
}

/** Run one request through the middleware; returns the response and whether the route ran. */
async function request(middleware: MiddlewareHandler, c: Context) {
  let reached = false;
  const answer = await middleware(c, () => {
    reached = true;
    return Promise.resolve();
  });
  return { reached, response: answer ?? c.res };
}

describe("rateLimit middleware", () => {
  beforeEach(() => {
    store.reset();
  });

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
    assert(last, "the loop ran no request");

    expect(statuses).toStrictEqual([
      ...Array.from({ length: 10 }, () => 200),
      429,
    ]);
    expect(last.reached, "the route must not run once refused").toBeFalsy();

    const retryAfter = last.response.headers.get("Retry-After");
    expect(retryAfter ?? "").toMatch(/^\d+$/);
    expect(
      Number(retryAfter) > 0,
      `Retry-After was ${String(retryAfter)}`
    ).toBeTruthy();

    await expect(last.response.json()).resolves.toMatchObject({
      error: { code: "rate_limited" },
    });
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

    expect(spent.response.status).toBe(429);
    expect(other.response.status, "a second route shares no bucket").toBe(200);
    expect(other.reached).toBeTruthy();
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

    expect(other.response.status).toBe(200);
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

    expect(other.response.status, "the explicit key is shared").toBe(429);
  });

  it("sends the RateLimit headers only when the provider reported a count", async () => {
    const middleware = rateLimit({ policy: "strict" });

    const { response } = await request(
      middleware,
      honoContext(MEMORY, "/search", "198.51.100.20")
    );

    expect(response.headers.get("RateLimit-Limit")).toBe("10");
    expect(response.headers.get("RateLimit-Remaining")).toBe("9");
  });

  it("throws not_supported on the first request when the provider cannot count", async () => {
    // Building the middleware touches no provider — a Worker has no env at module scope.
    const middleware = rateLimit({ policy: "strict" });

    await expect(() =>
      request(
        middleware,
        honoContext({ KV_PROVIDER: "counterless" }, "/search", "198.51.100.30")
      )
    ).rejects.toThrow(
      expect.toSatisfy((error: KvError) => {
        expect(error).toBeInstanceOf(KvError);
        expect(error.code).toBe("not_supported");
        expect(error.message).toMatch(/counterless/);
        return true;
      })
    );
  });

  it("throws not_supported for a policy nobody registered", async () => {
    const middleware = rateLimit({ policy: "nope" });

    await expect(() =>
      request(middleware, honoContext(MEMORY, "/search", "198.51.100.31"))
    ).rejects.toThrow(
      expect.toSatisfy((error) => {
        expect(error.code).toBe("not_supported");
        expect(error.message).toMatch(/nope/);
        return true;
      })
    );
  });

  it("fails open when the limiter itself errors", async () => {
    const middleware = rateLimit({ policy: "strict" });

    const { reached, response } = await request(
      middleware,
      honoContext({ KV_PROVIDER: "broken" }, "/search", "198.51.100.40")
    );

    expect(reached).toBeTruthy();
    expect(response.status).toBe(200);
  });

  it("fails closed on a route that asked for it", async () => {
    const middleware = rateLimit({ policy: "strict", onError: "deny" });

    const { reached, response } = await request(
      middleware,
      honoContext({ KV_PROVIDER: "broken" }, "/search", "198.51.100.41")
    );

    expect(reached).toBeFalsy();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("10");
  });
});
