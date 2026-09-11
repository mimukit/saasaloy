import {
  BILLING_EVENT_JOB,
  BillingError,
  createBilling,
  currentSubscription,
  defaultPlan,
  findPlan,
  plans,
  resolveSubject,
} from "@repo/billing";
import type {
  BillableSubject,
  BillingEvent,
  HostContext,
  PlanInterval,
  SubjectUser,
} from "@repo/billing";
import { auth, withAuthScope } from "@repo/auth/server";
import type { AuthDbBindings } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import { createQueue } from "@repo/queue";
import { Hono } from "hono";
import type { Context } from "hono";

import { createBillingStore, withBillingStore } from "../billing-store";

// The seven billing endpoints, mounted at `/billing` by this module's `chained-route`
// patch. Paths here are relative to that mount, so `post("/checkout")` serves
// `POST /billing/checkout`.
//
// Route module contract: ONE chained expression under a NAMED export matching the file.
// Split it into separate `billingRoute.post(...)` statements and the exported type forgets
// the route, which empties it out of `AppType`. The name has to be an `export const`: the
// `chained-route` codemod writes `import { billingRoute } from "./routes/billing"` and
// refuses to wire a binding that resolves to a default import.
//
// Every handler goes through `guard` below, and none of them names a payment provider.
// `createBilling(c.env)` picks one from `BILLING_PROVIDER`; which key that provider reads
// is exactly what this file must not learn, which is why `env` goes in whole.
//
// Nothing here writes `billing_subscriptions`. The projection is written from the event
// path only (ADR 0034): a provider's webhook, or `billing-console`'s `CheckoutResult.event`,
// enqueues `billing.event` and the consumer applies it. That keeps one writer, one dedupe
// rule, and one code path to test.

/**
 * The bindings a billing route needs: the driver's, plus the vars `billing` and `queue`
 * declare. Open like `Bindings` in `apps/api/src/index.ts`, so `c.env` stays assignable to
 * `BillingEnv` and `QueueEnv`.
 */
export interface BillingBindings extends AuthDbBindings {
  [key: string]: unknown;
  BILLING_PROVIDER?: string;
  BILLING_LOCKOUT_DAYS?: string;
  BILLING_APP_URL?: string;
  QUEUE_PROVIDER?: string;
}

interface BillingVariables {
  user: SubjectUser;
}

type BillingContext = Context<{
  Bindings: BillingBindings;
  Variables: BillingVariables;
}>;

/** Every status a `BillingError` renders as. Never 200; see `statusFor`. */
type BillingErrorStatus = 400 | 402 | 404 | 429 | 502;

/** What `guard` hands a handler: everything it would otherwise re-derive. */
interface Scope {
  /** The vendor-blind client for this request's `BILLING_PROVIDER`. */
  client: ReturnType<typeof createBilling>;
  /** The `{ headers, auth }` pair every contract method takes. */
  host: HostContext;
  /** Who the bill is addressed to. `subject.ts` decides; this file never looks inside. */
  subject: BillableSubject;
  /** The projection port, already in scope for anything the request enqueues inline. */
  store: ReturnType<typeof createBillingStore>;
}

