import { createKv } from "@repo/kv";
import type { KvClient } from "@repo/kv";
import { PaymentError } from "../provider";
import type {
  CallbackContext,
  CallbackResult,
  CreateResult,
  Payment,
  PaymentEnv,
  PaymentMethod,
  PaymentOutcome,
  PaymentProvider,
  ProviderCreateInput,
  RefundInput,
  RefundResult,
} from "../provider";
import { paymentProviderEnv } from "../provider-env";

// bKash Tokenized Checkout, v1.2.0-beta, as a `payment` provider. Hold a token, create a
// payment, send the browser to `bkashURL`, execute the payment when the payer comes back.
// Reached with `fetch` and JSON: no SDK, no npm dependency. `packages/payment` gains one
// workspace dependency, `@repo/kv`, and no vendor one (ADR 0057, ADR 0020).
//
// THE TOKEN IS THE HARD PART, AND IT IS WHY THIS FILE OWNS A JOB. An `id_token` lives 3600
// seconds, and bKash's own documentation carries "Do not call this API more than two times
// within an hour. If you exceed this limit, the API will return an error, and you will be
// blocked for one hour" on both the grant page and the refresh page. So the token is minted
// by ONE caller on a schedule the deployment controls: `bkashTokenJob` runs every 15 minutes
// and acts only inside 20 minutes of expiry, which is one call every 45 minutes in the
// steady state, never two inside one hour, with spare ticks to recover a failed one. Request
// code reads the stored record and calls bKash for a token only on the cold-start path in
// `currentToken`. `cacheAside` is not used: it has no stampede protection, and
// `kv-cloudflare` carries a 60-second TTL floor plus a 60-second propagation window, so an
// on-demand refresh is exactly the miss storm the limit punishes.
//
// THE BUDGET IS DEPLOYMENT-WIDE. Two environments sharing one app key share the two calls an
// hour and block each other. Nothing in this file can enforce that; the module's skill says
// so.
//
// NOTHING ON THE WIRE IS EVIDENCE. The browser return carries `paymentID` and `status`, and
// bKash's webhook carries an SNS-shaped body whose signature algorithm is unpublished.
// Neither is believed. Both are read for one identifier, and every fact this file reports
// comes off an `execute` or `payment/status` answer it fetched itself from a host it names.

/** The value `PAYMENT_PROVIDER` lists to select this provider. */
const PROVIDER_NAME = "bkash";

/** The one method this provider offers. */
const METHOD = "bkash";

/** The two published hosts, without a trailing slash. */
const SANDBOX_URL = "https://tokenized.sandbox.bka.sh/v1.2.0-beta";
const LIVE_URL = "https://tokenized.pay.bka.sh/v1.2.0-beta";

const GRANT_PATH = "/tokenized/checkout/token/grant";
const REFRESH_PATH = "/tokenized/checkout/token/refresh";
const CREATE_PATH = "/tokenized/checkout/create";
const EXECUTE_PATH = "/tokenized/checkout/execute";
const STATUS_PATH = "/tokenized/checkout/payment/status";
const REFUND_PATH = "/tokenized/checkout/payment/refund";

/** The four credentials, checked together before any call. */
const CREDENTIALS = [
  "BKASH_APP_KEY",
  "BKASH_APP_SECRET",
  "BKASH_USERNAME",
  "BKASH_PASSWORD",
] as const;

/** bKash settles taka and nothing else. */
const CURRENCY = "BDT";

/** bKash's own word for "this call worked". Anything else is a refusal carrying a code. */
const OK_STATUS = "0000";

/** The one transaction status that means money moved. */
const COMPLETED = "Completed";

/** Mode `0011`: a one-off tokenized payment with no agreement. */
const CHECKOUT_MODE = "0011";
const INTENT = "sale";

/** bKash refuses these characters in its free-text fields. */
const REFUSED_CHARACTERS = /[<>&]/g;

/** Every free-text field is capped at 255 characters. */
const MAX_FIELD = 255;

/** The callback paths this provider answers. `return/<payment id>` and `webhook`. */
const RETURN = "return/";
const WEBHOOK = "webhook";

/** How often the token job ticks, and how close to expiry it acts. */
const BKASH_TOKEN_CRON = "*/15 * * * *";
const REFRESH_WINDOW_MS = 20 * 60 * 1000;

