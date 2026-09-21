import { createKv } from "@repo/kv";
import type { KvClient } from "@repo/kv";
import { billingProviderEnv } from "../config";
import { findPlan } from "../define";
import { plans } from "../plans";
import { BillingError } from "../provider";
import type {
  BillableSubject,
  BillingEnv,
  BillingEvent,
  BillingProvider,
  CallbackResult,
  ChangePlanInput,
  CheckoutInput,
  CheckoutResult,
  HostContext,
  Invoice,
  Plan,
  PlanInterval,
  PortalInput,
  QuantityInput,
  SubjectInput,
  Subscription,
  SubscriptionInput,
} from "../provider";
import type { RegisteredJob } from "../jobs/event";
import type { RegisteredSchedule } from "../jobs/past-due-lockout";

// bKash Tokenized Checkout, v1.2.0-beta, as a `billing` provider. Four server calls and one
// redirect: hold a token, create a payment, send the browser to `bkashURL`, execute the
// payment when the customer comes back. Reached with `fetch` and JSON — no SDK, no npm
// dependency, and `packages/billing` gains one workspace dependency and no vendor one
// (ADR 0040, ADR 0020).
//
// THE TOKEN IS THE HARD PART, AND IT IS WHY THIS FILE OWNS A JOB. An `id_token` lives 3600
// seconds, and bKash's own documentation carries "Do not call this API more than two times
// within an hour. If you exceed this limit, the API will return an error, and you will be
// blocked for one hour" on both the grant page and the refresh page, without saying which
// endpoint it governs. So the token is minted by ONE caller on a schedule the deployment
// controls: `bkashTokenJob` runs every 15 minutes and acts only inside 20 minutes of
// expiry — one call every 45 minutes in the steady state, never two inside one hour, and
// with spare ticks to recover a failed one. Request code reads the stored record and never calls bKash for a token, except on the
// one cold-start path below. `cacheAside` is not used and cannot be: it has no stampede
// protection, and `kv-cloudflare` carries a 60-second TTL floor plus a 60-second propagation
// window, so an on-demand refresh is exactly the miss storm the limit punishes.
//
// THE BUDGET IS DEPLOYMENT-WIDE. Two environments sharing one app key share the two calls an
// hour and block each other. Nothing in this file can enforce that; the module's skill states
// it.
//
// NO AGREEMENT, SO NO MERCHANT-INITIATED CHARGE. `create-agreement` and `create-payment` in
// agreement mode both return a `bkashURL` where the customer enters a wallet number, an OTP
// and a PIN. The merchant cannot charge an agreement on its own, so an agreement buys a
// shorter second form and no recurring billing at all. This provider declares
// `renewal: "manual"`: each period is a fresh checkout, and `billing.renewal-due` marks a row
// `past_due` when its paid period runs out (ADR 0039, CONTEXT.md → "Manual renewal").
//
// NOTHING ON THE WIRE IS EVIDENCE. The browser return carries `paymentID` and `status`, and
// bKash's webhook carries an SNS-shaped body whose signature algorithm and canonical string
// are unpublished. Neither is believed. Both are read for one identifier, and every fact this
// file acts on comes off an `execute` or `payment/status` answer it fetched itself over TLS
// from a host it names. Verifying the webhook against a guessed algorithm would look like a
// guarantee and would silently drop every real notification if the guess were wrong; trusting
// it for nothing costs one API call per forged POST and grants nothing.

/** The value `BILLING_PROVIDER` must hold for this provider to be selected. */
const PROVIDER_NAME = "bkash-merchant";

/** Everything this provider mints carries this prefix, so its rows are obvious in a query. */
const PREFIX = "bkash_";

/** The two published hosts, without a trailing slash. */
const SANDBOX_URL = "https://tokenized.sandbox.bka.sh/v1.2.0-beta";
const LIVE_URL = "https://tokenized.pay.bka.sh/v1.2.0-beta";

const GRANT_PATH = "/tokenized/checkout/token/grant";
const REFRESH_PATH = "/tokenized/checkout/token/refresh";
const CREATE_PATH = "/tokenized/checkout/create";
const EXECUTE_PATH = "/tokenized/checkout/execute";
const STATUS_PATH = "/tokenized/checkout/payment/status";

/** The four credentials plus the store selection, checked together before any call. */
const CREDENTIALS = [
  "BKASH_MERCHANT_APP_KEY",
  "BKASH_MERCHANT_APP_SECRET",
  "BKASH_MERCHANT_USERNAME",
  "BKASH_MERCHANT_PASSWORD",
] as const;

/**
 * The only currency this provider takes. bKash accepts no other, and a plan priced in
 * anything else is refused at checkout naming the plan, rather than after the subject has
 * been sent to the hosted page.
 */
const CURRENCY = "BDT";

/** bKash's own word for "this call worked". Anything else is a refusal carrying a code. */
const OK_STATUS = "0000";

/** The one transaction status that means money moved. */
const COMPLETED = "Completed";

/** Mode `0011`: a one-off tokenized payment with no agreement. See the header. */
const CHECKOUT_MODE = "0011";
const INTENT = "sale";

/** bKash refuses these characters in `merchantInvoiceNumber` and in `payerReference`. */
const REFUSED_CHARACTERS = /[<>&]/g;

/** Both fields are capped at 255 characters. */
const MAX_FIELD = 255;

/** Days in each interval. The same figures `billing-console` and `billing-sslcommerz` use. */
const INTERVAL_DAYS: Record<PlanInterval, number> = {
  monthly: 30,
  yearly: 365,
};

/** How often the token job ticks, and how close to expiry it acts. */
const BKASH_TOKEN_CRON = "*/15 * * * *";
const REFRESH_WINDOW_MS = 20 * 60 * 1000;

