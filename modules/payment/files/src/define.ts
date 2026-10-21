import { PaymentError, REJECT_REASONS } from "./provider";
import type {
  CallbackContext,
  CreateInput,
  Payment,
  PaymentEnv,
  PaymentListener,
  PaymentMethod,
  PaymentNext,
  PaymentOutcome,
  PaymentProvider,
  PaymentStatus,
  RefundInput,
  RejectReason,
  SubmitInput,
} from "./provider";
import { inPaymentStore } from "./store";
import type { PaymentPatch, PaymentRefund, PaymentStore } from "./store";

// The provider registry, the status machine, and the `createPayment(env)` factory behind
// them. Everything true of every provider lives here: selection by method, the
// conditional status writes, the `payment_events` history, the refund bound, the
// `returnUrl` origin check, the listeners and error normalization. A provider module only
// ships the contract methods.

export interface PaymentConfig {
  providers: PaymentProvider[];
  listeners: PaymentListener[];
}

/** A method one of the listed providers offers, tagged with that provider. */
export interface ListedMethod extends PaymentMethod {
  provider: string;
}

/** What `create` answers: the row as written, and what the payer does next. */
export interface CreatedPayment {
  payment: Payment;
  next: PaymentNext;
}

/** What a staff action records besides the status. */
export interface ReviewInput {
  actorUserId?: string | null;
  note?: string | null;
}

export interface RejectInput extends ReviewInput {
  reason: RejectReason;
}

/** What the callback route does with a provider's answer, after the core applied it. */
export type CallbackReply =
  | { kind: "ignored" }
  | { kind: "event" }
  | { kind: "redirect"; url: string }
  | { kind: "response"; response: Response };

/** What a route calls. Returned by `createPayment(env)`. */
export interface PaymentClient {
  /** The listed provider names, in `PAYMENT_PROVIDER` order. */
  providers: string[];
  /** Every available method across the listed providers. The first provider wins a method. */
  methods(): ListedMethod[];
  create(input: CreateInput): Promise<CreatedPayment>;
  get(id: string): Promise<Payment>;
  submit(id: string, input: SubmitInput): Promise<Payment>;
  confirm(id: string, input?: ReviewInput): Promise<Payment>;
  reject(id: string, input: RejectInput): Promise<Payment>;
  refund(
    id: string,
    input: RefundInput
  ): Promise<{ payment: Payment; refund: PaymentRefund }>;
  handleCallback(
    provider: string,
    request: Request,
    path: string
  ): Promise<CallbackReply>;
}

export interface PaymentRegistry {
  providers: PaymentProvider[];
  listeners: PaymentListener[];
  create(env: PaymentEnv): PaymentClient;
}

/** The statuses a gateway's verdict may move a payment out of. */
const OPEN: readonly PaymentStatus[] = ["pending", "submitted"];

/**
 * Build the registry. `providers` and `listeners` are the patch points: every
 * `payment-<provider>` module appends to `providers`, and a capability that reacts to a
 * payment (a subscription renewal) appends to `listeners`. See `src/index.ts`.
 */