/**
 * How long a cold-start grant marker lives. Above `kv-cloudflare`'s 60-second TTL floor, and
 * long enough to cover its propagation window plus the grant call itself.
 */
const GRANT_MARKER_TTL_SECONDS = 300;

/** Seconds of headroom before a stored token is treated as unusable by request code. */
const TOKEN_SKEW_SECONDS = 60;

/** The job's name, the schedule's name, and the store keys, all spelled once. */
export const BKASH_TOKEN_JOB = "payment.bkash.token";
export const BKASH_TOKEN_SCHEDULE = "payment.bkash.token.quarter-hour";
const KV_NAMESPACE = "payment";
const TOKEN_KEY = ["bkash", "token"];
const GRANT_MARKER_KEY = ["bkash", "token", "granting"];

/** What is held in `kv` between requests. */
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

/** An `execute` or `payment/status` answer, in the fields this file judges on. */
interface PaymentResponse {
  statusCode?: string;
  statusMessage?: string;
  paymentID?: string;
  trxID?: string;
  transactionStatus?: string;
  amount?: string;
  currency?: string;
  merchantInvoiceNumber?: string;
  customerMsisdn?: string;
  paymentExecuteTime?: string;
}

/** A refund answer. */
interface RefundResponse {
  statusCode?: string;
  statusMessage?: string;
  refundTrxID?: string;
  transactionStatus?: string;
  amount?: string;
  currency?: string;
}

/** What one token-job tick did, for the caller's log and for the tests. */
export type TokenAction =
  /** No credentials here. The provider is installed but not configured. */
  | "skipped"
  /** The stored token is good for more than 20 minutes. */
  | "none"
  | "refreshed"
  | "granted";

/**
 * The job shape `packages/queue`'s `jobs` table holds, declared structurally so
 * `packages/payment` imports nothing from `@repo/queue`. `packages/queue` imports this file,
 * not the other way round.
 */
export interface BkashJob {
  readonly name: string;
  readonly durable: boolean;
  parse(payload: unknown): Promise<unknown>;
  run(payload: unknown, ctx: unknown): Promise<void>;
}

/** The schedule shape `packages/queue`'s `schedules` table holds. */
export interface BkashSchedule {
  name: string;
  cron: string;
  job: string;
  payload: unknown;
}

/**
 * How this provider reaches its KV store. The default is `createKv(env)`. The seam exists so
 * the token paths can be driven against a stub store, because a token schedule is not
 * something to test by sleeping through it.
 */
export interface BkashDeps {
  store?: (env: PaymentEnv) => KvClient;
}