/**
 * How long a cold-start grant marker lives.
 *
 * Above `kv-cloudflare`'s 60-second TTL floor, and long enough to cover that store's
 * propagation window plus the grant call itself. A marker that outlived a failed grant by too
 * much would leave checkout refusing until the next tick picked the token up, which is the 15
 * minutes this is traded against.
 */
const GRANT_MARKER_TTL_SECONDS = 300;

/** Seconds of headroom before a stored token is treated as unusable by request code. */
const TOKEN_SKEW_SECONDS = 60;

/** The job's name, the schedule's name, and the store keys, all spelled once. */
export const BKASH_TOKEN_JOB = "billing.bkash-merchant.token";
export const BKASH_TOKEN_SCHEDULE = "billing.bkash-merchant.token.quarter-hour";
const TOKEN_KEY = ["bkash-merchant", "token"];
const GRANT_MARKER_KEY = ["bkash-merchant", "token", "granting"];

/** What is held in `kv` between requests. Nothing here is a secret the subject may see. */
interface TokenRecord {
  idToken: string;
  refreshToken: string;
  /** Unix milliseconds. */
  expiresAt: number;
  /** Unix milliseconds, for an operator reading the record during a block. */
  refreshedAt: number;
}

/** A token answer, in the fields this file reads. */
interface TokenResponse {
  statusCode?: string;
  statusMessage?: string;
  msg?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
}

/** A create answer. `bkashURL` is where the browser goes. */
interface CreateResponse {
  statusCode?: string;
  statusMessage?: string;
  paymentID?: string;
  bkashURL?: string;
}

/**
 * An `execute` or `payment/status` answer, in the fields this file judges on.
 *
 * `payerReference` and `merchantInvoiceNumber` are echoed back, which is what lets a callback
 * be read with no lookup table and no pending-checkout row. They are believed here because
 * the answer they arrive on came from a call this file made, never from the POST that
 * arrived.
 */
interface PaymentResponse {
  statusCode?: string;
  statusMessage?: string;
  paymentID?: string;
  trxID?: string;
  transactionStatus?: string;
  amount?: string;
  currency?: string;
  payerReference?: string;
  merchantInvoiceNumber?: string;
  customerMsisdn?: string;
  paymentExecuteTime?: string;
}

/** What a settled payment turned out to be about. Read off bKash's answer, never off a POST. */
interface CheckoutIntent {
  subject: BillableSubject;
  plan: Plan;
  interval: PlanInterval;
  /** Days carried over from a period the subject had already paid for. See `changePlan`. */
  carriedDays: number;
}

/** What one token-job tick did, for the caller's log and for the tests. */
export type TokenAction =
  /** No credentials here. The provider is installed but not configured or not selected. */
  | "skipped"
  /** The stored token is good for more than 20 minutes. */
  | "none"
  | "refreshed"
  | "granted";

/**
 * How this provider reaches its KV store.
 *
 * The default is `createKv(env)` and that is what the registration in
 * `packages/billing/src/index.ts` gets. The seam exists so the token paths can be driven
 * against a stub store: `createKv` selects on `KV_PROVIDER` and would need a real store
 * registered to answer at all, and a token schedule is not something to test by sleeping
 * through it.
 */
export interface BkashDeps {
  store?: (env: BillingEnv) => KvClient;
}

export function bkashMerchantBilling(deps: BkashDeps = {}): BillingProvider {
  const open = deps.store ?? createKv;

  return {
    cancel(
      env: BillingEnv,
      _ctx: HostContext,
      input: SubjectInput
    ): Promise<CheckoutResult | undefined> {
      assertConfigured(env);
      // There is no subscription at bKash to tell, so the event is minted from the row the
      // route read — the arrangement `billing-console` and `billing-sslcommerz` use.
      const current = carried(input);
      return Promise.resolve({
        event: event("subscription.changed", input.subject, {
          ...current,
          cancelAt: current.periodEnd ?? null,
          cancelAtPeriodEnd: true,
        }),
        url: "",
      });
    },

    async changePlan(
      env: BillingEnv,
      ctx: HostContext,
      input: ChangePlanInput
    ): Promise<CheckoutResult> {
      // Full price for the new plan, and the days left on the old period are added to the new
      // one. bKash has no proration primitive and the core has no credit concept, so this is
      // the cheapest answer that takes nothing from the subject.
      return await openCheckout(
        env,
        ctx,
        input,
        open,
        daysLeft(input.current, new Date())
      );
    },

    async createCheckout(
      env: BillingEnv,
      ctx: HostContext,
      input: CheckoutInput
    ): Promise<CheckoutResult> {
      return await openCheckout(env, ctx, input, open, 0);
    },

    // No vendor portal exists, so the caller goes straight back where it came from. A
    // fabricated url would send a browser somewhere that is not there.
    createPortal(
      env: BillingEnv,
      _ctx: HostContext,
      input: PortalInput
    ): Promise<{ url: string }> {
      assertConfigured(env);
      return Promise.resolve({ url: input.returnUrl });
    },

    /**
     * One callback, on either of the two URLs this provider registers.
     *
     * `return` is the subject's own browser coming back from the hosted page. It owes a place
     * to land, and — on `status=success` — it is also what settles the payment, because it is
     * the only arrival bKash guarantees. `webhook` is the SNS-shaped notification a merchant
     * hands its listener URL to bKash support for; it owes an event and no redirect.
     *
     * Both converge on the same `trxID`, which is the `billing_events` primary key, so
     * whichever lands second runs no side effect twice.
     */
    async handleCallback(
      env: BillingEnv,
      request: Request,
      path: string
    ): Promise<CallbackResult> {
      assertConfigured(env);
      const route = path.replaceAll(/^\/+|\/+$/g, "");

      if (route === "return") {
        return await handleReturn(env, request, open);
      }
      if (route === "webhook") {
        return await handleWebhook(env, request, open);
      }
      return { kind: "ignored" };
    },

    // bKash issues no invoice list. An empty list rather than a throw: the admin page's
    // invoice section renders empty, which is the honest answer.
    listInvoices(): Promise<Invoice[]> {
      return Promise.resolve([]);
    },

    name: PROVIDER_NAME,

    /**
     * Nothing recurs on its own here, and no agreement would change that. `billing.renewal-due`
     * marks a row `past_due` when its period ends, and the subject pays for the next one
     * through `POST /billing/renew`.
     */
    renewal: "manual",

    restore(
      env: BillingEnv,
      _ctx: HostContext,
      input: SubjectInput
    ): Promise<CheckoutResult | undefined> {
      assertConfigured(env);
      return Promise.resolve({
        event: event("subscription.changed", input.subject, {
          ...carried(input),
          cancelAt: null,
          cancelAtPeriodEnd: false,
        }),
        url: "",
      });
    },

    setQuantity(
      env: BillingEnv,
      _ctx: HostContext,
      input: QuantityInput
    ): Promise<void> {
      assertConfigured(env);
      if (input.seats < 1) {
        throw new BillingError(
          "invalid_request",
          `A subscription needs at least one seat; got ${input.seats}.`,
          { providerCode: "invalid_seats" }
        );
      }
      // Seats are a follow-up issue everywhere, and nothing reads the column yet.
      return Promise.resolve();
    },
  };
}

