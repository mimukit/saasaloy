import {
  BILLING_EVENT_JOB,
  BillingError,
  createBilling,
  currentSubscription,
  findPlan,
  notifyBilling,
  plans,
  rememberedChanged,
} from "@repo/billing";
import type { BillableSubject, PaymentSubmission } from "@repo/billing";
import { auth, requireAdmin, withAuthScope } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import { createQueue } from "@repo/queue";
import { Hono } from "hono";
import type { Context } from "hono";

import { createBillingStore, withBillingStore } from "../billing-store";
import type { BillingBindings } from "./billing";

// The operator's half of the manual-settlement queue, mounted at `/admin` by this module's
// second `chained-route` patch. Two routes: read the queue, and decide one submission.
//
// Route module contract: ONE chained expression under a NAMED export matching the file.
// Split it into separate `adminBilling.get(...)` statements and the exported type forgets
// the route, which empties it out of `AppType`.
//
// Both routes sit behind `requireAdmin`, on the server. `apps/admin`'s root route denies a
// non-admin in the browser and that is not the gate: it stops the SPA from asking, and this
// is what stops anyone else. Same arrangement as `apps/api/src/routes/admin-users.ts`.
//
// **This route never writes `billing_subscriptions`.** An approval enqueues a normal
// `billing.event` carrying the projection the provider minted, and `applyEvent` stays the
// single writer (ADR 0034). That is what makes a double-clicked approval cost nothing: the
// `(provider, providerEventId)` primary key on `billing_events` is the backstop behind the
// conditional update below.
//
// Nothing here verifies a payment. Under manual settlement the only witness is the admin
// reading their own statement, and the module's skill says so in its first paragraph.

/** How many submissions one queue read answers with. The queue is worked, not browsed. */
const QUEUE_LIMIT = 200;

type AdminBillingContext = Context<{ Bindings: BillingBindings }>;

/** The statuses the queue filter accepts, plus the unfiltered read. */
const STATUSES = new Set(["pending", "approved", "rejected", "withdrawn"]);