export function definePayment(config: PaymentConfig): PaymentRegistry {
  const { providers, listeners } = config;

  return {
    create(env: PaymentEnv): PaymentClient {
      const listed = selectProviders(providers, env.PAYMENT_PROVIDER);

      /** The provider a stored payment belongs to. Registered is enough; see the skill. */
      const ownerOf = (payment: Payment): PaymentProvider => {
        const owner = providers.find((p) => p.name === payment.provider);
        if (!owner) {
          throw new PaymentError(
            "provider_error",
            `Payment "${payment.id}" belongs to provider "${payment.provider}", which is not registered. Re-add its module to act on this payment.`
          );
        }
        return owner;
      };

      // Every provider call goes through this, so a raw throw still reaches the caller as
      // a `PaymentError`. A provider that already mapped its vendor code is re-thrown
      // untouched.
      const call = async <T>(
        provider: PaymentProvider,
        method: string,
        run: () => Promise<T> | T
      ): Promise<T> => {
        try {
          return await run();
        } catch (error) {
          throw normalize(error, `${provider.name}: ${method} failed`);
        }
      };

      /** Await every listener in order. A throw is logged, never re-thrown. */
      const notify = async (
        payment: Payment,
        from: PaymentStatus | null,
        to: PaymentStatus
      ): Promise<void> => {
        for (const listener of listeners) {
          try {
            await listener(env, { from, payment, to });
          } catch (error) {
            // The core has zero runtime dependencies, so it cannot reach `@repo/logger`;
            // Workers Logs indexes `console` output directly.
            // oxlint-disable-next-line no-console
            console.error(
              `payment ${payment.id}: a status listener failed on ${from ?? "none"} -> ${to}. The status change stands.`,
              error
            );
          }
        }
      };

      /** One conditional status write, its history row, and the listeners. */
      const move = async (
        store: PaymentStore,
        payment: Payment,
        from: readonly PaymentStatus[],
        to: PaymentStatus,
        patch: PaymentPatch,
        event: {
          actorUserId?: string | null;
          reason?: RejectReason | null;
          note?: string | null;
        } = {}
      ): Promise<Payment | undefined> => {
        const moved = await store.transition(payment.id, from, to, patch);
        if (!moved) {
          return;
        }
        await store.appendEvent({
          actorUserId: event.actorUserId ?? null,
          fromStatus: payment.status,
          note: event.note ?? null,
          paymentId: payment.id,
          reason: event.reason ?? null,
          toStatus: to,
        });
        await notify(moved, payment.status, to);
        return moved;
      };

      const load = async (
        store: PaymentStore,
        id: string
      ): Promise<Payment> => {
        const found = await store.findPayment(id);
        if (!found) {
          throw new PaymentError("not_found", `No payment with id "${id}".`);
        }
        return found;
      };

      /** The 409 a lost race answers, naming the status the winner left. */
      const lost = async (
        store: PaymentStore,
        id: string,
        action: string
      ): Promise<PaymentError> => {
        const current = await store.findPayment(id);
        return new PaymentError(
          "conflict",
          `Cannot ${action} payment "${id}": it is already "${current?.status ?? "gone"}". Someone else acted on it first; reload it.`
        );
      };

      const methods = (): ListedMethod[] => {
        const seen = new Set<string>();
        const out: ListedMethod[] = [];
        for (const provider of listed) {
          for (const method of provider.methods(env)) {
            if (method.available && !seen.has(method.id)) {
              seen.add(method.id);
              out.push({ ...method, provider: provider.name });
            }
          }
        }
        return out;
      };

      return {
        methods,
        providers: listed.map((p) => p.name),

        create: (input) =>
          inPaymentStore(async (store) => {
            const valid = validateCreate(env, input);
            const provider = listed.find((candidate) =>
              candidate
                .methods(env)
                .some((m) => m.id === valid.method && m.available)
            );
            if (!provider) {
              throw new PaymentError(
                "method_unavailable",
                `No provider in PAYMENT_PROVIDER (${listed
                  .map((p) => p.name)
                  .join(", ")}) takes method "${valid.method}".`
              );
            }

            const opened = await store.insertPayment({
              ...valid,
              id: crypto.randomUUID(),
              provider: provider.name,
            });
            await store.appendEvent({
              actorUserId: null,
              fromStatus: null,
              note: null,
              paymentId: opened.id,
              reason: null,
              toStatus: "pending",
            });
            await notify(opened, null, "pending");

            let result;
            try {
              result = await call(provider, "create", () =>
                provider.create(env, {
                  callbackUrl: callbackUrlFor(env, provider.name),
                  payment: opened,
                })
              );
            } catch (error) {
              // The row exists and nobody can pay it, so close it rather than leave a
              // `pending` row no provider will ever move.
              await move(
                store,
                opened,
                ["pending"],
                "failed",
                {},
                {
                  note:
                    error instanceof Error ? error.message.slice(0, 500) : null,
                }
              );
              throw error;
            }

            const { providerData, ...next } = result;
            const keep = {
              ...providerData,
              ...(next.kind === "instructions"
                ? { instructions: next.instructions }
                : {}),
            };
            const payment =
              Object.keys(keep).length > 0
                ? ((await store.updatePayment(opened.id, {
                    providerData: keep,
                  })) ?? opened)
                : opened;

            return { next: next as PaymentNext, payment };
          }),

        get: (id) => inPaymentStore((store) => load(store, id)),

        submit: (id, input) =>
          inPaymentStore(async (store) => {
            const payment = await load(store, id);
            const provider = ownerOf(payment);
            const submit = provider.submit?.bind(provider);
            if (!submit) {
              throw new PaymentError(
                "invalid_request",
                `Provider "${provider.name}" takes no submission: its payments complete at the gateway.`
              );
            }
            if (payment.status !== "pending") {
              throw await lost(store, id, "submit");
            }

            const result = await call(provider, "submit", () =>
              submit(env, payment, input)
            );
            if (!result.transactionIdNormalized) {
              throw new PaymentError(
                "provider_error",
                `${provider.name}: submit returned no normalized transaction id, so the duplicate check cannot run.`
              );
            }

            const moved = await move(store, payment, ["pending"], "submitted", {
              claimedAmount: result.claimedAmount ?? null,
              providerData: merge(payment, result.providerData),
              senderAccount: result.senderAccount ?? null,
              submittedAt: new Date(),
              transactionId: result.transactionId,
              transactionIdNormalized: result.transactionIdNormalized,
            });
            if (!moved) {
              throw await lost(store, id, "submit");
            }
            return moved;
          }),

        confirm: (id, input = {}) =>
          inPaymentStore(async (store) => {
            const payment = await load(store, id);
            if (payment.status !== "submitted") {
              throw await lost(store, id, "confirm");
            }
            const provider = ownerOf(payment);
            const confirm = provider.confirm?.bind(provider);
            const answer = confirm
              ? await call(provider, "confirm", () => confirm(env, payment))
              : undefined;

            const moved = await move(
              store,
              payment,
              ["submitted"],
              "successful",
              {
                providerData: merge(payment, answer?.providerData),
                settledAmount:
                  answer?.settledAmount ??
                  payment.claimedAmount ??
                  payment.amount,
              },
              { actorUserId: input.actorUserId, note: input.note }
            );
            if (!moved) {
              throw await lost(store, id, "confirm");
            }
            return moved;
          }),

        reject: (id, input) =>
          inPaymentStore(async (store) => {
            if (!REJECT_REASONS.includes(input.reason)) {
              throw new PaymentError(
                "invalid_request",
                `"reason" is required and has to be one of ${REJECT_REASONS.join(", ")}.`
              );
            }
            const payment = await load(store, id);
            if (payment.status !== "submitted") {
              throw await lost(store, id, "reject");
            }
            const provider = ownerOf(payment);
            const reject = provider.reject?.bind(provider);
            if (reject) {
              await call(provider, "reject", () => reject(env, payment));
            }

            // `failed` is outside the partial unique index, so the transaction id is free
            // again: a payer whose real payment was rejected by mistake can submit it anew.
            const moved = await move(
              store,
              payment,
              ["submitted"],
              "failed",
              {},
              {
                actorUserId: input.actorUserId,
                note: input.note,
                reason: input.reason,
              }
            );
            if (!moved) {
              throw await lost(store, id, "reject");
            }
            return moved;
          }),

        refund: (id, input) =>
          inPaymentStore(async (store) => {
            if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
              throw new PaymentError(
                "invalid_request",
                '"amount" has to be a positive whole number of minor units.'
              );
            }
            const payment = await load(store, id);
            if (payment.status !== "successful") {
              throw new PaymentError(
                "invalid_request",
                `Only a successful payment can be refunded; payment "${id}" is "${payment.status}".`
              );
            }
            const left = payment.amount - payment.refundedAmount;
            if (input.amount > left) {
              throw new PaymentError(
                "invalid_request",
                `A refund of ${input.amount} exceeds what is left to refund (${left} of ${payment.amount}).`
              );
            }

            // Reserve first, then move money. The reservation is the conditional update that
            // keeps the sum of refunds at or below `amount` under concurrent requests.
            const reserved = await store.reserveRefund(id, input.amount);
            if (!reserved) {
              throw await lost(store, id, "refund");
            }

            const provider = ownerOf(payment);
            let answer;
            try {
              answer = await call(provider, "refund", () =>
                provider.refund(env, payment, input)
              );
            } catch (error) {
              await store.releaseRefund(id, input.amount);
              throw error;
            }

            const refund = await store.insertRefund({
              actorUserId: input.actorUserId ?? null,
              amount: input.amount,
              note: input.note ?? null,
              paymentId: id,
              providerRefundId: answer.providerRefundId ?? null,
            });
            return { payment: reserved, refund };
          }),

        handleCallback: (name, request, path) =>
          inPaymentStore(async (store) => {
            // A stale URL still registered in some vendor dashboard names a provider this
            // project no longer runs. Answering it would let that provider move payments.
            const provider = listed.find((p) => p.name === name);
            const handle = provider?.handleCallback?.bind(provider);
            if (!provider || !handle) {
              throw new PaymentError(
                "not_found",
                `No callback surface for "${name}".`
              );
            }

            const ctx: CallbackContext = {
              payment: (id) => store.findPayment(id),
            };
            const result = await call(provider, "handleCallback", () =>
              handle(env, request, path, ctx)
            );

            if (result.kind === "ignored") {
              return { kind: "ignored" };
            }
            if (result.outcome) {
              await apply(provider, result.outcome);
            }
            if (result.kind === "event") {
              return { kind: "event" };
            }
            if (result.kind === "redirect") {
              return { kind: "redirect", url: result.url };
            }
            return { kind: "response", response: result.response };

            async function apply(
              owner: PaymentProvider,
              outcome: PaymentOutcome
            ): Promise<void> {
              const payment = await store.findPayment(outcome.paymentId);
              if (!payment || payment.provider !== owner.name) {
                throw new PaymentError(
                  "callback_invalid",
                  `Provider "${owner.name}" reported on payment "${outcome.paymentId}", which it does not own.`
                );
              }
              // A replay of a verdict already applied changes nothing.
              if (payment.status === outcome.status) {
                return;
              }
              const moved = await move(store, payment, OPEN, outcome.status, {
                providerData: merge(payment, outcome.providerData),
                ...(outcome.settledAmount === undefined
                  ? {}
                  : { settledAmount: outcome.settledAmount }),
                ...(outcome.transactionId === undefined
                  ? {}
                  : { transactionId: outcome.transactionId }),
                ...(outcome.transactionIdNormalized === undefined
                  ? {}
                  : {
                      transactionIdNormalized: outcome.transactionIdNormalized,
                    }),
              });
              if (!moved) {
                throw await lost(store, payment.id, `mark ${outcome.status}`);
              }
            }
          }),
      };
    },
    listeners,
    providers,
  };
}

