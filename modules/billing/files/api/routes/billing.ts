import {
  BILLING_EVENT_JOB,
  BillingError,
  createBilling,
  currentSubscription,
  defaultPlan,
  findPlan,
  normalizeFields,
  normalizeReference,
  plans,
  prefillFrom,
  referenceField,
  resolveSubject,
} from "@repo/billing";
import type {
  BillableSubject,
  BillingEvent,
  HostContext,
  PaymentSubmission,
  Plan,
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
type BillingErrorStatus = 400 | 402 | 404 | 409 | 429 | 502;

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
      const plan = findPlan(plans, planId);

      const live = await currentSubscription(store, subject);
      if (live) {
        throw new BillingError(
          "invalid_request",
          `Already subscribed to "${live.plan}". Change or cancel it through the billing portal (POST /billing/portal) — a second live subscription is not supported.`
        );
      }

      const submission = await openSubmission(client, store, {
        interval,
        plan,
        subject,
      });

      const result = await client.createCheckout(host, {
        cancelUrl,
        interval,
        planId,
        subject,
        successUrl,
        ...(submission === undefined ? {} : { submissionId: submission.id }),
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
            // Both halves, because a plan priced for a gateway that is handed a figure
            // carries `price` and no `providerIds`, and the picker would otherwise offer it
            // no interval at all.
            intervals: [
              ...new Set([
                ...Object.values(candidate.providerIds).flatMap((byInterval) =>
                  Object.keys(byInterval)
                ),
                ...Object.keys(candidate.price),
              ]),
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

  // Pay for the next period, under a provider that renews manually. There is no stored
  // instrument to charge, so the subject opens a fresh checkout for the plan already on the
  // row — see CONTEXT.md → "Manual renewal".
  //
  // Three refusals, and each one prevents a payment nobody owes. A row that is not
  // `past_due` has not run out. A provider that renews at the vendor charges the card
  // itself. And a period that has not ended yet is already paid for, so paying again inside
  // it would take the subject's money for nothing.
  .post("/renew", (c) =>
    guard(c, async ({ client, host, store, subject }) => {
      const body = await readJson(c);
      const successUrl = requireUrl(c, body, "successUrl");
      const cancelUrl = requireUrl(c, body, "cancelUrl");

      if (client.renewal !== "manual") {
        throw new BillingError(
          "invalid_request",
          `${client.provider} renews at the vendor, so there is nothing to renew by hand. Update the payment method through POST /billing/portal instead.`
        );
      }

      // A locked or canceled row is not live, so those subjects never reach this route:
      // they start again through POST /billing/checkout.
      const live = await currentSubscription(store, subject);
      if (!live) {
        throw new BillingError(
          "not_found",
          "No live subscription to renew. Start one through POST /billing/checkout."
        );
      }

      if (live.status !== "past_due") {
        throw new BillingError(
          "invalid_request",
          `The subscription is "${live.status}", not "past_due", so the period it is on has not run out yet.`
        );
      }

      const endsAt = live.periodEnd ?? live.trialEnd;
      if (endsAt && endsAt.getTime() > Date.now()) {
        throw new BillingError(
          "invalid_request",
          `The current period runs until ${endsAt.toISOString()}. Renewing now would charge for a period that is already paid for.`
        );
      }

      const interval: PlanInterval =
        live.billingInterval === "year" ? "yearly" : "monthly";

      // A manual provider gets the same shell a first checkout opens, so the next period's
      // payment is quoted, submitted and reviewed through exactly one code path.
      const submission = await openSubmission(client, store, {
        interval,
        plan: findPlan(plans, live.plan),
        subject,
      });

      const result = await client.createCheckout(host, {
        cancelUrl,
        interval,
        planId: live.plan,
        subject,
        successUrl,
        ...(submission === undefined ? {} : { submissionId: submission.id }),
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
  )

  // The subject's half of the manual-settlement queue. Three routes, and none of them names
  // a payment method: the instruction text, the fields and the validation rules all come off
  // the selected provider, so a project that swaps bKash for Nagad changes an env var.
  //
  // What the subject is looking at while they pay. Carries the live shell, the instructions,
  // the field spec and the pre-fill, so the pay page needs one request.
  .get("/submission", (c) =>
    guard(c, async ({ client, store, subject }) => {
      requireManual(client);

      const fields = client.submissionFields();
      const live = await store.pendingSubmission(subject);
      const previous = await store.latestSubmission(subject);

      return c.json(
        {
          fields: fields.map((field) => ({
            help: field.help ?? null,
            id: field.id,
            label: field.label,
            reference: field.reference ?? false,
            type: field.type,
          })),
          // What the last submission ended in, so a subject whose payment was refused reads
          // the admin's reason rather than an empty form.
          last:
            previous && previous.id !== live?.id
              ? {
                  reviewNote: previous.reviewNote ?? null,
                  status: previous.status,
                  transactionRef: previous.transactionRef ?? null,
                }
              : null,
          // Only the `remembered` fields carry over. A transaction reference never does.
          prefill: prefillFrom(fields, previous),
          submission: live ? publicSubmission(live) : null,
          ...(live
            ? {
                instructions: client.manualInstructions({
                  currency: live.currency,
                  expectedAmount: live.expectedAmount,
                  interval: live.billingInterval,
                  planId: live.plan,
                  subject,
                }),
              }
            : { instructions: null }),
        },
        200
      );
    })
  )

  // The subject says they have paid, and names the transaction. Two 409s, and they are
  // different mistakes: no open checkout to attach this to, and a reference somebody has
  // already claimed. Both are `invalid_request` at the core and both render as 409 here.
  .post("/submission", (c) =>
    guard(c, async ({ client, store, subject }) => {
      requireManual(client);

      const body = await readJson(c);
      const fields = client.submissionFields();
      const reference = referenceField(client.provider, fields);

      const live = await store.pendingSubmission(subject);
      if (!live) {
        throw new BillingError(
          "invalid_request",
          "There is no open payment to submit a reference for. Start one through POST /billing/checkout, pay, then come back.",
          { providerCode: "no_open_submission" }
        );
      }
      if (live.transactionRef) {
        throw new BillingError(
          "conflict",
          `A payment is already submitted and waiting for review (reference ${live.transactionRef}). Withdraw it through DELETE /billing/submission/${live.id} before submitting another.`,
          { providerCode: "already_submitted" }
        );
      }

      // Every value goes through the provider's own `normalize`, which is where the rule for
      // a bKash TrxID or a Bangladeshi mobile number lives. A refusal names the field.
      const values = normalizeFields(fields, body);
      const ref = values[reference.id] as string;

      // Throws `duplicate_reference` when the partial unique index refuses it. The index is
      // partial on `status <> 'rejected'`, so a reference that was wrongly rejected can be
      // submitted again.
      const filled = await store.fillSubmission(live.id, {
        fields: values,
        transactionRef: ref,
        transactionRefNormalized: normalizeReference(ref),
      });

      if (!filled) {
        throw new BillingError(
          "conflict",
          "That payment was reviewed or withdrawn while you were filling the form. Reload the billing page to see where it stands.",
          { providerCode: "not_pending" }
        );
      }

      return c.json({ submission: publicSubmission(filled) }, 200);
    })
  )

  // Take a submission back before anyone reviews it. It is what lets a subject who typed the
  // wrong reference fix it: one pending submission per subject is the cap, so the withdraw
  // and the next checkout are the whole cycle.
  .delete("/submission/:id", (c) =>
    guard(c, async ({ client, store, subject }) => {
      requireManual(client);

      const id = c.req.param("id");
      const live = await store.pendingSubmission(subject);

      // Compared against the subject's own pending row rather than read by id: an id that
      // belongs to somebody else must not even be confirmed to exist.
      if (!live || live.id !== id) {
        throw new BillingError(
          "not_found",
          "No pending payment under that id for this account.",
          { providerCode: "no_pending_submission" }
        );
      }

      const withdrawn = await store.reviewSubmission(id, {
        reviewNote: null,
        reviewedAt: new Date(),
        // Nobody reviewed it. The subject withdrew it, and `reviewed_by` names admins.
        reviewedBy: null,
        status: "withdrawn",
      });

      if (!withdrawn) {
        throw new BillingError(
          "conflict",
          "That payment was reviewed a moment ago, so there is nothing left to withdraw.",
          { providerCode: "not_pending" }
        );
      }

      return c.json({ submission: publicSubmission(withdrawn) }, 200);
    })
  )

  // The provider callback surface: `POST /billing/callback/:provider/*` for a gateway's
  // server-to-server notification, and `GET` for the browser returns some gateways use.
  //
  // Outside `guard` on purpose, and the only billing route that is. A gateway's IPN carries
  // no session and no bearer token, and it arrives while nobody is signed in. That is safe
  // because nothing on the request is treated as evidence: the provider verifies every fact
  // it acts on against the vendor's own API before it mints an event (ADR 0039).
  //
  // The core reads exactly two things off the request — the `:provider` segment and the path
  // after it — and hands the whole `Request` on. It never parses the body: a gateway's
  // callback is form-encoded, and guessing an encoding here would put a vendor's wire format
  // in the vendor-blind half of the capability.
  .post("/callback/:provider/*", (c) => callback(c))
  .get("/callback/:provider/*", (c) => callback(c));

/**
 * Open the `billing_payment_submissions` shell a manual checkout runs on, or nothing.
 *
 * Nothing on three branches. A vendor-settled provider has no queue. A trial takes no money,
 * so the provider mints a `trialing` row and no reference is ever owed. And the whole thing
 * is skipped before the provider is called, so a refusal costs no row.
 *
 * The expected amount is copied off the plan **here**, at the moment the subject is quoted
 * it, and is never recomputed. A price change between a payment and its review must not make
 * the subject look like they underpaid for a figure they never saw.
 *
 * One pending submission per subject is enforced here too, and it is the same rule as one
 * live subscription per subject: a second open checkout would be a second thing an admin has
 * to reconcile against one wallet statement.
 */
async function openSubmission(
  client: ReturnType<typeof createBilling>,
  store: ReturnType<typeof createBillingStore>,
  input: { plan: Plan; interval: PlanInterval; subject: BillableSubject }
) {
  if (client.settlement !== "manual" || input.plan.trialDays) {
    return;
  }

  const open = await store.pendingSubmission(input.subject);
  if (open) {
    throw new BillingError(
      "conflict",
      `A payment for "${open.plan}" is already open and waiting. Submit its transaction reference, or withdraw it through DELETE /billing/submission/${open.id}, before starting another.`,
      { providerCode: "submission_pending" }
    );
  }

  const price = input.plan.price[input.interval];
  if (!price || price.amount <= 0) {
    throw new BillingError(
      "invalid_request",
      `Plan "${input.plan.id}" carries no ${input.interval} price. ${client.provider} settles manually, so the subject is quoted a figure rather than sent to a hosted page — set price.${input.interval} in packages/billing/src/plans.ts.`,
      { providerCode: "no_price" }
    );
  }

  return await store.openSubmission({
    billingInterval: input.interval,
    currency: price.currency,
    expectedAmount: price.amount,
    plan: input.plan.id,
    provider: client.provider,
    subject: input.subject,
  });
}

/** A refusal for the three submission routes when the selected provider settles at a vendor. */
function requireManual(client: ReturnType<typeof createBilling>): void {
  if (client.settlement !== "manual") {
    throw new BillingError(
      "not_found",
      `${client.provider} settles at the vendor, so there is no payment to submit by hand. Pay through POST /billing/checkout instead.`,
      { providerCode: "not_manual" }
    );
  }
}

/**
 * The half of a submission the subject may see.
 *
 * `reviewedBy` never crosses this line: it is an admin's user id, and the subject has no
 * business learning which member of staff read their payment. The note does cross it, which
 * is the whole reason a rejection is worth an email.
 */
function publicSubmission(submission: PaymentSubmission) {
  return {
    billingInterval: submission.billingInterval,
    createdAt: submission.createdAt,
    currency: submission.currency,
    expectedAmount: submission.expectedAmount,
    fields: submission.fields,
    id: submission.id,
    plan: submission.plan,
    reviewNote: submission.reviewNote ?? null,
    reviewedAt: submission.reviewedAt ?? null,
    status: submission.status,
    transactionRef: submission.transactionRef ?? null,
  };
}

/**
 * One provider callback, whichever method it arrived on.
 *
 * Two 404s, and they are different mistakes. A `:provider` that is not the active
 * `BILLING_PROVIDER` is a stale URL still registered in some vendor's dashboard, and
 * answering it would let a provider the project is no longer running write events. A
 * provider with no `handleCallback` has no callback surface at all.
 *
 * A `redirect` answers 303 because the browser arrives on a POST and has to continue with a
 * GET. `ignored` answers 204: the gateway has not finished deciding, so there is nothing to
 * tell the projection and nothing to apologize for.
 */
async function callback(c: BillingContext) {
  const name = c.req.param("provider");
  const client = createBilling(c.env);

  if (name !== client.provider || !client.handlesCallbacks) {
    return c.json(
      {
        error: {
          code: "not_found",
          message: `No callback surface for "${name}".`,
        },
      },
      404
    );
  }

  const marker = `/callback/${name}/`;
  const at = c.req.path.indexOf(marker);
  const path = at === -1 ? "" : c.req.path.slice(at + marker.length);

  try {
    const result = await client.handleCallback(c.req.raw, path);

    if (result.kind === "ignored") {
      return c.body(null, 204);
    }

    // The event goes on the queue before the answer goes out, on both kinds. On a redirect
    // that ordering is what makes the browser return close a lost IPN: the subject lands on
    // the success page with the row already written, or already being written.
    await enqueue(c, result.event);

    if (result.kind === "redirect") {
      return c.redirect(result.url, 303);
    }

    return c.body(null, 204);
  } catch (error) {
    if (error instanceof BillingError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        statusFor(error)
      );
    }
    throw error;
  }
}

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
    // A well-formed request that lost a race, or asked for a state it is already in. The
    // duplicate transaction reference, the second open submission and the loser of two
    // concurrent reviews all land here.
    case "conflict": {
      return 409;
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