export function bkash(deps: BkashDeps = {}): PaymentProvider {
  const open = deps.store ?? createKv;

  return {
    name: PROVIDER_NAME,

    methods(env: PaymentEnv): PaymentMethod[] {
      return [{ available: configured(env), id: METHOD, label: "bKash" }];
    },

    async create(
      env: PaymentEnv,
      input: ProviderCreateInput
    ): Promise<CreateResult> {
      assertConfigured(env);
      const { payment } = input;
      if (payment.currency !== CURRENCY) {
        throw new PaymentError(
          "invalid_request",
          `bkash takes ${CURRENCY} only; payment "${payment.id}" is in ${payment.currency}.`,
          { providerCode: "unsupported_currency" }
        );
      }

      const token = await currentToken(env, open(env));
      const answer = await postJson<CreateResponse>(
        env,
        CREATE_PATH,
        {
          amount: major(payment.amount),
          // The saasaloy id rides in the path, because bKash appends only its own
          // `paymentID` and `status` to the query.
          callbackURL: input.callbackUrl(
            `${RETURN}${encodeURIComponent(payment.id)}`
          ),
          currency: CURRENCY,
          intent: INTENT,
          // bKash echoes this on every answer, which is what lets a webhook find the row
          // from bKash's own status answer rather than from the POST.
          merchantInvoiceNumber: field(payment.id),
          mode: CHECKOUT_MODE,
          payerReference: field(payment.userId ?? payment.referenceId),
        },
        "create",
        authHeaders(env, token)
      );

      const page = answer.bkashURL?.trim();
      const paymentId = answer.paymentID?.trim();
      if (answer.statusCode !== OK_STATUS || !page || !paymentId) {
        throw failure(
          answer.statusCode,
          `bkash refused to create a payment: ${answer.statusMessage ?? answer.statusCode ?? "no reason given"}`
        );
      }

      return {
        kind: "redirect",
        providerData: { paymentID: paymentId },
        url: page,
      };
    },

    async refund(
      env: PaymentEnv,
      payment: Payment,
      input: RefundInput
    ): Promise<RefundResult> {
      assertConfigured(env);
      const paymentId = storedPaymentId(payment);
      const trxId = payment.transactionId?.trim();
      if (!paymentId || !trxId) {
        throw new PaymentError(
          "invalid_request",
          `Payment "${payment.id}" carries no bKash paymentID and trxID, so bkash cannot refund it.`,
          { providerCode: "no_trx_id" }
        );
      }

      const answer = await postJson<RefundResponse>(
        env,
        REFUND_PATH,
        {
          amount: major(input.amount),
          paymentID: paymentId,
          reason: field(input.note?.trim() || "refund"),
          sku: field(payment.referenceType),
          trxID: trxId,
        },
        "refund",
        authHeaders(env, await currentToken(env, open(env)))
      );

      const refundTrxId = answer.refundTrxID?.trim();
      if (answer.transactionStatus?.trim() === COMPLETED && refundTrxId) {
        return { providerRefundId: refundTrxId };
      }
      throw failure(
        answer.statusCode,
        `bkash refused the refund: ${answer.statusMessage ?? answer.statusCode ?? "no reason given"}`
      );
    },

    /**
     * `return/<id>` is the payer's browser coming back from the hosted page. `webhook` is the
     * SNS-shaped notification a merchant hands its listener URL to bKash support for. Both
     * settle through an answer this file fetched, and the core applies a verdict as a
     * conditional update out of `pending`, so whichever lands second changes nothing.
     */
    async handleCallback(
      env: PaymentEnv,
      request: Request,
      path: string,
      ctx: CallbackContext
    ): Promise<CallbackResult> {
      assertConfigured(env);
      const route = path.replaceAll(/^\/+|\/+$/g, "");

      if (route.startsWith(RETURN)) {
        const id = decodeURIComponent(route.slice(RETURN.length));
        return await handleReturn(env, request, id, ctx, open(env));
      }
      if (route === WEBHOOK) {
        return await handleWebhook(env, request, ctx, open(env));
      }
      return { kind: "ignored" };
    },
  };
}

// --- the token, and the job that holds it ------------------------------------------------

/**
 * One tick of the token job. `now` and the store are parameters, so a test can drive the
 * clock across the 20-minute boundary.
 *
 * A refresh is tried first whenever there is a refresh token, because it is the cheaper
 * call. A refused refresh falls through to a grant, which spends the second of the hour's
 * two calls and is why the job leaves three spare ticks.
 */
export async function runBkashToken(
  store: KvClient,
  env: PaymentEnv,
  now: Date
): Promise<TokenAction> {
  if (!configured(env)) {
    // Installed but not configured. Throwing here would dead-letter a message on every tick
    // of a project that is not using bKash yet.
    return "skipped";
  }

  const key = tokenKey(store);
  const record = await store.get<TokenRecord>(key);

  if (record && record.expiresAt - now.getTime() > REFRESH_WINDOW_MS) {
    return "none";
  }

  if (record?.refreshToken) {
    const refreshed = await callToken(env, REFRESH_PATH, {
      app_key: required(env, "BKASH_APP_KEY"),
      app_secret: required(env, "BKASH_APP_SECRET"),
      refresh_token: record.refreshToken,
    });
    if (refreshed) {
      await store.set(key, toRecord(refreshed, now));
      return "refreshed";
    }
  }

  const granted = await callToken(env, GRANT_PATH, {
    app_key: required(env, "BKASH_APP_KEY"),
    app_secret: required(env, "BKASH_APP_SECRET"),
  });
  if (!granted) {
    // Not retryable: a retry would spend another of the hour's two calls on the same
    // refusal. The next tick is 15 minutes away, and the message dead-letters where an
    // operator reads it.
    throw new PaymentError(
      "provider_error",
      "bkash refused to grant a token. Check the four BKASH_* credentials, and see the module skill for what a rate-limit block looks like.",
      { providerCode: "token_refused", retryable: false }
    );
  }

  await store.set(key, toRecord(granted, now));
  return "granted";
}