/**
 * Parse `PAYMENT_PROVIDER`: a comma list in priority order. Required even when one provider
 * is installed, and every name has to be registered. An unset, empty or unknown value
 * throws here, at construction, never a fallback in either direction.
 */
export function selectProviders(
  providers: PaymentProvider[],
  selected: string | undefined
): PaymentProvider[] {
  const registered = providers.map((p) => p.name);
  const known =
    registered.length > 0
      ? `Registered providers: ${registered.join(", ")}.`
      : "No providers are registered. Install one, e.g. `saasaloy add payment-console`.";

  const names = [
    ...new Set(
      (selected ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    ),
  ];
  if (names.length === 0) {
    throw new Error(
      `PAYMENT_PROVIDER is not set. List the providers to use in priority order, e.g. "console". ${known}`
    );
  }

  return names.map((name) => {
    const provider = providers.find((p) => p.name === name);
    if (!provider) {
      throw new Error(
        `PAYMENT_PROVIDER names "${name}", which is not registered. ${known}`
      );
    }
    return provider;
  });
}

/**
 * Check a `returnUrl` against `PAYMENT_APP_URL`'s origin. With the key unset, only an
 * `http://localhost` origin passes, so a deploy that forgot the key refuses every
 * redirect rather than sending a payer wherever the caller asked (CWE-601).
 */
export function checkReturnUrl(env: PaymentEnv, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PaymentError(
      "invalid_request",
      '"returnUrl" has to be an absolute URL.'
    );
  }

  const configured =
    typeof env.PAYMENT_APP_URL === "string" && env.PAYMENT_APP_URL.length > 0
      ? env.PAYMENT_APP_URL
      : undefined;

  if (configured) {
    const allowed = new URL(configured).origin;
    if (url.origin !== allowed) {
      throw new PaymentError(
        "invalid_request",
        `"returnUrl" has to be on ${allowed}, the origin PAYMENT_APP_URL names.`
      );
    }
    return url.toString();
  }

  if (url.protocol !== "http:" || url.hostname !== "localhost") {
    throw new PaymentError(
      "invalid_request",
      '"returnUrl" has to be on http://localhost while PAYMENT_APP_URL is unset. Set PAYMENT_APP_URL to your app\'s origin.'
    );
  }
  return url.toString();
}