export const billingRoute = new Hono<{
  Bindings: BillingBindings;
  Variables: BillingVariables;
}>()
  // Start a purchase. Refuses a second live subscription rather than letting a subject
  // stack two: one live subscription per subject is the settled rule, and add-ons are a
  // later issue.
  .post("/checkout", (c) =>
    guard(c, async ({ client, host, store, subject }) => {
      const body = await readJson(c);
      const planId = requireString(body, "planId");
      const interval = requireInterval(body);
      const successUrl = requireUrl(c, body, "successUrl");
      const cancelUrl = requireUrl(c, body, "cancelUrl");

      // Throws `not_found` naming the registered ids, so a typo in the plan picker is a
      // 404 with the answer in it rather than an empty price id reaching the vendor.
      findPlan(plans, planId);

      const live = await currentSubscription(store, subject);
      if (live) {
        throw new BillingError(
          "invalid_request",
          `Already subscribed to "${live.plan}". Change or cancel it through the billing portal (POST /billing/portal) — a second live subscription is not supported.`
        );
      }

      const result = await client.createCheckout(host, {
        cancelUrl,
        interval,
        planId,
        subject,
        successUrl,
      });

      await enqueue(c, result.event);

      return c.json({ url: result.url }, 200);
    })
  )

  // Hand the subject to the vendor's own portal. Payment methods, receipts and dunning
  // pages are the vendor's job and nothing this project should re-implement.
  .post("/portal", (c) =>
    guard(c, async ({ client, host, subject }) => {
      const body = await readJson(c);
      const returnUrl = requireUrl(c, body, "returnUrl");

      const { url } = await client.createPortal(host, { returnUrl, subject });

      return c.json({ url }, 200);
    })
  )

  // The live subscription and the plan it entitles, or the default plan and `null`. This
  // is the one read the admin page opens with.
  .get("/subscription", (c) =>
    guard(c, async ({ store, subject }) => {
      const live = await currentSubscription(store, subject);
      const plan = live ? findPlan(plans, live.plan) : defaultPlan(plans);

      return c.json(
        {
          plan: {
            features: plan.features,
            id: plan.id,
            limits: plan.limits,
            name: plan.name,
          },
          // The whole plan table rides along, so the admin page's picker needs no second
          // request and no copy of `plans.ts` in the browser bundle. Price ids stay out:
          // they are the provider's business and belong nowhere near a client.
          plans: plans.map((candidate) => ({
            id: candidate.id,
            intervals: [
              ...new Set(
                Object.values(candidate.providerIds).flatMap((byInterval) =>
                  Object.keys(byInterval)
                )
              ),
            ],
            isDefault: candidate.isDefault,
            name: candidate.name,
            trialDays: candidate.trialDays ?? null,
          })),
          subscription: live
            ? {
                cancelAtPeriodEnd: live.cancelAtPeriodEnd ?? false,
                plan: live.plan,
                status: live.status,
                trialEnd: live.trialEnd ?? null,
              }
            : null,
        },
        200
      );
    })
  )

  // Cancel at period end. The row stays live until the vendor says otherwise, which is why
  // nothing here writes the table: the `subscription.changed` event does.
  .post("/cancel", (c) =>
    guard(c, async ({ client, host, store, subject }) => {
      // Read first, so a provider with no webhook of its own can mint an event against the
      // row that is actually there rather than against a guess. `stripeBilling` ignores it.
      const current = await currentSubscription(store, subject);
      const result = await client.cancel(host, {
        subject,
        ...(current === undefined ? {} : { current }),
      });
      await enqueue(c, result?.event);

      return c.json({ url: result?.url ?? null }, 200);
    })
  )

  // Undo a pending cancellation.
  .post("/restore", (c) =>
    guard(c, async ({ client, host, store, subject }) => {
      const current = await currentSubscription(store, subject);
      const result = await client.restore(host, {
        subject,
        ...(current === undefined ? {} : { current }),
      });
      await enqueue(c, result?.event);

      return c.json({ url: result?.url ?? null }, 200);
    })
  )

  // Move a live subscription to another plan. A vendor may answer with a hosted page
  // rather than applying it directly, so the response carries a url either way.
  .post("/change-plan", (c) =>
    guard(c, async ({ client, host, store, subject }) => {
      const body = await readJson(c);
      const planId = requireString(body, "planId");
      const interval = requireInterval(body);
      const successUrl = requireUrl(c, body, "successUrl");
      const cancelUrl = requireUrl(c, body, "cancelUrl");

      findPlan(plans, planId);

      // The live row travels with the change for the same reason `cancel` and `restore`
      // carry it: a provider gets no database, and a local one has to keep what the change
      // does not touch — the trial above all.
      const current = await currentSubscription(store, subject);

      const result = await client.changePlan(host, {
        cancelUrl,
        interval,
        planId,
        subject,
        successUrl,
        ...(current === undefined ? {} : { current }),
      });

      await enqueue(c, result.event);

      return c.json({ url: result.url }, 200);
    })
  )

  // Invoices come from the vendor, not from a table here. The projection holds the
  // subscription state and nothing else, so there is no second copy to fall out of step.
  .get("/invoices", (c) =>
    guard(c, async ({ client, host, store, subject }) => {
      // The vendor keys invoices by customer, and the row is where the customer id lives.
      const current = await currentSubscription(store, subject);
      const invoices = await client.listInvoices(host, {
        subject,
        ...(current === undefined ? {} : { current }),
      });

      return c.json({ invoices }, 200);
    })
  );

/**
 * The five lines every handler would otherwise repeat: the session, the subject, the
 * request-scoped store, the provider client and the `HostContext`.
 *
 * `withAuthScope` is the outer wrapper for the same reason `apps/api/src/routes/admin-users.ts`
 * uses it: `auth` is a module-scope singleton whose database client is not, and a provider
 * calls `auth.api.*` inside its own file. `withDb` then opens this request's client for the
 * projection port, and `withBillingStore` puts that port where a job handler can reach it —
 * which is what makes `queue-memory`'s inline dispatch work end to end with no network.
 *
 * A `BillingError` is turned into the api's `{ error: { code, message } }` envelope here
 * rather than left to `onError`, because a thrown `BillingError` is not an `HTTPException`
 * and would otherwise render as a bare 500 with a vendor-shaped message inside it.
 *
 * Generic in what the handler returns, and deliberately not annotated `Promise<Response>`.
 * `hc<AppType>` reads each route's response type off the chain, and widening it to
 * `Response` here would erase every body shape — the admin app would see `{}` from
 * `res.json()` on all seven routes. The union it infers instead is the honest one: the
 * handler's own answer, plus the 401 and the `BillingError` envelope below.
 */