/**
 * The job, as the `jobs` table registers it. A handler gets no `env`, so the credentials
 * and `KV_PROVIDER` come through `paymentProviderEnv()` (ADR 0057).
 */
export const bkashTokenJob = (deps: BkashDeps = {}): BkashJob => ({
  durable: false,
  name: BKASH_TOKEN_JOB,
  parse: (payload: unknown) => Promise.resolve(payload),
  run: async () => {
    const env = paymentProviderEnv();
    const open = deps.store ?? createKv;
    await runBkashToken(open(env), env, new Date());
  },
});

/** The quarter-hour tick, as the `schedules` table registers it. */
export const bkashTokenSchedule = (): BkashSchedule => ({
  cron: BKASH_TOKEN_CRON,
  job: BKASH_TOKEN_JOB,
  name: BKASH_TOKEN_SCHEDULE,
  payload: {},
});

/**
 * The token a request should use. The steady state is one KV read. The cold-start branch is
 * the only place request code calls bKash for a token, so a fresh deploy does not refuse
 * every checkout until the first tick.
 *
 * The marker is written before the grant, so two concurrent cold starts do not both grant.
 * The second one fails `retryable`.
 */
async function currentToken(env: PaymentEnv, store: KvClient): Promise<string> {
  const key = tokenKey(store);
  const record = await store.get<TokenRecord>(key);
  if (record && record.expiresAt > Date.now() + TOKEN_SKEW_SECONDS * 1000) {
    return record.idToken;
  }

  const marker = store.key({
    namespace: KV_NAMESPACE,
    parts: GRANT_MARKER_KEY,
  });
  if (await store.get<number>(marker)) {
    throw new PaymentError(
      "provider_error",
      "bkash is minting its first token. Try again in a moment.",
      { providerCode: "token_pending", retryable: true }
    );
  }
  await store.set(marker, Date.now(), {
    ttlSeconds: GRANT_MARKER_TTL_SECONDS,
  });

  const granted = await callToken(env, GRANT_PATH, {
    app_key: required(env, "BKASH_APP_KEY"),
    app_secret: required(env, "BKASH_APP_SECRET"),
  });
  if (!granted) {
    throw new PaymentError(
      "provider_error",
      "bkash has no usable token and the grant was refused. The scheduled token job retries every 15 minutes.",
      { providerCode: "token_refused", retryable: true }
    );
  }

  await store.set(key, toRecord(granted, new Date()));
  return granted.id_token ?? "";
}

/**
 * One token call, answering `undefined` for a refusal rather than throwing. A transport
 * failure still throws, because "could not ask" is not "was refused".
 */
async function callToken(
  env: PaymentEnv,
  path: string,
  body: Record<string, string>
): Promise<TokenResponse | undefined> {
  const answer = await postJson<TokenResponse>(env, path, body, "token", {
    password: required(env, "BKASH_PASSWORD"),
    username: required(env, "BKASH_USERNAME"),
  });
  if (answer.statusCode === OK_STATUS && answer.id_token) {
    return answer;
  }
  return undefined;
}

function toRecord(answer: TokenResponse, now: Date): TokenRecord {
  // bKash has answered `expires_in` as both a number and a string. An unreadable one falls
  // back to the documented 3600.
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
  return store.key({ namespace: KV_NAMESPACE, parts: TOKEN_KEY });
}

// --- callbacks ---------------------------------------------------------------------------

/**
 * The browser coming back from the hosted page. `status=success` is a hint that `execute`
 * is worth calling, never a statement that money moved. A cancel or a failure is checked
 * against `payment/status` first, so a payment bKash completed is never cancelled.
 */
