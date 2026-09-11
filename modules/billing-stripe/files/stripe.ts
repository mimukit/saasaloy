import { env } from "cloudflare:workers";
import { stripe as stripePlugin } from "@better-auth/stripe";
import Stripe from "stripe";
import { enqueueBillingEvent } from "../enqueue";
import { plans } from "../plans";
import { BillingError } from "../provider";
import type {
  BillingEnv,
  BillingEvent,
  BillingEventType,
  BillingProvider,
  ChangePlanInput,
  CheckoutInput,
  CheckoutResult,
  HostContext,
  Invoice,
  Plan,
  PortalInput,
  QuantityInput,
  SubjectInput,
  SubscriptionStatus,
} from "../provider";
import { authorizeSubject } from "../subject";

// The Stripe provider, and the only file in the project that says "Stripe".
//
// It ships two exports because Stripe reaches the project through two doors, and
// `saasaloy add billing-stripe` patches both arrays:
//
//   `stripeBilling()`    → `providers` in packages/billing/src/index.ts
//   `stripeAuthPlugin()` → `plugins`   in packages/auth/src/auth.ts
//
// The engine underneath is `@better-auth/stripe`. It owns customer creation, the checkout
// session, the portal, cancel, restore, and the signature-verified webhook that writes the
// subscription row. This file's whole job is to make that engine speak the capability's
// vocabulary: the plan table maps into the plugin's shape, the plugin's model maps onto
// `billing_subscriptions`'s vendor-blind columns, `authorizeSubject` becomes
// `authorizeReference`, a Stripe event becomes a normalized `BillingEvent`, and a Stripe
// error becomes a `BillingError` with the raw code in `providerCode`.
//
// Nothing here writes the database. The plugin's own webhook handler writes the row
// synchronously — that is the point of using it — and `onEvent` only enqueues the
// normalized event so the *side effects* (emails, the lockout clear) run on the queue,
// dedupe through `billing_events`, and never block Stripe's delivery (ADR 0034).
//
// `env` comes from `cloudflare:workers` rather than from a request, for the same reason
// `packages/auth/src/auth.ts` reads it that way: the Better Auth instance is a module-scope
// singleton, and the plugin array is patched into its literal. The contract methods take
// `BillingEnv` as usual, so `createBilling(c.env)` behaves exactly like every other
// capability.

/** The value `BILLING_PROVIDER` must hold for this provider to be selected. */
const PROVIDER_NAME = "stripe";

interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

const stripeEnv = env as unknown as StripeEnv;

let client: Stripe | undefined;

/**
 * The Stripe SDK client, built on first use and kept.
 *
 * `httpClient` is Stripe's `fetch` client on purpose: the default Node client wants
 * `node:http`, which a Worker does not have. A missing key throws here, on the first call
 * that actually needs Stripe, never at import.
 */
function stripeClient(): Stripe {
  const key = stripeEnv.STRIPE_SECRET_KEY;
  if (!key) {
    throw new BillingError(
      "provider_error",
      "STRIPE_SECRET_KEY is not set. Put it in .dev.vars for local development and in `wrangler secret put STRIPE_SECRET_KEY` for a deployment."
    );
  }
  client ??= new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  return client;
}

/**
 * The client the auth plugin holds, which defers the build to the first property read.
 *
 * `stripeAuthPlugin()` is evaluated while `packages/auth/src/auth.ts` is still being
 * imported, so a client built eagerly there would demand `STRIPE_SECRET_KEY` from the whole
 * Worker — sign-in included — the moment `billing-stripe` is installed. That would take the
 * local provider away: `BILLING_PROVIDER=console` is meant to run the capability with no
 * vendor account and no network, and a contributor without a key could not even sign in.
 *
 * A `Proxy` over an empty extensible object, so the `get` trap may answer anything without
 * tripping a proxy invariant. Methods come back bound to the real client, because the
 * plugin calls them as methods. Symbols are runtime and tooling probes (`Symbol.toStringTag`,
 * `util.inspect.custom`) and a logger inspecting this value must not be what demands a key,
 * so they answer off the empty target instead.
 */