function guard<T>(c: BillingContext, body: (scope: Scope) => Promise<T>) {
  return withAuthScope(c, async () => {
    // Throws 401 through the api's `onError` when nobody is signed in, so everything below
    // only ever runs for a session. Called through `auth.api` rather than `requireSession`
    // to stay inside the scope already open, instead of opening a second client for it.
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) {
      return c.json(
        { error: { code: "unauthorized", message: "sign in first" } },
        401
      );
    }

    // `resolveSubject` reads the principal off the request, so put it there first. It is
    // the single file `teams` replaces to bill an organization instead, and nothing below
    // learns which of the two it got.
    c.set("user", session.user as SubjectUser);
    const subject = resolveSubject(c);

    return withDb(c, (db) => {
      const store = createBillingStore(db);
      return withBillingStore(store, async () => {
        try {
          return await body({
            client: createBilling(c.env),
            host: { auth, headers: c.req.raw.headers },
            store,
            subject,
          });
        } catch (error) {
          if (error instanceof BillingError) {
            return c.json(
              { error: { code: error.code, message: error.message } },
              statusFor(error)
            );
          }
          throw error;
        }
      });
    });
  });
}

/**
 * Hand a provider-minted event to the queue.
 *
 * Only a provider with no webhook of its own sets `CheckoutResult.event` — that is
 * `billing-console`, which is how the local provider runs the whole flow with no network.
 * A real provider leaves it undefined and lets its verified webhook deliver the state, so
 * this call is a no-op on the Stripe path.
 */
function enqueue(c: BillingContext, event: BillingEvent | undefined) {
  if (!event) {
    return Promise.resolve();
  }
  return createQueue(c.env).enqueue(BILLING_EVENT_JOB, event);
}

// Both halves are the caller's mistake, so both answer 400. `null`, `[1,2]` and `"x"` are
// all valid JSON and all pass `c.req.json()`, so the shape check has to come after the
// parse — without it `requireString` reads a key off `null` and the route 500s on a body
// the client got wrong.
async function readJson(c: BillingContext): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => {
    throw new BillingError("invalid_request", "The request body is not JSON.");
  });

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BillingError(
      "invalid_request",
      "The request body has to be a JSON object."
    );
  }

  return body as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new BillingError(
      "invalid_request",
      `"${key}" is required and has to be a non-empty string.`
    );
  }
  return value;
}

/**
 * A redirect target the vendor will send a browser to, checked against this project's own
 * origin.
 *
 * Every one of these five values leaves the Worker and comes back as a browser redirect
 * from the payment provider. A non-empty string is not enough: a caller who passes their
 * own origin gets a genuine provider url that lands the visitor somewhere else, which is
 * the open-redirect shape (CWE-601). The origin comes from `BILLING_APP_URL`, the same var
 * the billing emails link to, so one setting decides where billing may send a reader.
 */
function requireUrl(
  c: BillingContext,
  body: Record<string, unknown>,
  key: string
): string {
  const value = requireString(body, key);
  const allowed = new URL(billingAppUrl(c)).origin;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BillingError(
      "invalid_request",
      `"${key}" has to be an absolute URL.`
    );
  }

  if (url.origin !== allowed) {
    throw new BillingError(
      "invalid_request",
      `"${key}" has to be on ${allowed}, the origin BILLING_APP_URL names.`
    );
  }

  return url.toString();
}

/** The project's billing page. Same default as `apps/api/src/billing-store.ts`. */
function billingAppUrl(c: BillingContext): string {
  return c.env.BILLING_APP_URL ?? "http://localhost:3001/billing";
}

function requireInterval(body: Record<string, unknown>): PlanInterval {
  const value = body.interval;
  if (value !== "monthly" && value !== "yearly") {
    throw new BillingError(
      "invalid_request",
      '"interval" is required and has to be "monthly" or "yearly".'
    );
  }
  return value;
}

/**
 * One normalized code, one status. The map is here rather than in the core because it is
 * an HTTP decision, and `packages/billing` is used by jobs that answer no request.
 *
 * `card_declined` is 402 for the same reason `requireFeature` will be in Phase 4: Payment
 * Required is the one status that says what to do about it.
 *
 * The return type is a literal union rather than `number` or `ContentfulStatusCode`, and
 * that is load-bearing. `hc` keys a response type by status code, so a widened status would
 * put 200 in the error branch and leave the admin app unable to narrow `res.status !== 200`
 * down to the success body.
 */
function statusFor(error: BillingError): BillingErrorStatus {
  switch (error.code) {
    case "not_found": {
      return 404;
    }
    case "card_declined": {
      return 402;
    }
    case "rate_limited": {
      return 429;
    }
    case "provider_error": {
      return 502;
    }
    default: {
      return 400;
    }
  }
}