async function handleReturn(
  env: PaymentEnv,
  request: Request,
  id: string,
  ctx: CallbackContext,
  store: KvClient
): Promise<CallbackResult> {
  const payment = await ctx.payment(id);
  if (!payment || payment.provider !== PROVIDER_NAME) {
    throw new PaymentError(
      "callback_invalid",
      `No bkash payment with id "${id}".`
    );
  }

  const query = new URL(request.url).searchParams;
  const paymentId = query.get("paymentID")?.trim() ?? "";
  const status = query.get("status")?.trim().toLowerCase() ?? "";
  if (!paymentId || paymentId !== storedPaymentId(payment)) {
    throw new PaymentError(
      "callback_invalid",
      `The bkash return for payment "${id}" names a paymentID this payment was not created with.`
    );
  }

  // Already settled, e.g. by the webhook or a second return. Nothing to ask bKash.
  if (payment.status !== "pending") {
    return land(payment);
  }

  const headers = authHeaders(env, await currentToken(env, store));
  const answer =
    status === "success"
      ? await settle(env, paymentId, headers)
      : await queryStatus(env, paymentId, headers);

  let outcome = outcomeFor(payment, answer);
  if (!outcome && status === "cancel") {
    outcome = { paymentId: payment.id, status: "cancelled" };
  } else if (!outcome && status === "failure") {
    outcome = { paymentId: payment.id, status: "failed" };
  }
  return land(payment, outcome);
}

/**
 * The notification bKash posts, treated as a bare hint. One identifier is read off the body,
 * and the outcome comes from a `payment/status` call this file makes. A forged POST costs
 * one API call and grants nothing.
 */
async function handleWebhook(
  env: PaymentEnv,
  request: Request,
  ctx: CallbackContext,
  store: KvClient
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

  const answer = await queryStatus(
    env,
    paymentId,
    authHeaders(env, await currentToken(env, store))
  );
  // A notification naming a payment bKash does not recognise is a forgery or a stale replay.
  if (answer.statusCode !== OK_STATUS) {
    return { kind: "ignored" };
  }

  const payment = await ctx.payment(answer.merchantInvoiceNumber?.trim() ?? "");
  if (
    !payment ||
    payment.provider !== PROVIDER_NAME ||
    storedPaymentId(payment) !== paymentId
  ) {
    return { kind: "ignored" };
  }

  const outcome = outcomeFor(payment, answer);
  return outcome ? { kind: "event", outcome } : { kind: "ignored" };
}

/** Where a browser return lands: the payment's return URL, or a short page of our own. */
function land(payment: Payment, outcome?: PaymentOutcome): CallbackResult {
  const status = outcome?.status ?? payment.status;
  if (payment.returnUrl) {
    return {
      kind: "redirect",
      url: payment.returnUrl,
      ...(outcome ? { outcome } : {}),
    };
  }
  return {
    kind: "response",
    response: new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>bKash payment</title></head><body><p>Payment ${escape(payment.id)} is ${escape(status)}.</p></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" }, status: 200 }
    ),
    ...(outcome ? { outcome } : {}),
  };
}

/**
 * What a payment is worth, from the strongest source that answers. `execute` first, because
 * it settles an authorized payment. Any code it does not map (`2062`, "already completed",
 * is the expected one) falls through to `payment/status`. Not reaching bKash throws rather
 * than settling anything.
 */
async function settle(
  env: PaymentEnv,
  paymentId: string,
  headers: Record<string, string>
): Promise<PaymentResponse> {
  const executed = await postJson<PaymentResponse>(
    env,
    EXECUTE_PATH,
    { paymentID: paymentId },
    "execute",
    headers
  );
  const code = executed.statusCode?.trim() ?? "";
  if (code === OK_STATUS || code === CANCELLED || isDeclined(code)) {
    return executed;
  }
  return await queryStatus(env, paymentId, headers);
}

function queryStatus(
  env: PaymentEnv,
  paymentId: string,
  headers: Record<string, string>
): Promise<PaymentResponse> {
  return postJson<PaymentResponse>(
    env,
    STATUS_PATH,
    { paymentID: paymentId },
    "status",
    headers
  );
}

/**
 * The verdict an answer is worth for this payment, or nothing.
 *
 * A completed answer that does not describe the row is a `provider_error`, never a silent
 * accept: an underpayment quietly accepted is how an order ships at the wrong price. A
 * declined code is `failed`, a cancelled one is `cancelled`. Anything still in flight is
 * nothing, and the webhook or a later return asks again.
 */