const lazyStripeClient = new Proxy({} as Stripe, {
  get(target, prop) {
    if (typeof prop === "symbol") {
      return Reflect.get(target, prop) as unknown;
    }
    const value = Reflect.get(stripeClient(), prop) as unknown;
    return typeof value === "function" ? value.bind(stripeClient()) : value;
  },
});

// ---------------------------------------------------------------------------
// The plan table, mapped into the plugin's shape
// ---------------------------------------------------------------------------

/**
 * Turn `plans.ts` into what `@better-auth/stripe` wants.
 *
 * The default plan is left out: it carries no `providerIds`, nobody buys it, and the
 * plugin would reject a plan with no price. `name` is the plan **id** rather than the
 * display name, because the plugin lower-cases `name` and stores it in the `plan` column,
 * which is the value `entitlements` looks up in `plans.ts`.
 *
 * `limits` is deliberately NOT passed through. The plugin writes `limits` onto the
 * subscription row whenever a plan carries it (`onSubscriptionCreated`, in the published
 * `@better-auth/stripe` 1.7.3 `dist/index.mjs`), and `billing_subscriptions` has no such
 * column. Limits are read from `plans.ts` by `entitlements` and never need to round-trip
 * through the vendor.
 */
function stripePlans() {
  return plans
    .filter((plan) => !plan.isDefault)
    .map((plan) => ({
      name: plan.id,
      ...priceIds(plan),
      ...(plan.trialDays === undefined
        ? {}
        : { freeTrial: { days: plan.trialDays } }),
    }));
}

function priceIds(plan: Plan): {
  priceId?: string;
  annualDiscountPriceId?: string;
} {
  const ids = plan.providerIds[PROVIDER_NAME] ?? {};
  return {
    ...(ids.monthly ? { priceId: ids.monthly } : {}),
    ...(ids.yearly ? { annualDiscountPriceId: ids.yearly } : {}),
  };
}

// ---------------------------------------------------------------------------
// The auth plugin
// ---------------------------------------------------------------------------

/**
 * The `@better-auth/stripe` plugin, wired to this project's tables, plans and
 * authorization rule. Registered into `plugins` in `packages/auth/src/auth.ts`.
 *
 * It mounts `/auth/subscription/upgrade|cancel|restore|billing-portal` and, most
 * importantly, `/auth/stripe/webhook` — the URL to register in the Stripe dashboard. The
 * plugin verifies the signature there, so an unsigned or wrongly-signed POST is refused
 * before any handler of ours runs.
 *
 * `schema` is the whole reason the core's columns can be vendor-blind. Every field the
 * plugin writes is mapped onto a Drizzle property of `billingSubscriptions`, and the
 * customer link is mapped onto `users.billingCustomerId`, which `modules/billing` adds to
 * `auth`'s own table with its `drizzle-column` patch. The list below is checked against
 * the `@better-auth/stripe` 1.7.3 schema and is complete for that version; the
 * `saasaloy-billing` skill carries the same list and the instruction to re-check it on a
 * version bump.
 */
export function stripeAuthPlugin() {
  return stripePlugin({
    // No Stripe call in the signup path. The customer is created at first checkout, so a
    // project that never sells anything never touches Stripe.
    createCustomerOnSignUp: false,

    /**
     * Runs after the plugin has verified the signature and written the row. Everything
     * here is enqueue-only: a side effect run inline would hold Stripe's connection open
     * and would run again on every redelivery.
     */
    onEvent: (event: Stripe.Event) => enqueueEvent(event),

    schema: {
      subscription: {
        // Singular on purpose. `packages/auth/src/auth.ts` passes `usePlural: true`, so the
        // adapter appends an `s` and asks the schema object for `billingSubscriptions`, the
        // export key in `@db/schema/billing.ts`. Writing the plural here would make it look
        // for `billingSubscriptionss`.
        modelName: "billingSubscription",
        fields: {
          billingInterval: "billingInterval",
          cancelAt: "cancelAt",
          cancelAtPeriodEnd: "cancelAtPeriodEnd",
          canceledAt: "canceledAt",
          endedAt: "endedAt",
          periodEnd: "periodEnd",
          periodStart: "periodStart",
          plan: "plan",
          referenceId: "referenceId",
          seats: "seats",
          status: "status",
          stripeCustomerId: "providerCustomerId",
          stripeScheduleId: "providerScheduleId",
          stripeSubscriptionId: "providerSubscriptionId",
          trialEnd: "trialEnd",
          trialStart: "trialStart",
        },
      },
      user: {
        fields: { stripeCustomerId: "billingCustomerId" },
      },
    },

    // The lazy one: this call runs at import, and `BILLING_PROVIDER=console` must not need
    // a Stripe key. See `lazyStripeClient`.
    stripeClient: lazyStripeClient,
    stripeWebhookSecret: stripeEnv.STRIPE_WEBHOOK_SECRET ?? "",

    subscription: {
      /**
       * The same rule the capability's own routes enforce, in the one place the vendor's
       * endpoints can be reached directly. `@billing/subject.ts` owns it, and installing
       * `teams` replaces that file with the organization version — which is what moves
       * both this check and the routes' at once.
       */
      authorizeReference: (data: {
        user: { id: string } & Record<string, unknown>;
        referenceId: string;
        action: string;
      }) =>
        Promise.resolve(
          authorizeSubject(
            data.user,
            {
              customerType:
                data.referenceId === data.user.id ? "user" : "organization",
              referenceId: data.referenceId,
            },
            data.action === "upgrade-subscription" ? "manage" : "read"
          )
        ),
      enabled: true,
      plans: stripePlans,
    },
  });
}