// --- the token, and the job that holds it ------------------------------------------------

/**
 * One tick of the token job.
 *
 * `now` and the store are parameters rather than a `new Date()` and a `createKv` inside, so a
 * test can drive the clock across the 20-minute boundary instead of sleeping through it.
 *
 * The order is deliberate. A refresh is tried first whenever there is a refresh token,
 * because bKash's own documentation contradicts itself about how long one lives and a refresh
 * that still works is the cheaper call. A refused refresh falls through to a grant, which
 * spends the second of the hour's two calls and is why the job leaves three spare ticks.
 */
export async function runBkashToken(
  store: KvClient,
  env: BillingEnv,
  now: Date
): Promise<TokenAction> {
  if (!configured(env)) {
    // Installed but not configured, or installed beside another selected provider. One KV
    // read per tick is the whole cost, and throwing here would dead-letter a message on every
    // tick of a project that simply is not using bKash.
    return "skipped";
  }

  const key = tokenKey(store);
  const record = await store.get<TokenRecord>(key);

  if (record && record.expiresAt - now.getTime() > REFRESH_WINDOW_MS) {
    return "none";
  }

  if (record?.refreshToken) {
    const refreshed = await callToken(env, REFRESH_PATH, {
      app_key: required(env, "BKASH_MERCHANT_APP_KEY"),
      app_secret: required(env, "BKASH_MERCHANT_APP_SECRET"),
      refresh_token: record.refreshToken,
    });

    if (refreshed) {
      await store.set(key, toRecord(refreshed, now));
      return "refreshed";
    }
  }

  const granted = await callToken(env, GRANT_PATH, {
    app_key: required(env, "BKASH_MERCHANT_APP_KEY"),
    app_secret: required(env, "BKASH_MERCHANT_APP_SECRET"),
  });

  if (!granted) {
    // Thrown, and deliberately not retryable. A retry would spend another of the hour's two
    // calls on the same refusal; the next tick is 15 minutes away and there are three of them
    // before the stored token is unusable. The message dead-letters, which is where an
    // operator should be reading it from.
    throw new BillingError(
      "provider_error",
      "bkash-merchant refused to grant a token. Check the four BKASH_MERCHANT_* credentials, and see the module skill for what a rate-limit block looks like.",
      { providerCode: "token_refused", retryable: false }
    );
  }

  await store.set(key, toRecord(granted, now));
  return "granted";
}

/**
 * The job, as the `jobs` table registers it. A factory returning a job, not a bare constant,
 * for the reason `../jobs/event.ts` records: the table registers a *call*, which is what the
 * `plugin-array` patch appends and `saasaloy remove` takes back out.
 *
 * This is where the provider env port earns its keep. A handler is called as
 * `(payload, ctx)` and gets no `env` (`packages/queue/src/provider.ts`), so the credentials
 * and `KV_PROVIDER` come through `billingProviderEnv()` (ADR 0040).
 */
export const bkashTokenJob = (deps: BkashDeps = {}): RegisteredJob => ({
  durable: false,
  name: BKASH_TOKEN_JOB,
  parse: (payload: unknown) => Promise.resolve(payload),
  run: async () => {
    const env = billingProviderEnv();
    const open = deps.store ?? createKv;
    await runBkashToken(open(env), env, new Date());
  },
});

/** The quarter-hour tick, as the `schedules` table registers it. */
export const bkashTokenSchedule = (): RegisteredSchedule => ({
  cron: BKASH_TOKEN_CRON,
  job: BKASH_TOKEN_JOB,
  name: BKASH_TOKEN_SCHEDULE,
  payload: {},
});

/**
 * The token a request should use.
 *
 * The steady state is one KV read. The cold-start branch below is the only place request code
 * calls bKash for a token, and it exists so a fresh deploy does not refuse every checkout for
 * up to 15 minutes while it waits for the first tick.
 *
 * The marker is written **before** the grant, not after. Two concurrent cold-start requests
 * would otherwise both see no token and both grant, which is the whole hour's budget spent on
 * one deploy. The second one fails `retryable`, and the caller tries again once the first has
 * stored a token.
 */