function validateCreate(env: PaymentEnv, input: CreateInput) {
  const text = (value: unknown, key: string): string => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new PaymentError(
        "invalid_request",
        `"${key}" is required and has to be a non-empty string.`
      );
    }
    return value.trim();
  };

  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new PaymentError(
      "invalid_request",
      '"amount" has to be a positive whole number of minor units, e.g. 1050 for 10.50.'
    );
  }
  const currency = text(input.currency, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new PaymentError(
      "invalid_request",
      '"currency" has to be an ISO 4217 code, e.g. "BDT".'
    );
  }

  return {
    amount: input.amount,
    currency,
    method: text(input.method, "method"),
    referenceId: text(input.referenceId, "referenceId"),
    referenceType: text(input.referenceType, "referenceType"),
    returnUrl:
      input.returnUrl === undefined
        ? null
        : checkReturnUrl(env, input.returnUrl),
    userId: input.userId ?? null,
  };
}

/**
 * The base URL of one provider's callback surface. Built on `BETTER_AUTH_URL`, the api's
 * own origin, which `auth` already declares. Computed only when a provider asks for it,
 * so a manual-only project never needs it.
 */
function callbackUrlFor(env: PaymentEnv, provider: string) {
  return (path = ""): string => {
    const origin = env.BETTER_AUTH_URL;
    if (typeof origin !== "string" || origin.length === 0) {
      throw new PaymentError(
        "provider_error",
        `Provider "${provider}" needs a callback URL and BETTER_AUTH_URL, the api's own origin, is not set.`
      );
    }
    const base = `${new URL(origin).origin}/payment/callback/${provider}`;
    return path ? `${base}/${path.replace(/^\/+/, "")}` : base;
  };
}

function merge(
  payment: Payment,
  extra: Record<string, unknown> | undefined
): Record<string, unknown> | null {
  if (!extra) {
    return payment.providerData;
  }
  return { ...payment.providerData, ...extra };
}

/**
 * A provider is responsible for normalizing its own failures, and is not guaranteed to. A
 * raw `TypeError` from a failed `fetch` reaching a route would break the one-error-shape
 * promise. Re-throw a `PaymentError` untouched; wrap anything else, keeping it in `cause`.
 */
export function normalize(error: unknown, message: string): PaymentError {
  if (error instanceof PaymentError) {
    return error;
  }
  return new PaymentError("provider_error", message, {
    cause: error,
    retryable: false,
  });
}