// ---------------------------------------------------------------------------
// Event normalization
// ---------------------------------------------------------------------------

/** Which Stripe events this provider carries, and what each becomes. */
const EVENT_TYPES: Record<string, BillingEventType> = {
  "customer.subscription.created": "subscription.changed",
  "customer.subscription.deleted": "subscription.deleted",
  "customer.subscription.trial_will_end": "trial.ending",
  "customer.subscription.updated": "subscription.changed",
  "invoice.paid": "payment.succeeded",
  "invoice.payment_failed": "payment.failed",
};

/**
 * Stripe's subscription statuses onto the normalized set. `incomplete_expired` is the one
 * Stripe has and the capability does not: it means a first payment that never landed, so
 * it maps to `incomplete` and stays out of `LIVE_STATUSES` either way.
 */
const STATUSES: Record<string, SubscriptionStatus> = {
  active: "active",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "incomplete",
  past_due: "past_due",
  paused: "paused",
  trialing: "trialing",
  unpaid: "unpaid",
};

/**
 * Map one Stripe event and put it on the queue, or drop it.
 *
 * Dropped rather than enqueued: an event type the capability has no name for, and an event
 * whose subject cannot be resolved. The second case is a subscription created in the Stripe
 * dashboard rather than through checkout — the plugin's own handler still writes its row by
 * looking the customer up, but there is no `referenceId` in the metadata for the queued
 * side effects to address, so nothing is enqueued. The skill records that.
 */
async function enqueueEvent(event: Stripe.Event): Promise<void> {
  const type = EVENT_TYPES[event.type];
  if (!type) {
    return;
  }

  const normalized = normalize(event, type);
  if (!normalized) {
    return;
  }

  // Through the core's port, not through `@repo/queue` directly: `packages/queue` imports
  // `packages/billing` to register `billingEventJob()`, so an import back would be a cycle.
  // `apps/api/src/billing-store.ts` supplies the enqueuer at module load.
  await enqueueBillingEvent(normalized);
}

function normalize(
  event: Stripe.Event,
  type: BillingEventType
): BillingEvent | undefined {
  const occurredAt = new Date(event.created * 1000);

  if (event.type.startsWith("customer.subscription.")) {
    const stripeSubscription = event.data.object as Stripe.Subscription;
    const subject = subjectOf(stripeSubscription.metadata);
    if (!subject) {
      return undefined;
    }
    return {
      occurredAt,
      provider: PROVIDER_NAME,
      providerEventId: event.id,
      subject,
      subscription: project(stripeSubscription),
      type,
    };
  }

  // An invoice event carries no subscription state worth projecting: the plan and the
  // status live on the subscription, and Stripe sends a `customer.subscription.updated`
  // alongside whenever either moved. So this enqueues the fact and no row, and the
  // consumer's side effects (Phase 5) read the row that is already there.
  const invoice = event.data.object as Stripe.Invoice & {
    subscription_details?: { metadata?: Stripe.Metadata | null };
    parent?: { subscription_details?: { metadata?: Stripe.Metadata | null } };
  };
  const subject = subjectOf(
    invoice.parent?.subscription_details?.metadata ??
      invoice.subscription_details?.metadata
  );
  if (!subject) {
    return undefined;
  }
  return {
    occurredAt,
    provider: PROVIDER_NAME,
    providerEventId: event.id,
    subject,
    type,
  };
}