async function currentToken(env: BillingEnv, store: KvClient): Promise<string> {
  const key = tokenKey(store);
  const record = await store.get<TokenRecord>(key);
  const usableUntil = Date.now() + TOKEN_SKEW_SECONDS * 1000;

  if (record && record.expiresAt > usableUntil) {
    return record.idToken;
  }

  const marker = store.key({ namespace: "billing", parts: GRANT_MARKER_KEY });
  if (await store.get<number>(marker)) {
    throw new BillingError(
      "provider_error",
      "bkash-merchant is minting its first token. Try again in a moment.",
      { providerCode: "token_pending", retryable: true }
    );
  }
  await store.set(marker, Date.now(), {
    ttlSeconds: GRANT_MARKER_TTL_SECONDS,
  });

  const granted = await callToken(env, GRANT_PATH, {
    app_key: required(env, "BKASH_MERCHANT_APP_KEY"),
    app_secret: required(env, "BKASH_MERCHANT_APP_SECRET"),
  });

  if (!granted) {
    throw new BillingError(
      "provider_error",
      "bkash-merchant has no usable token and the grant was refused. The scheduled token job retries every 15 minutes.",
      { providerCode: "token_refused", retryable: true }
    );
  }

  await store.set(key, toRecord(granted, new Date()));
  return granted.id_token ?? "";
}

/**
 * One token call, answering `undefined` for a refusal rather than throwing.
 *
 * A refusal is the caller's decision to make: the job falls a refused refresh through to a
 * grant, and a request fails. A transport failure still throws, because "could not ask" is
 * not "was refused".
 */
async function callToken(
  env: BillingEnv,
  path: string,
  body: Record<string, string>
): Promise<TokenResponse | undefined> {
  const answer = await postJson<TokenResponse>(env, path, body, "token", {
    password: required(env, "BKASH_MERCHANT_PASSWORD"),
    username: required(env, "BKASH_MERCHANT_USERNAME"),
  });

  if (answer.statusCode === OK_STATUS && answer.id_token) {
    return answer;
  }
  return undefined;
}

function toRecord(answer: TokenResponse, now: Date): TokenRecord {
  // bKash reports `expires_in` in seconds and has answered it as both a number and a string.
  // An unreadable one falls back to the documented 3600, which the job's 20-minute window
  // then re-checks four times before it could matter.
  const seconds = Number(answer.expires_in);
  const life = Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;

  return {
    expiresAt: now.getTime() + life * 1000,
    idToken: answer.id_token ?? "",
    refreshedAt: now.getTime(),
    refreshToken: answer.refresh_token ?? "",
  };
}

function tokenKey(store: KvClient): string {
  return store.key({ namespace: "billing", parts: TOKEN_KEY });
}

// --- checkout ----------------------------------------------------------------------------

/**
 * Create one hosted payment, or mint a trial and call no gateway at all.
 *
 * Shared by `createCheckout` and `changePlan`, which differ only in the days they carry over
 * from a period the subject has already paid for.
 */
async function openCheckout(
  env: BillingEnv,
  ctx: HostContext,
  input: CheckoutInput | ChangePlanInput,
  open: (env: BillingEnv) => KvClient,
  carriedDays: number
): Promise<CheckoutResult> {
  assertConfigured(env);
  const plan = findPlan(plans, input.planId);
  const now = new Date();

  // A trial takes no money, and a gateway that only knows how to take money has nothing to do
  // with one. The row is minted here and delivered through the event, exactly as
  // `billing-console` does it, so a project can run a trial with no merchant account at all.
  if (plan.trialDays) {
    return {
      event: event(
        "subscription.changed",
        input.subject,
        trialing(plan, input.interval, now, input.subject)
      ),
      url: input.successUrl,
    };
  }

  const price = priceFor(plan, input.interval);
  const token = await currentToken(env, open(env));

  const answer = await postJson<CreateResponse>(
    env,
    CREATE_PATH,
    {
      amount: major(price.amount),
      callbackURL: `${callbackBase(ctx)}/billing/callback/${PROVIDER_NAME}/return`,
      currency: CURRENCY,
      intent: INTENT,
      merchantInvoiceNumber: invoiceNumber(
        plan.id,
        input.interval,
        carriedDays
      ),
      mode: CHECKOUT_MODE,
      payerReference: payerReference(input.subject),
    },
    "create",
    authHeaders(env, token)
  );

  const page = answer.bkashURL?.trim();
  if (answer.statusCode !== OK_STATUS || !page) {
    throw failure(
      answer.statusCode,
      `bkash-merchant refused to create a payment: ${answer.statusMessage ?? answer.statusCode ?? "no reason given"}`
    );
  }

  // No event. The money has not moved yet, and `execute` is what says it did.
  return { url: page };
}

/**
 * The browser coming back from the hosted page.
 *
 * `status=success` on the query string is a hint that `execute` is worth calling, never a
 * statement that money moved. Everything else is a place to land and nothing more.
 */
async function handleReturn(
  env: BillingEnv,
  request: Request,
  open: (env: BillingEnv) => KvClient
): Promise<CallbackResult> {
  const query = new URL(request.url).searchParams;
  const paymentId = query.get("paymentID")?.trim() ?? "";
  const status = query.get("status")?.trim().toLowerCase() ?? "";

  if (status === "cancel") {
    return { kind: "redirect", url: appUrl(env, "canceled") };
  }
  if (status !== "success" || !paymentId) {
    return { kind: "redirect", url: appUrl(env, "failed") };
  }

  const settled = await settle(env, open(env), paymentId);
  const minted = eventFor(settled);

  return {
    kind: "redirect",
    url: appUrl(env, minted?.type === "payment.succeeded" ? "paid" : "failed"),
    ...(minted === undefined ? {} : { event: minted }),
  };
}

/**
 * The notification bKash's own infrastructure posts, treated as a bare hint.
 *
 * The body carries `Signature`, `SignatureVersion` and `SigningCertURL`, and bKash publishes
 * neither the canonical string nor the algorithm. So nothing here verifies it and nothing
 * here believes it: one identifier is read off the body, and the event is minted from a
 * `payment/status` call this file makes. A forged POST costs one API call and grants nothing.
 *
 * A `SubscriptionConfirmation` is the SNS handshake. `SubscribeURL` is fetched only when its
 * host is a bKash domain, so the endpoint cannot be turned into a request forwarder.
 */
