// Per-route rate limiting, built on the `kv` capability's `consume` contract and nothing
// else. No Cloudflare import appears here: swapping `kv-cloudflare` for another provider
// that can count swaps this middleware's backend with it.
//
// It is applied per route, never app-wide. `saasaloy add ratelimit` patches no `app.use`,
// so a fresh install limits nothing until a route asks for it:
//
// ```ts
// import { rateLimit } from "../middleware/ratelimit";
//
// export const session = new Hono()
//   .post("/sign-in", rateLimit({ policy: "strict" }), (c) => c.json({ ok: true }, 200));
// ```
//
// An app-wide limiter would spend one budget on every asset request and every health
// check, and the routes worth protecting are a short list a human should write out.

import { createKv, KvError } from "@repo/kv";
import type { Context, MiddlewareHandler, Next } from "hono";
import type { ConsumeResult, KvClient, Policy } from "@repo/kv";

/** Prefix on every key this middleware builds, so a limiter key cannot collide with a cache key. */
export const RATE_LIMIT_NAMESPACE = "ratelimit";

/** Which client address to count. Cloudflare sets it; there is no dev fallback worth trusting. */
export const CLIENT_IP_HEADER = "CF-Connecting-IP";

export interface RateLimitOptions {
  /** A policy registered in `packages/kv/src/policies/ratelimit.ts`, e.g. "strict". */
  policy: string;
  /**
   * What to count, instead of the default. Use it to bill a signed-in user rather than an
   * address, or to make two routes share one budget on purpose:
   * `key: (c) => `signin:${c.req.header("cf-connecting-ip") ?? "unknown"}``.
   */
  key?: (c: Context) => string;
  /**
   * What to do when the limiter itself fails — the binding errored, the provider timed
   * out. `"allow"` (the default) lets the request through, because a broken limiter
   * taking the whole API down with it is the worse outage. `"deny"` flips a route to
   * fail closed, which is what a payment or a sign-up route wants.
   *
   * A provider that cannot count at all is **not** this case: that is a missing install,
   * it throws `not_supported`, and no `onError` setting hides it.
   */
  onError?: "allow" | "deny";
}

/**
 * Spend one unit of `policy`'s budget for this request, or answer 429.
 *
 * The 429 body is api's error envelope with code `rate_limited`, and it always carries
 * `Retry-After` in whole seconds. `RateLimit-Limit` and `RateLimit-Remaining` are sent
 * only when the provider actually reported a count — Cloudflare's Rate Limiting binding
 * returns `{ success }` and nothing else, so on `kv-cloudflare` neither header is sent
 * rather than a made-up number being sent.
 *
 * The provider is resolved on the **first request through the route**, not at module
 * load: a Worker has no `env` at module scope, so there is nothing to check until a
 * request arrives.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { onError = "allow", policy: policyName } = options;

  return async function rateLimitMiddleware(c: Context, next: Next) {
    // Outside the try below on purpose. `createKv` throws a plain `Error` when
    // `KV_PROVIDER` is unset or names a provider that is not installed, and that is a
    // deploy-time misconfiguration: it should be a loud 500, not a request quietly let
    // through by the fail-open path.
    const store = createKv(c.env);
    const key = options.key?.(c) ?? defaultKey(store, policyName, c);

    let result: ConsumeResult;
    try {
      result = await store.consume({ key, policy: policyName });
    } catch (error) {
      // `not_supported` means the selected provider has no `consume`, or the policy name
      // is not registered. Both are install mistakes that every later request repeats, so
      // they are rethrown whatever `onError` says — swallowing them would ship an app
      // that looks rate limited and is not.
      if (error instanceof KvError && error.code === "not_supported") {
        throw error;
      }
      if (onError === "deny") {
        return refuse(c, store.policy(policyName).periodSeconds);
      }
      // `next` is Hono's downstream continuation, not a Node error-first callback.
      // oxlint-disable-next-line node/callback-return
      await next();
      return;
    }

    const policy = store.policy(policyName);
    if (!result.success) {
      return refuse(c, retryAfterSeconds(result, policy));
    }

    // oxlint-disable-next-line node/callback-return
    await next();

    // Set after the route answered, so the headers land on the response it built.
    if (result.remaining !== undefined) {
      c.res.headers.set("RateLimit-Limit", String(policy.limit));
      c.res.headers.set("RateLimit-Remaining", String(result.remaining));
    }
  };
}

/**
 * Policy, route pattern and client address.
 *
 * The route pattern is in the key so two routes on the same policy do not share a
 * bucket: `POST /auth/sign-in` and `POST /auth/sign-up` are both "strict" and both get
 * their own ten. It is `routePath` — the registered pattern, `/users/:id` — rather than
 * the request path, so one caller cannot mint an unlimited number of buckets by walking
 * the id.
 *
 * A missing `CF-Connecting-IP` counts as one shared "unknown" bucket rather than as an
 * unlimited pass. Locally that is every request, which is the right way round: a
 * developer sees the limiter work instead of finding out in production.
 *
 * The key goes through `store.key()`, so it carries `KV_KEY_PREFIX` and obeys the same
 * namespace rules as a cache key. A `:` is not allowed in a part, and both the route
 * pattern (`/users/:id`) and an IPv6 address hold one, so each is rewritten to `_` first.
 * That rewrite cannot merge two buckets that were distinct: it maps `:` onto a character
 * a route pattern and an address never use for anything else.
 */
function defaultKey(store: KvClient, policy: string, c: Context): string {
  const ip = c.req.header(CLIENT_IP_HEADER) ?? "unknown";
  return store.key({
    namespace: RATE_LIMIT_NAMESPACE,
    parts: [policy, safePart(c.req.routePath), safePart(ip)],
  });
}

/** A key part with the reserved separator taken out. `buildKey` refuses a raw `:`. */
function safePart(value: string): string {
  return value.replaceAll(":", "_");
}

/**
 * Whole seconds until the budget is worth asking for again. A provider that reports
 * `resetAt` gives the real answer; one that does not (Cloudflare) gets the policy's own
 * period, which is the longest a caller could have to wait. Never below 1: `Retry-After:
 * 0` reads as "retry now", which is exactly what was just refused.
 */
function retryAfterSeconds(result: ConsumeResult, policy: Policy): number {
  if (result.resetAt === undefined) {
    return policy.periodSeconds;
  }
  return Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
}

/** api's error envelope, the `rate_limited` code it already maps to 429, and `Retry-After`. */
function refuse(c: Context, seconds: number): Response {
  return c.json(
    {
      error: {
        code: "rate_limited",
        message: `Too many requests. Retry in ${String(seconds)} seconds.`,
      },
    },
    429,
    { "Retry-After": String(seconds) }
  );
}