function outcomeFor(
  payment: Payment,
  body: PaymentResponse
): PaymentOutcome | undefined {
  const code = body.statusCode?.trim() ?? "";
  const trxId = body.trxID?.trim() ?? "";

  if (code === OK_STATUS && body.transactionStatus?.trim() === COMPLETED) {
    const mismatch = mismatchIn(payment, body);
    if (mismatch) {
      throw new PaymentError(
        "provider_error",
        `bkash reported a completed payment for "${payment.id}" but ${mismatch}. The payment stays pending for a person to reconcile.`,
        { providerCode: "mismatch", retryable: false }
      );
    }
    if (!trxId) {
      throw new PaymentError(
        "provider_error",
        "bkash reported a completed payment with no trxID.",
        { providerCode: "no_trx_id", retryable: false }
      );
    }
    return {
      paymentId: payment.id,
      providerData: {
        customerMsisdn: body.customerMsisdn ?? null,
        paymentExecuteTime: body.paymentExecuteTime ?? null,
      },
      settledAmount: minor(body.amount),
      status: "successful",
      transactionId: trxId,
      transactionIdNormalized: trxId.toUpperCase(),
    };
  }
  if (code === CANCELLED) {
    return { paymentId: payment.id, status: "cancelled" };
  }
  if (isDeclined(code)) {
    return {
      paymentId: payment.id,
      providerData: { declineCode: code },
      status: "failed",
    };
  }
  if (code === OK_STATUS) {
    return undefined;
  }
  throw failure(
    code,
    `bkash answered a status this provider does not recognise: ${code || "(none)"}`
  );
}

/**
 * Why a completed answer does not describe the row, or null. The amount is compared in
 * minor units, because bKash writes `499.00`, `499.0` and `499` for the same figure.
 */
function mismatchIn(payment: Payment, body: PaymentResponse): string | null {
  const invoice = body.merchantInvoiceNumber?.trim();
  if (invoice !== undefined && invoice !== field(payment.id)) {
    return `it names invoice ${invoice}`;
  }
  const currency = body.currency?.trim().toUpperCase();
  if (currency !== payment.currency) {
    return `it was charged in ${currency ?? "(none)"}, not ${payment.currency}`;
  }
  const charged = minor(body.amount);
  if (charged !== payment.amount) {
    return `it was charged ${major(charged)}, not ${major(payment.amount)}`;
  }
  return null;
}

// --- the bKash status codes this file maps -----------------------------------------------

/** The payer cancelled on bKash's own page. */
const CANCELLED = "2069";

/**
 * Codes that mean the wallet refused: insufficient balance, the PIN and OTP failures. Kept
 * apart from the unknown case: a code this file does not recognise is a gap in this list,
 * not a failed payment.
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
 * One bKash code as a `PaymentError`, the raw code kept in `providerCode`. Anything
 * unrecognised is `provider_error` and not retryable: repeating a call bKash answered with a
 * code nobody has read is how a second payment gets taken.
 */
function failure(code: string | undefined, message: string): PaymentError {
  const raw = code?.trim() ?? "";
  if (DECLINED_CODES.has(raw)) {
    return new PaymentError("declined", message, {
      providerCode: raw,
      retryable: false,
    });
  }
  if (INVALID_CREDENTIAL_CODES.has(raw)) {
    return new PaymentError(
      "invalid_request",
      `${message}. Check BKASH_APP_KEY and BKASH_APP_SECRET, and that they belong to the host BKASH_MODE selects.`,
      { providerCode: raw, retryable: false }
    );
  }
  if (RETRYABLE_CODES.has(raw)) {
    return new PaymentError("provider_error", message, {
      providerCode: raw,
      retryable: true,
    });
  }
  return new PaymentError("provider_error", message, {
    providerCode: raw || "no_status",
    retryable: false,
  });
}

// --- the wire ----------------------------------------------------------------------------

/**
 * One request against bKash, as JSON. Every transport failure throws `provider_error` with
 * `retryable: true`. A refusal bKash meant arrives as a 200 with a non-`0000` `statusCode`,
 * and the caller reads that.
 */