async function handleWebhook(
  env: BillingEnv,
  request: Request,
  open: (env: BillingEnv) => KvClient
): Promise<CallbackResult> {
  const body = await readJsonBody(request);
  if (!body) {
    return { kind: "ignored" };
  }

  if (body.Type === "SubscriptionConfirmation") {
    await confirmSubscription(body.SubscribeURL);
    return { kind: "ignored" };
  }

  const paymentId = notifiedPaymentId(body);
  if (!paymentId) {
    return { kind: "ignored" };
  }

  const answer = await postJson<PaymentResponse>(
    env,
    STATUS_PATH,
    { paymentID: paymentId },
    "status",
    authHeaders(env, await currentToken(env, open(env)))
  );

  // A notification naming a payment bKash does not recognise is a forgery or a stale replay.
  // Neither is an error worth dead-lettering a message over.
  if (answer.statusCode !== OK_STATUS) {
    return { kind: "ignored" };
  }

  const minted = eventFor(answer);
  return minted ? { event: minted, kind: "event" } : { kind: "ignored" };
}

/**
 * What a payment is worth, from the strongest source that will answer.
 *
 * `execute` first, because it is the call that settles an authorized payment. It falls through
 * to `payment/status` on `2062` — bKash has settled this already, which a second browser
 * return or a return racing the webhook produces — and on any answer this file does not
 * recognise. Not being able to reach bKash throws rather than settling anything: an `execute`
 * that timed out says nothing about whether the payment went through, and mapping it to a
 * failure would fail a charge that had already been taken.
 */
async function settle(
  env: BillingEnv,
  store: KvClient,
  paymentId: string
): Promise<PaymentResponse> {
  const headers = authHeaders(env, await currentToken(env, store));
  const executed = await postJson<PaymentResponse>(
    env,
    EXECUTE_PATH,
    { paymentID: paymentId },
    "execute",
    headers
  );

  const code = executed.statusCode?.trim() ?? "";

  // A code this file understands is the answer. Everything else goes to `payment/status`,
  // which reports what bKash actually holds for this `paymentID` rather than what one call was
  // able to say about it. `2062` — "payment already completed" — is the expected member of
  // that set, not the surprising one.
  if (code === OK_STATUS || code === CANCELLED || isDeclined(code)) {
    return executed;
  }

  return await postJson<PaymentResponse>(
    env,
    STATUS_PATH,
    { paymentID: paymentId },
    "status",
    headers
  );
}

/**
 * The event a settled answer is worth, or nothing.
 *
 * A completed payment that describes the plan it claims to is a payment. One that does not is
 * a `provider_error` and never a silent accept, because an underpayment quietly accepted is
 * how a subscription is bought at the wrong price. A declined code is a failed payment. A
 * cancelled one is nothing at all. Anything else throws rather than failing a charge on a word
 * nobody has read.
 */
function eventFor(body: PaymentResponse): BillingEvent | undefined {
  const code = body.statusCode?.trim() ?? "";
  const trxId = body.trxID?.trim() ?? "";

  if (code === OK_STATUS && body.transactionStatus?.trim() === COMPLETED) {
    const intent = intentOf(body);
    const mismatch = mismatchIn(body, intent);
    if (mismatch) {
      throw new BillingError(
        "provider_error",
        `bkash-merchant reported a completed payment but ${mismatch}`,
        { providerCode: "mismatch", retryable: false }
      );
    }

    if (!trxId) {
      throw new BillingError(
        "provider_error",
        "bkash-merchant reported a completed payment with no trxID, which is what dedupes it.",
        { providerCode: "no_trx_id", retryable: false }
      );
    }

    const now = new Date();
    return {
      occurredAt: now,
      provider: PROVIDER_NAME,
      // bKash's own transaction id. Half the `billing_events` key, which is what makes the
      // webhook and the browser return converge on one side effect.
      providerEventId: trxId,
      subject: intent.subject,
      subscription: paid(body, intent, now),
      type: "payment.succeeded",
    };
  }

  if (code === CANCELLED) {
    // The subject backed out on bKash's own page. Nothing was charged and nothing is owed.
    return undefined;
  }

  if (isDeclined(code)) {
    // No projected row: no money moved, so there is no subscription state to write. The core
    // reads the subject's current row for the dunning email, and a first checkout that fails
    // simply has none.
    //
    // A refusal that echoes no `payerReference` is minted as nothing rather than thrown.
    // bKash omits the echo on some refusals, and there is no state to report for a payment
    // that took no money from a subject this answer cannot name.
    const [customerType, referenceId] = split(body.payerReference);
    if (!customerType || !referenceId) {
      return undefined;
    }

    return {
      occurredAt: new Date(),
      provider: PROVIDER_NAME,
      providerEventId: trxId || `${PREFIX}failed_${body.paymentID ?? ""}`,
      subject: { customerType, referenceId },
      type: "payment.failed",
    };
  }

  if (code === OK_STATUS) {
    // Authorized, initiated, or anything else bKash has not finished deciding on. Nothing is
    // written, and the webhook or a later return asks again.
    return undefined;
  }

  throw failure(
    code,
    `bkash-merchant answered a status this provider does not recognise: ${code || "(none)"}`
  );
}

// --- the bKash status codes this file maps -----------------------------------------------

/** The subject cancelled on bKash's own page. Not a failure, and nothing is minted. */
const CANCELLED = "2069";

/**
 * Every code that means the instrument refused the payment. Insufficient balance, the PIN
 * failures and the OTP failures, from bKash's published table.
 *
 * Kept apart from the unknown case on purpose: a code this file does not recognise is a gap in
 * this list, not a failed payment, and mapping it to one would fail a charge nobody has read.
 */
const DECLINED_CODES = new Set([
  "2023",
  "2011",
  "2014",
  "2015",
  "2010",
  "2018",
  "2059",
]);

/** A credential bKash refused, as opposed to one this project never set. */
const INVALID_CREDENTIAL_CODES = new Set(["2001", "2002", "2003"]);