/**
 * Read the billable subject out of the metadata the plugin wrote at checkout.
 *
 * `referenceId` and `userId` are the two keys `@better-auth/stripe` sets on the
 * subscription (its `subscriptionMetadata`). It records no customer type, so the type is
 * derived the way the plugin itself defaults it: a `referenceId` equal to the user id is a
 * user, and anything else is the organization the `teams` install put there.
 */
function subjectOf(
  metadata: Stripe.Metadata | null | undefined
): BillingEvent["subject"] | undefined {
  const referenceId = metadata?.referenceId;
  if (!referenceId) {
    return undefined;
  }
  return {
    customerType: referenceId === metadata?.userId ? "user" : "organization",
    referenceId,
  };
}

/** Stripe's subscription onto the capability's projection. */
function project(
  subscription: Stripe.Subscription
): NonNullable<BillingEvent["subscription"]> {
  const item = subscription.items.data[0];

  return {
    billingInterval: item?.price.recurring?.interval ?? null,
    cancelAt: seconds(subscription.cancel_at),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: seconds(subscription.canceled_at),
    endedAt: seconds(subscription.ended_at),
    // Kept verbatim, so a status or a field Stripe adds later is still on the row even
    // though the normalized column ahead of it collapsed it.
    metadata: { rawStatus: subscription.status },
    periodEnd: seconds(item?.current_period_end),
    periodStart: seconds(item?.current_period_start),
    plan: subscription.metadata?.plan ?? planOf(item?.price.id),
    providerCustomerId: String(subscription.customer),
    providerSubscriptionId: subscription.id,
    seats: item?.quantity ?? null,
    status: STATUSES[subscription.status] ?? "incomplete",
    trialEnd: seconds(subscription.trial_end),
    trialStart: seconds(subscription.trial_start),
  };
}

/** Which of this project's plans a Stripe price id belongs to. */
function planOf(priceId: string | undefined): string {
  // Both sides reject the empty string. The scaffolded `plans.ts` ships `pro` with
  // `providerIds.stripe = { monthly: "", yearly: "" }` for the project to fill in, so a
  // plain `includes(priceId ?? "")` matches an unset id against an unfilled plan and
  // projects `pro` onto a subscription nobody bought.
  const plan = priceId
    ? plans.find((candidate) =>
        Object.values(candidate.providerIds[PROVIDER_NAME] ?? {}).some(
          (id) => id === priceId
        )
      )
    : undefined;
  if (!plan) {
    throw new BillingError(
      "not_found",
      `Stripe price ${JSON.stringify(priceId)} matches no plan in packages/billing/src/plans.ts. Fill in providerIds.stripe for the plan it belongs to.`,
      { providerCode: "unknown_price" }
    );
  }
  return plan.id;
}