async function postJson<Body>(
  env: PaymentEnv,
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
    throw new PaymentError(
      "provider_error",
      `bkash: the ${what} request did not complete`,
      { cause: error, providerCode: "unreachable", retryable: true }
    );
  }

  const payload = await response.text();
  if (!response.ok) {
    throw new PaymentError(
      "provider_error",
      `bkash answered HTTP ${String(response.status)} to the ${what} request`,
      { providerCode: `http_${String(response.status)}`, retryable: true }
    );
  }
  try {
    return JSON.parse(payload) as Body;
  } catch (error) {
    throw new PaymentError(
      "provider_error",
      `bkash answered the ${what} request with something that is not JSON`,
      { cause: error, providerCode: "unreadable", retryable: true }
    );
  }
}

/** Every call but the token calls carries these two. */
function authHeaders(env: PaymentEnv, token: string): Record<string, string> {
  return {
    authorization: token,
    "x-app-key": required(env, "BKASH_APP_KEY"),
  };
}

async function readJsonBody(
  request: Request
): Promise<Record<string, string> | undefined> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object"
      ? (body as Record<string, string>)
      : undefined;
  } catch {
    // An empty body, or not JSON. There is nothing to look up.
    return undefined;
  }
}

/** The `paymentID` a notification names, directly or inside SNS's `Message` string. */
function notifiedPaymentId(body: Record<string, string>): string {
  const direct = body.paymentID?.trim();
  if (direct) {
    return direct;
  }
  try {
    const inner: unknown = JSON.parse(body.Message ?? "");
    if (inner && typeof inner === "object") {
      const record = inner as Record<string, string>;
      return record.paymentID?.trim() ?? record.paymentId?.trim() ?? "";
    }
  } catch {
    // Not JSON, or no `Message` at all.
  }
  return "";
}

/** Hosts a `SubscribeURL` may point at. Anything else is not fetched. */
const BKASH_HOSTS = /(^|\.)(bka\.sh|bkash\.com|amazonaws\.com)$/;

/**
 * The SNS handshake. The host check is the whole guard: without it a public route would
 * fetch any URL a stranger names.
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
    // bKash re-sends the confirmation.
  }
}

// --- env and small conversions ------------------------------------------------------------

/** Whether this environment has everything the provider needs, without throwing. */
function configured(env: PaymentEnv): boolean {
  return (
    text(env, "KV_PROVIDER") !== "" &&
    CREDENTIALS.every((key) => text(env, key) !== "")
  );
}

/**
 * Refuse before any work, naming the first key that is unset. Run per call rather than in
 * `bkash()`, because the factory runs at module load where no environment exists yet.
 * `KV_PROVIDER` is in the list because the token lives in `kv`: `dependsOn` puts the
 * capability on disk and cannot make anyone configure it.
 */
function assertConfigured(env: PaymentEnv): void {
  for (const key of CREDENTIALS) {
    required(env, key);
  }
  if (!text(env, "KV_PROVIDER")) {
    throw new PaymentError(
      "invalid_request",
      "bkash keeps its gateway token in the kv capability, and KV_PROVIDER is unset. Set it to an installed kv provider: `memory` for local development, `cloudflare` for a deployed Worker.",
      { providerCode: "unconfigured" }
    );
  }
}

function required(env: PaymentEnv, key: string): string {
  const value = text(env, key);
  if (!value) {
    throw new PaymentError(
      "invalid_request",
      `bkash is not configured here: ${key} is unset. Run \`saasaloy env\` then \`pnpm env:setup\` for local development, and \`wrangler secret put ${key}\` for a deployed Worker.`,
      { providerCode: "unconfigured" }
    );
  }
  return value;
}

function text(env: PaymentEnv, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Anything that is not exactly `live` selects the sandbox, so a typo cannot take real money. */
function hostOf(env: PaymentEnv): string {
  return text(env, "BKASH_MODE") === "live" ? LIVE_URL : SANDBOX_URL;
}

function storedPaymentId(payment: Payment): string | undefined {
  const value = payment.providerData?.paymentID;
  return typeof value === "string" ? value : undefined;
}

function field(value: string): string {
  return value.replaceAll(REFUSED_CHARACTERS, "").slice(0, MAX_FIELD);
}

/** `49900` → `"499.00"`. The only form bKash accepts a figure in. */
function major(amount: number): string {
  return (amount / 100).toFixed(2);
}

/** `"499.00"` → `49900`. Rounded, never truncated. */
function minor(amount: string | undefined): number {
  return Math.round(Number(amount ?? "0") * 100);
}

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