/** bKash is down or is blocking this app key. Worth another go, later. */
const RETRYABLE_CODES = new Set(["503", "2056", "2074"]);

function isDeclined(code: string | undefined): boolean {
  return DECLINED_CODES.has(code?.trim() ?? "");
}

/**
 * One bKash code as a `BillingError`, with the raw code kept in `providerCode` either way.
 *
 * A refusal this file understands is mapped honestly. Anything else is `provider_error` and
 * **not** retryable: repeating a call bKash answered with a code nobody has read is how a
 * second payment gets taken.
 */
function failure(code: string | undefined, message: string): BillingError {
  const raw = code?.trim() ?? "";

  if (DECLINED_CODES.has(raw)) {
    return new BillingError("card_declined", message, {
      providerCode: raw,
      retryable: false,
    });
  }
  if (INVALID_CREDENTIAL_CODES.has(raw)) {
    return new BillingError(
      "invalid_request",
      `${message}. Check BKASH_MERCHANT_APP_KEY and BKASH_MERCHANT_APP_SECRET, and that they belong to the ${raw === "2001" ? "environment BKASH_MERCHANT_MODE names" : "merchant account you signed up"}.`,
      { providerCode: raw, retryable: false }
    );
  }
  if (RETRYABLE_CODES.has(raw)) {
    return new BillingError("provider_error", message, {
      providerCode: raw,
      retryable: true,
    });
  }
  return new BillingError("provider_error", message, {
    providerCode: raw || "no_status",
    retryable: false,
  });
}

// --- the projection ----------------------------------------------------------------------

/**
 * What the payment was created for, read back off bKash's own answer.
 *
 * `payerReference` and `merchantInvoiceNumber` were written by `openCheckout` and echoed by
 * bKash. They are believed because the answer they arrive on came from a call this file made.
 */
function intentOf(body: PaymentResponse): CheckoutIntent {
  const [customerType, referenceId] = split(body.payerReference);
  const parts = (body.merchantInvoiceNumber ?? "").split(":");
  const [planId, interval, days] = parts;

  if (!customerType || !referenceId || !planId) {
    throw new BillingError(
      "provider_error",
      "bkash-merchant settled a payment that carries no subject: payerReference and merchantInvoiceNumber were not the pair this provider wrote at create.",
      { providerCode: "no_subject", retryable: false }
    );
  }

  const carriedDays = Number(days);

  return {
    carriedDays:
      Number.isFinite(carriedDays) && carriedDays > 0 ? carriedDays : 0,
    interval: interval === "yearly" ? "yearly" : "monthly",
    plan: findPlan(plans, planId),
    subject: { customerType, referenceId },
  };
}

/**
 * Why a completed answer does not describe the plan it names, or nothing when it does.
 *
 * Both comparisons are strict and both are against the plan table rather than against anything
 * the caller sent. The amount is compared in **minor units**, because bKash writes `499.00`,
 * `499.0` and `499` for the same figure and `0.1 + 0.2` is what a float would make of the
 * alternative. Nothing is rounded towards agreement: a payment short by one poisha is one this
 * provider cannot explain.
 */
function mismatchIn(
  body: PaymentResponse,
  intent: CheckoutIntent
): string | null {
  const price = priceFor(intent.plan, intent.interval);

  const currency = body.currency?.trim().toUpperCase();
  if (currency !== price.currency) {
    return `it was charged in ${currency ?? "(none)"}, not ${price.currency}`;
  }

  const charged = minor(body.amount);
  if (charged !== price.amount) {
    return `it was charged ${major(charged)}, not the ${major(price.amount)} plan "${intent.plan.id}" costs per ${intent.interval === "yearly" ? "year" : "month"}`;
  }

  return null;
}

/** The row a completed payment produces. */
function paid(
  body: PaymentResponse,
  intent: CheckoutIntent,
  now: Date
): SubscriptionInput {
  return {
    billingInterval: intent.interval === "yearly" ? "year" : "month",
    cancelAtPeriodEnd: false,
    // bKash's raw answer, kept whole enough for a human to reconcile a payment by hand.
    metadata: {
      carriedDays: intent.carriedDays,
      customerMsisdn: body.customerMsisdn ?? null,
      paymentExecuteTime: body.paymentExecuteTime ?? null,
      paymentID: body.paymentID ?? null,
      rawStatus: body.statusCode ?? null,
      trxID: body.trxID ?? null,
    },
    periodEnd: addDays(
      now,
      INTERVAL_DAYS[intent.interval] + intent.carriedDays
    ),
    periodStart: now,
    plan: intent.plan.id,
    providerCustomerId: customerId(intent.subject),
    // Derived from the subject rather than random, so the second period's payment converges on
    // the row the first one created instead of stacking a history row. The column is unique,
    // which is what makes `upsertSubscription` an update here.
    providerSubscriptionId: subscriptionId(intent.subject),
    seats: 1,
    status: "active",
  };
}

/** The row a trial produces. No gateway call, and no money. */
function trialing(
  plan: Plan,
  interval: PlanInterval,
  now: Date,
  subject: BillableSubject
): SubscriptionInput {
  const trialDays = plan.trialDays ?? 0;
  return {
    billingInterval: interval === "yearly" ? "year" : "month",
    cancelAtPeriodEnd: false,
    metadata: { rawStatus: "trialing", trial: true },
    // The same instant as `trialEnd`. The renewal sweep reads `trialEnd` on a `trialing` row,
    // and keeping the two in step means a trial that ends is asked to pay once.
    periodEnd: addDays(now, trialDays),
    periodStart: now,
    plan: plan.id,
    providerCustomerId: customerId(subject),
    providerSubscriptionId: subscriptionId(subject),
    seats: 1,
    status: "trialing",
    trialEnd: addDays(now, trialDays),
    trialStart: now,
  };
}

/**
 * The row a `cancel` or a `restore` starts from — the live one the route read, minus the
 * columns the core owns.
 */