export const adminBilling = new Hono<{ Bindings: BillingBindings }>()
  // The queue. `?status=pending` is what the page opens on, because a queue is a list of
  // things nobody has decided yet.
  .get("/billing/submissions", (c) =>
    withAuthScope(c, async () => {
      await requireAdmin(c);

      const raw = c.req.query("status");
      const status = raw && STATUSES.has(raw) ? raw : undefined;

      return withDb(c, (db) => {
        const store = createBillingStore(db);
        return withBillingStore(store, async () => {
          const client = createBilling(c.env);
          const rows = await store.listSubmissions(
            status as PaymentSubmission["status"] | undefined,
            QUEUE_LIMIT
          );

          // The fields are the provider's, so the flag below is computed against the spec
          // the provider declares rather than against a column named "sender number". A
          // vendor-settled provider has no spec, and then every row reads as unchanged.
          const fields =
            client.settlement === "manual" ? client.submissionFields() : [];

          const submissions = await Promise.all(
            rows.map(async (row) => {
              // One extra read per row. The queue is capped at 200 and is worked by a
              // person, so the cost is bounded and the alternative — a window function in
              // the port — would put dialect-specific SQL in the one place that has stayed
              // dialect-neutral.
              const previous = await store.previousSubmission(
                subjectOf(row),
                row.createdAt
              );

              return {
                billingInterval: row.billingInterval,
                createdAt: row.createdAt,
                currency: row.currency,
                customerType: row.customerType,
                // What the subject was quoted at checkout. Never recomputed from `plans.ts`:
                // a price change afterwards must not make a correct payment look short.
                expectedAmount: row.expectedAmount,
                fields: row.fields,
                id: row.id,
                plan: row.plan,
                // True when a remembered value — the sender's own wallet number — differs
                // from this subject's previous submission. Advisory, and the queue's whole
                // fraud signal; paying from a spouse's or an agent's wallet is ordinary.
                rememberedChanged: rememberedChanged(fields, row, previous),
                provider: row.provider,
                referenceId: row.referenceId,
                reviewNote: row.reviewNote ?? null,
                reviewedAt: row.reviewedAt ?? null,
                reviewedBy: row.reviewedBy ?? null,
                status: row.status,
                transactionRef: row.transactionRef ?? null,
              };
            })
          );

          return c.json({ submissions }, 200);
        });
      });
    })
  )

  // One decision. Approve grants exactly one period through the event path; reject grants
  // nothing and emails the subject the note.
  .post("/billing/submissions/:id/review", (c) =>
    withAuthScope(c, async () => {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
      await requireAdmin(c);

      const id = c.req.param("id");
      const body = await readJson(c);
      const decision = body.decision;
      const note = typeof body.note === "string" ? body.note.trim() : "";

      if (decision !== "approve" && decision !== "reject") {
        throw new BillingError(
          "invalid_request",
          '"decision" is required and has to be "approve" or "reject".'
        );
      }

      return withDb(c, (db) => {
        const store = createBillingStore(db);
        return withBillingStore(store, async () => {
          try {
            const client = createBilling(c.env);
            const found = await store.submissionById(id);

            if (!found) {
              throw new BillingError(
                "not_found",
                `No payment submission with id "${id}".`
              );
            }
            if (!found.transactionRef) {
              throw new BillingError(
                "invalid_request",
                "That submission carries no transaction reference yet — the subject has not told us what they paid. There is nothing to check against a statement.",
                { providerCode: "not_submitted" }
              );
            }

            const subject = subjectOf(found);

            // Checked **before** the conditional update, so a refusal leaves the row
            // pending and the admin can reject it with a note instead. A plan that has
            // since been dropped from `plans.ts` has no features, no limits and no price,
            // and approving onto it would silently resolve the subject to the default tier.
            if (decision === "approve") {
              findPlan(plans, found.plan);
            }

            // The race guard. `status = 'pending'` is in the WHERE, so the database picks
            // the winner and the loser reads nothing back.
            const reviewed = await store.reviewSubmission(id, {
              reviewNote: note || null,
              reviewedAt: new Date(),
              reviewedBy: session?.user.id ?? null,
              status: decision === "approve" ? "approved" : "rejected",
            });

            if (!reviewed) {
              const current = await store.submissionById(id);
              throw new BillingError(
                "conflict",
                `That submission is already "${current?.status ?? "reviewed"}"${
                  current?.reviewedBy
                    ? `, reviewed by ${current.reviewedBy}`
                    : ""
                }. Reload the queue.`,
                { providerCode: "already_reviewed" }
              );
            }

            if (decision === "reject") {
              // The one review outcome worth an email: the subject cannot otherwise learn
              // why. Sent from the route rather than from a job because a rejection mints
              // no event, and the conditional update above already guarantees once-only.
              await notifySubject(store, subject, reviewed);
              return c.json({ submission: reviewed }, 200);
            }

            // The live row travels with the approval for the same reason `cancel` carries
            // it: a provider gets no database, and a renewal has to extend the row that is
            // already there rather than invent one.
            const live = await currentSubscription(store, subject);
            const event = client.approveSubmission({
              submission: reviewed,
              ...(live === undefined ? {} : { current: live }),
            });

            // Exactly one event, and the route writes no subscription row. `applyEvent` is
            // the single writer, and the submission id is the event id, so a redelivery
            // conflicts on the `billing_events` primary key and grants nothing twice.
            await createQueue(c.env).enqueue(BILLING_EVENT_JOB, event);

            return c.json({ submission: reviewed }, 200);
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
    })
  );

/** The billable subject a submission is addressed to. */
function subjectOf(submission: PaymentSubmission): BillableSubject {
  return {
    customerType: submission.customerType,
    referenceId: submission.referenceId,
  };
}

/**
 * Tell the subject their payment was refused, and why.
 *
 * A subject with no resolvable address is a skip, not a throw. The rejection has already
 * been written and is the part that matters; failing the request would leave the admin
 * looking at a row that really is rejected and an error that says it is not.
 */
async function notifySubject(
  store: ReturnType<typeof createBillingStore>,
  subject: BillableSubject,
  submission: PaymentSubmission
): Promise<void> {
  const to = await store.recipientFor(subject);
  if (!to?.email) {
    return;
  }
  await notifyBilling({ kind: "payment.rejected", subject, submission, to });
}

async function readJson(
  c: AdminBillingContext
): Promise<Record<string, unknown>> {
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

/**
 * One normalized code, one status. The same map `routes/billing.ts` carries, and it is
 * duplicated rather than shared for the reason the return type spells out: `hc` keys a
 * response type by status code, so the union has to be a literal one in each file.
 */
function statusFor(error: BillingError): 400 | 402 | 404 | 409 | 429 | 502 {
  switch (error.code) {
    case "not_found": {
      return 404;
    }
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