/** Stripe reports every instant as epoch seconds. */
function seconds(at: number | null | undefined): Date | null {
  return at ? new Date(at * 1000) : null;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/** The slice of the Better Auth instance this file calls. Cast from `HostContext.auth`. */
interface StripeAuthApi {
  api: {
    upgradeSubscription(request: {
      body: Record<string, unknown>;
      headers: Headers;
    }): Promise<{ url?: string | null }>;
    cancelSubscription(request: {
      body: Record<string, unknown>;
      headers: Headers;
    }): Promise<{ url?: string | null }>;
    restoreSubscription(request: {
      body: Record<string, unknown>;
      headers: Headers;
    }): Promise<unknown>;
    createBillingPortal(request: {
      body: Record<string, unknown>;
      headers: Headers;
    }): Promise<{ url?: string | null }>;
  };
}

function api(ctx: HostContext): StripeAuthApi["api"] {
  const auth = ctx.auth as StripeAuthApi | undefined;
  if (!auth?.api) {
    throw new BillingError(
      "invalid_request",
      "HostContext.auth is not a Better Auth instance. The route in apps/api supplies it; a job calling a contract method has to supply one too."
    );
  }
  return auth.api;
}

/**
 * The Stripe provider. Register it with `saasaloy add billing-stripe`, which appends
 * `stripeBilling()` to the `providers` array in `packages/billing/src/index.ts` and
 * `stripeAuthPlugin()` to the `plugins` array in `packages/auth/src/auth.ts`.
 *
 * Every method calls the plugin's own endpoint rather than the SDK directly, so the
 * checkout metadata, the `authorizeReference` check and the customer reuse are the
 * plugin's and stay correct across a plugin upgrade. `listInvoices` is the exception:
 * the plugin has no invoice endpoint, so it goes to the SDK.
 *
 * `CheckoutResult.event` is never set. A real provider's state arrives through its
 * verified webhook; minting an event here would write the projection twice and race the
 * one the webhook delivers.
 */
export function stripeBilling(): BillingProvider {
  return {
    cancel: (_env: BillingEnv, ctx: HostContext, input: SubjectInput) =>
      mapErrors(async () => {
        const result = await api(ctx).cancelSubscription({
          body: {
            customerType: input.subject.customerType,
            disableRedirect: true,
            referenceId: input.subject.referenceId,
            returnUrl: "/",
          },
          headers: ctx.headers,
        });
        return { url: result.url ?? "" };
      }),

    changePlan: (_env: BillingEnv, ctx: HostContext, input: ChangePlanInput) =>
      upgrade(ctx, input),

    createCheckout: (
      _env: BillingEnv,
      ctx: HostContext,
      input: CheckoutInput
    ) => upgrade(ctx, input),

    createPortal: (_env: BillingEnv, ctx: HostContext, input: PortalInput) =>
      mapErrors(async () => {
        const result = await api(ctx).createBillingPortal({
          body: {
            customerType: input.subject.customerType,
            disableRedirect: true,
            referenceId: input.subject.referenceId,
            returnUrl: input.returnUrl,
          },
          headers: ctx.headers,
        });
        if (!result.url) {
          throw new BillingError(
            "not_found",
            "Stripe returned no portal url. The subject has no Stripe customer yet, which means it has never completed a checkout.",
            { providerCode: "no_customer" }
          );
        }
        return { url: result.url };
      }),

    listInvoices: (_env: BillingEnv, _ctx: HostContext, input: SubjectInput) =>
      mapErrors(async () => {
        const customer = input.current?.providerCustomerId;
        if (!customer) {
          return [];
        }
        const page = await stripeClient().invoices.list({
          customer,
          limit: 24,
        });
        return page.data.map(toInvoice);
      }),

    name: PROVIDER_NAME,

    restore: (_env: BillingEnv, ctx: HostContext, input: SubjectInput) =>
      mapErrors(async (): Promise<CheckoutResult | undefined> => {
        await api(ctx).restoreSubscription({
          body: {
            customerType: input.subject.customerType,
            referenceId: input.subject.referenceId,
          },
          headers: ctx.headers,
        });
        // No url and no event: the plugin applied the restore at Stripe, and the
        // `customer.subscription.updated` webhook it triggers writes the row.
        //
        // The annotation and the explicit `undefined` are both load-bearing, and the two
        // linters disagree about it. Without the annotation an async body with no return
        // infers `Promise<void>`, which the contract's `Promise<CheckoutResult | undefined>`
        // rejects; with it, TS2355 demands a return statement. So the value is written out
        // and the style rule is suppressed here rather than the type being widened.
        // oxlint-disable-next-line unicorn/no-useless-undefined
        return undefined;
      }),

    // Seats are a follow-up issue. The method ships because the contract declares it, and
    // it goes through the same endpoint an upgrade does, which is where the plugin syncs
    // the Stripe quantity.
    setQuantity: (_env: BillingEnv, ctx: HostContext, input: QuantityInput) =>
      mapErrors(async () => {
        // The plugin's upgrade endpoint is where the Stripe quantity is synced, and it
        // needs the plan the subject is already on. The caller supplies the live row.
        const plan = input.current?.plan;
        if (!plan) {
          throw new BillingError(
            "not_found",
            `No live subscription for ${input.subject.customerType} ${input.subject.referenceId}, so there are no seats to change.`,
            { providerCode: "no_subscription" }
          );
        }
        await api(ctx).upgradeSubscription({
          body: {
            customerType: input.subject.customerType,
            disableRedirect: true,
            plan,
            referenceId: input.subject.referenceId,
            seats: input.seats,
          },
          headers: ctx.headers,
        });
      }),
  };
}

/** `createCheckout` and `changePlan` are the same plugin call; only the caller differs. */
function upgrade(
  ctx: HostContext,
  input: CheckoutInput | ChangePlanInput
): Promise<CheckoutResult> {
  return mapErrors(async () => {
    const result = await api(ctx).upgradeSubscription({
      body: {
        annual: input.interval === "yearly",
        cancelUrl: input.cancelUrl,
        customerType: input.subject.customerType,
        disableRedirect: true,
        plan: input.planId,
        referenceId: input.subject.referenceId,
        successUrl: input.successUrl,
      },
      headers: ctx.headers,
    });

    if (!result.url) {
      throw new BillingError(
        "provider_error",
        "Stripe returned no checkout url. Check that the plan's providerIds.stripe price id is filled in and live in this account.",
        { providerCode: "no_checkout_url" }
      );
    }
    return { url: result.url };
  });
}

function toInvoice(invoice: Stripe.Invoice): Invoice {
  return {
    amount: invoice.total,
    createdAt: new Date(invoice.created * 1000),
    currency: invoice.currency,
    hostedUrl: invoice.hosted_invoice_url ?? null,
    id: invoice.id ?? "",
    number: invoice.number ?? null,
    pdfUrl: invoice.invoice_pdf ?? null,
    status: invoice.status ?? "unknown",
  };
}

// ---------------------------------------------------------------------------
// Error normalization
// ---------------------------------------------------------------------------

/**
 * Every vendor failure leaves this file as a `BillingError`, with Stripe's own code kept in
 * `providerCode`. That is the provider's half of the one-error-shape promise: `defineBilling`
 * would wrap a raw throw as `provider_error`, which is honest but loses the distinction a
 * caller acts on — a declined card is the user's problem, a rate limit is ours.
 *
 * `retryable` is set honestly rather than optimistically. Only a rate limit and a
 * connection failure earn it; a declined card and a bad request never succeed on a retry,
 * and the capability's consumer reads this flag to choose between another delivery and the
 * dead-letter queue.
 */
async function mapErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toBillingError(error);
  }
}