function carried(input: SubjectInput): SubscriptionInput {
  const current = input.current;
  if (!current) {
    throw new BillingError(
      "not_found",
      `No live subscription for ${input.subject.customerType} ${input.subject.referenceId}. Start one through POST /billing/checkout first.`,
      { providerCode: "no_subscription" }
    );
  }

  const {
    createdAt: _createdAt,
    customerType: _customerType,
    id: _id,
    lockedAt: _lockedAt,
    provider: _provider,
    referenceId: _referenceId,
    reminderSentAt: _reminderSentAt,
    updatedAt: _updatedAt,
    ...projected
  } = current;

  return projected;
}

/** Days still left on the row the subject is paying on, or zero. */
function daysLeft(current: Subscription | undefined, now: Date): number {
  const endsAt = current?.periodEnd ?? current?.trialEnd;
  if (!endsAt || endsAt.getTime() <= now.getTime()) {
    return 0;
  }
  return Math.floor((endsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

/** Build one normalized event from a projection this provider minted itself. */
function event(
  type: BillingEvent["type"],
  subject: BillableSubject,
  subscription: SubscriptionInput
): BillingEvent {
  return {
    occurredAt: new Date(),
    provider: PROVIDER_NAME,
    // Random, because no gateway call produced an id: these events report a decision this
    // project made, not one bKash reported, so two of them must never dedupe.
    providerEventId: `${PREFIX}evt_${crypto.randomUUID()}`,
    subject,
    subscription,
    type,
  };
}

function subscriptionId(subject: BillableSubject): string {
  return `${PREFIX}sub_${subject.customerType}_${subject.referenceId}`;
}

function customerId(subject: BillableSubject): string {
  return `${PREFIX}cus_${subject.customerType}_${subject.referenceId}`;
}

// --- the wire ----------------------------------------------------------------------------

/**
 * One request against bKash, as JSON.
 *
 * **Not being able to ask is not an answer.** Every failure here throws `provider_error` with
 * `retryable: true` rather than settling anything. A refusal bKash *meant* arrives as a 200
 * carrying a non-`0000` `statusCode`, and that is read by the caller.
 */
async function postJson<Body>(
  env: BillingEnv,
  path: string,
  body: Record<string, string>,
  what: string,
  headers: Record<string, string>
): Promise<Body> {
  let response: Response;
  try {
    response = await fetch(`${hostOf(env)}${path}`, {
      body: JSON.stringify(body),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...headers,
      },
      method: "POST",
    });
  } catch (error) {
    throw new BillingError(
      "provider_error",
      `bkash-merchant: the ${what} request did not complete`,
      { cause: error, providerCode: "unreachable", retryable: true }
    );
  }

  const payload = await response.text();

  if (!response.ok) {
    throw new BillingError(
      "provider_error",
      `bkash-merchant answered HTTP ${response.status} to the ${what} request`,
      { providerCode: `http_${response.status}`, retryable: true }
    );
  }

  try {
    return JSON.parse(payload) as Body;
  } catch (error) {
    throw new BillingError(
      "provider_error",
      `bkash-merchant answered the ${what} request with something that is not JSON`,
      { cause: error, providerCode: "unreadable", retryable: true }
    );
  }
}

/** Every call but the token calls carries these two. */
function authHeaders(env: BillingEnv, token: string): Record<string, string> {
  return {
    authorization: token,
    "x-app-key": required(env, "BKASH_MERCHANT_APP_KEY"),
  };
}

/** A notification body, or nothing when there is none to read. */
async function readJsonBody(
  request: Request
): Promise<Record<string, string> | undefined> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object"
      ? (body as Record<string, string>)
      : undefined;
  } catch {
    // An empty body, or a content type the runtime cannot parse. There is nothing to look up,
    // and a throw here would dead-letter a message no retry can fix.
    return undefined;
  }
}

/**
 * The payment this notification is about, wherever bKash put it.
 *
 * SNS wraps the real payload in `Message` as a JSON string. Either shape may carry `paymentID`
 * or `trxID`, and only `paymentID` is a key `payment/status` accepts, so that is what this
 * looks for.
 */
function notifiedPaymentId(body: Record<string, string>): string {
  const direct = body.paymentID?.trim();
  if (direct) {
    return direct;
  }

  try {
    const inner: unknown = JSON.parse(body.Message ?? "");
    if (inner && typeof inner === "object") {
      return (
        (inner as Record<string, string>).paymentID?.trim() ??
        (inner as Record<string, string>).paymentId?.trim() ??
        ""
      );
    }
  } catch {
    // Not JSON, or no `Message` at all. There is nothing to look up.
  }
  return "";
}

/** Hosts a `SubscribeURL` may point at. Anything else is not confirmed. */
const BKASH_HOSTS = /(^|\.)(bka\.sh|bkash\.com|amazonaws\.com)$/;

/**
 * The SNS handshake, and the one outbound call this endpoint makes on a caller's say-so.
 *
 * The host check is the whole guard. Without it an unauthenticated public route would fetch
 * any URL a stranger names, which is a request forwarder pointed at the Worker's own network.
 */
async function confirmSubscription(url: string | undefined): Promise<void> {
  if (!url) {
    return;
  }

  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return;
    }
    host = parsed.hostname;
  } catch {
    return;
  }

  if (!BKASH_HOSTS.test(host)) {
    return;
  }

  try {
    await fetch(url, { method: "GET" });
  } catch {
    // bKash re-sends the confirmation. Failing the callback would make its retry worse.
  }
}

// --- env, plans and small conversions -----------------------------------------------------

/** Whether this environment has everything the provider needs, without throwing. */
function configured(env: BillingEnv): boolean {
  return (
    text(env, "KV_PROVIDER") !== "" &&
    CREDENTIALS.every((key) => text(env, key) !== "")
  );
}

