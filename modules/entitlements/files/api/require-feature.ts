import { auth, withAuthScope } from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";
import { resolveSubject } from "@repo/billing";
import type { SubjectUser } from "@repo/billing";
import {
  createEntitlementCache,
  hasFeature,
  limit,
} from "@repo/billing/entitlements";
import type { EntitlementCache } from "@repo/billing/entitlements";
import { withDb } from "@repo/db/client";
import type { MiddlewareHandler } from "hono";

import { createBillingStore, withBillingStore } from "../billing-store";

// The gate a paid route sits behind, and the per-request memo behind it.
//
// The middleware lives here rather than in `packages/billing` for the reason the whole
// capability is split that way: `packages/billing` has zero npm runtime dependencies, so it
// cannot name a Hono type, and the entitlement *rule* is a pure function over a plan and a
// row (`packages/billing/src/entitlements.ts`). This file is the HTTP shape of it — the
// session, the subject, the request-scoped client and the status code.
//
// 402 Payment Required is the answer, and it names the feature. A 403 says "not for you" and
// leaves a client guessing; 402 with the feature name is the one status a plan picker can
// act on without a second round trip.

/** What this middleware puts on the request. Compose it into your route's generic. */
export interface EntitlementVariables {
  user: SubjectUser;
  /** The plan resolved for this request, memoized. See `withEntitlementCache`. */
  entitlements: EntitlementCache;
}

/**
 * The cache for this request, created on first use.
 *
 * Two gated middlewares on one route therefore share one read: the second `requireFeature`
 * finds the promise the first one started. The cache dies with the request, which is
 * mandatory rather than tidy — a Workers isolate is reused across requests, so a
 * module-level cache would answer the next subject with this one's plan.
 */
export function withEntitlementCache(c: {
  get(key: "entitlements"): EntitlementCache | undefined;
  set(key: "entitlements", value: EntitlementCache): void;
}): EntitlementCache {
  const existing = c.get("entitlements");
  if (existing) {
    return existing;
  }
  const cache = createEntitlementCache();
  c.set("entitlements", cache);
  return cache;
}

/**
 * Refuse the request unless the signed-in subject's plan carries `name`.
 *
 * ```ts
 * export const exportRoute = new Hono<{
 *   Bindings: AuthDbBindings;
 *   Variables: EntitlementVariables;
 * }>().post("/export", requireFeature("export"), (c) => c.json({ ok: true }));
 * ```
 *
 * A subject with no subscription is not an error: they resolve to the default plan and are
 * refused only if that plan lacks the feature. A project with `billing` and no payment
 * provider installed therefore still runs this middleware, which is the point of
 * `entitlements` being its own module.
 */
export function requireFeature(name: string): MiddlewareHandler<{
  Bindings: AuthDbBindings;
  Variables: EntitlementVariables;
}> {
  return (c, next) =>
    withAuthScope(c, async () => {
      // Nothing below is answerable without a subject, and an anonymous caller is a 401
      // rather than a 402: they have no plan to be short of.
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session?.user) {
        return c.json(
          { error: { code: "unauthorized", message: "sign in first" } },
          401
        );
      }
      c.set("user", session.user as SubjectUser);
      const subject = resolveSubject(c);

      return withDb(c, async (db) => {
        const store = createBillingStore(db);
        const cache = withEntitlementCache(c);

        if (!(await hasFeature(store, subject, name, cache))) {
          return c.json(
            {
              error: {
                code: "feature_required",
                feature: name,
                message: `Your plan does not include "${name}". Change plan from the billing page to use it.`,
              },
            },
            402
          );
        }

        // The store goes into scope for the handler, not just for the check: a gated route
        // that enqueues billing work inline under `queue-memory` needs the same
        // request-scoped client the check just used.
        return withBillingStore(store, () => next());
      });
    });
}

/**
 * Refuse the request when the subject is already at a numeric allowance.
 *
 * `used` is a callback rather than a number because only the route knows how to count — how
 * many projects this subject has, how many seats are filled. `-1` in `plans.ts` means
 * unmetered and always passes.
 */
export function requireWithinLimit(
  name: string,
  used: (c: { get(key: "user"): SubjectUser }) => number | Promise<number>
): MiddlewareHandler<{
  Bindings: AuthDbBindings;
  Variables: EntitlementVariables;
}> {
  return (c, next) =>
    withAuthScope(c, async () => {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session?.user) {
        return c.json(
          { error: { code: "unauthorized", message: "sign in first" } },
          401
        );
      }
      c.set("user", session.user as SubjectUser);
      const subject = resolveSubject(c);

      return withDb(c, async (db) => {
        const store = createBillingStore(db);
        const cache = withEntitlementCache(c);
        const allowance = await limit(store, subject, name, cache);
        const count = await used(c);

        if (allowance !== -1 && count >= allowance) {
          return c.json(
            {
              error: {
                code: "limit_reached",
                limit: name,
                message: `Your plan allows ${allowance} ${name}. Change plan from the billing page to add more.`,
              },
            },
            402
          );
        }

        return withBillingStore(store, () => next());
      });
    });
}