function toBillingError(error: unknown): BillingError {
  if (error instanceof BillingError) {
    return error;
  }

  const raw = error as {
    type?: string;
    code?: string;
    message?: string;
    status?: number;
    statusCode?: number;
    body?: { code?: string; message?: string };
  };
  const providerCode = raw.code ?? raw.body?.code ?? raw.type;
  const message = raw.body?.message ?? raw.message ?? "Stripe request failed";
  const options = {
    cause: error,
    ...(providerCode === undefined ? {} : { providerCode }),
  };

  switch (raw.type) {
    case "StripeCardError":
    case "card_error": {
      return new BillingError("card_declined", message, {
        ...options,
        retryable: false,
      });
    }
    case "StripeRateLimitError":
    case "rate_limit_error": {
      return new BillingError("rate_limited", message, {
        ...options,
        retryable: true,
      });
    }
    case "StripeConnectionError": {
      return new BillingError("provider_error", message, {
        ...options,
        retryable: true,
      });
    }
    case "StripeInvalidRequestError":
    case "invalid_request_error": {
      return new BillingError("invalid_request", message, {
        ...options,
        retryable: false,
      });
    }
    case "StripeSignatureVerificationError": {
      return new BillingError("webhook_invalid", message, {
        ...options,
        retryable: false,
      });
    }
    default: {
      break;
    }
  }

  // Better Auth's own `APIError`, thrown by the plugin's endpoints before Stripe is
  // reached: a plan that is not configured, a `referenceId` `authorizeReference` refused,
  // a subscription that is not there. A 4xx is the caller's mistake; a 5xx is not.
  const status = raw.status ?? raw.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return new BillingError(
      status === 404 ? "not_found" : "invalid_request",
      message,
      { ...options, retryable: false }
    );
  }

  return new BillingError("provider_error", message, {
    ...options,
    retryable: false,
  });
}