/**
 * Refuse before any work when this environment cannot support the provider, naming the first
 * key that is unset.
 *
 * Run at the top of every method that takes an `env` rather than in `bkashMerchantBilling()`.
 * The factory is called at module load from `packages/billing/src/index.ts`, where no
 * environment exists yet; this is the first point at which one does.
 *
 * `KV_PROVIDER` is in the list because the token record lives in `kv`. `dependsOn` puts the
 * capability on disk and cannot make anyone configure it (ADR 0040).
 */
function assertConfigured(env: BillingEnv): void {
  for (const key of CREDENTIALS) {
    required(env, key);
  }

  if (!text(env, "KV_PROVIDER")) {
    throw new BillingError(
      "invalid_request",
      "bkash-merchant keeps its gateway token in the kv capability, and KV_PROVIDER is unset. Set it to an installed kv provider — `memory` for local development, `cloudflare` for a deployed Worker.",
      { providerCode: "unconfigured" }
    );
  }
}

/** The price a plan carries for an interval, or a refusal naming what is missing. */
function priceFor(
  plan: Plan,
  interval: PlanInterval
): { amount: number; currency: string } {
  const price = plan.price[interval];

  if (!price || price.amount <= 0) {
    throw new BillingError(
      "invalid_request",
      `Plan "${plan.id}" carries no ${interval} price. bkash-merchant is handed a figure rather than a price id, so set price.${interval} = { amount, currency: "${CURRENCY}" } in packages/billing/src/plans.ts — amount in poisha, so 499 BDT is 49900.`,
      { providerCode: "no_price" }
    );
  }

  if (price.currency.trim().toUpperCase() !== CURRENCY) {
    throw new BillingError(
      "invalid_request",
      `Plan "${plan.id}" is priced in ${price.currency} and bkash-merchant takes ${CURRENCY} only. bKash settles no other currency, and a mismatch would otherwise surface after the subject had been sent to the hosted page.`,
      { providerCode: "unsupported_currency" }
    );
  }

  return { amount: price.amount, currency: CURRENCY };
}

/**
 * `<plan>:<interval>:<carriedDays>:<nonce>`, which bKash echoes back on every answer.
 *
 * The nonce makes each period's invoice number its own, which is what bKash's merchant portal
 * lists a payment under. The strip and the cap are bKash's rules, applied here rather than
 * discovered at create time: a plan id holding a `&` would otherwise be refused with a code
 * nobody could act on.
 */
function invoiceNumber(
  planId: string,
  interval: PlanInterval,
  carriedDays: number
): string {
  const value = `${planId}:${interval}:${carriedDays}:${crypto.randomUUID()}`;
  return field(value);
}

/** `<customerType>:<referenceId>`, echoed back the same way. */
function payerReference(subject: BillableSubject): string {
  return field(`${subject.customerType}:${subject.referenceId}`);
}

function field(value: string): string {
  return value.replaceAll(REFUSED_CHARACTERS, "").slice(0, MAX_FIELD);
}

/** `"user:user_1"` → `["user", "user_1"]`. Splits once, so a value may hold a colon. */
function split(value: string | undefined): [string, string] {
  const at = value?.indexOf(":") ?? -1;
  if (!value || at === -1) {
    return ["", ""];
  }
  return [value.slice(0, at), value.slice(at + 1)];
}

/**
 * The host for this env.
 *
 * Anything that is not exactly `live` resolves to the sandbox, so a typo in
 * `BKASH_MERCHANT_MODE` cannot send a real payment to the live gateway. The same rule
 * `SSLCOMMERZ_MODE` keeps.
 */
function hostOf(env: BillingEnv): string {
  return text(env, "BKASH_MERCHANT_MODE") === "live" ? LIVE_URL : SANDBOX_URL;
}

/**
 * Where bKash sends the browser back: this api Worker's own origin, off the request that
 * opened the checkout.
 *
 * Derived rather than configured, which is the one place this provider diverges from
 * `billing-sslcommerz`. SSLCOMMERZ registers an IPN URL at session open and needs an origin a
 * background job could name; bKash's callback is only ever set on a `create` call that a real
 * request is already sitting inside, so the request can say where it arrived. That is one
 * fewer secret to set and one fewer to get wrong.
 *
 * A forged `host` header costs nothing here. It would send the subject's browser to a stranger
 * after paying, and that stranger cannot settle the payment — `execute` runs against bKash
 * from this Worker with this Worker's token. The webhook still settles it.
 */
function callbackBase(ctx: HostContext): string {
  const host = ctx.headers.get("host")?.trim();
  if (!host) {
    throw new BillingError(
      "invalid_request",
      "bkash-merchant builds its callback URL from the request's own origin, and this request carries no Host header.",
      { providerCode: "no_host" }
    );
  }

  const proto =
    ctx.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${proto}://${host}`;
}

/** Where a browser return lands, with one flag saying what happened. */
function appUrl(env: BillingEnv, outcome: string): string {
  const base = text(env, "BILLING_APP_URL") || "http://localhost:3001/billing";
  const url = new URL(base);
  url.searchParams.set("billing", outcome);
  return url.toString();
}

/** A required env value, or a refusal naming the key that is unset. */
function required(env: BillingEnv, key: string): string {
  const value = text(env, key);
  if (!value) {
    throw new BillingError(
      "invalid_request",
      `bkash-merchant is not configured here: ${key} is unset. Set it in apps/api/.dev.vars for local development and with \`wrangler secret put ${key}\` for a deployed Worker.`,
      { providerCode: "unconfigured" }
    );
  }
  return value;
}

function text(env: BillingEnv, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

/** `49900` → `"499.00"`. The only form bKash accepts a figure in. */
function major(amount: number): string {
  return (amount / 100).toFixed(2);
}

/** `"499.00"` → `49900`. Rounded, never truncated: `4.999` poisha is not a real figure. */
function minor(amount: string | undefined): number {
  return Math.round(Number(amount ?? "0") * 100);
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
