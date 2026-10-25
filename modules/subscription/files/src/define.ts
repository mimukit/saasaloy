import { SubscriptionError } from "./provider";
import type {
  SubscriptionEnv,
  SubscriptionProvider,
  ChangePlanInput,
  CheckoutInput,
  CheckoutResult,
  HostContext,
  Invoice,
  Plan,
  PlanConfig,
  PortalInput,
  QuantityInput,
  SubjectInput,
} from "./provider";

// The provider registry, the plan table, and the `createSubscription(env)` factory behind them.
// This file holds everything that is true of *every* provider — selection and error
// normalization — so a provider module only ever ships the contract methods.

export interface SubscriptionConfig {
  providers: SubscriptionProvider[];
}

/** What a route calls. Returned by `createSubscription(env)`. */
export interface SubscriptionClient {
  /** The selected provider's name — handy in logs and in a `doctor` check. */
  provider: string;
  createCheckout(
    ctx: HostContext,
    input: CheckoutInput
  ): Promise<CheckoutResult>;
  createPortal(ctx: HostContext, input: PortalInput): Promise<{ url: string }>;
  changePlan(ctx: HostContext, input: ChangePlanInput): Promise<CheckoutResult>;
  cancel(
    ctx: HostContext,
    input: SubjectInput
  ): Promise<CheckoutResult | undefined>;
  restore(
    ctx: HostContext,
    input: SubjectInput
  ): Promise<CheckoutResult | undefined>;
  setQuantity(ctx: HostContext, input: QuantityInput): Promise<void>;
  listInvoices(ctx: HostContext, input: SubjectInput): Promise<Invoice[]>;
}

export interface SubscriptionRegistry {
  providers: SubscriptionProvider[];
  create(env: SubscriptionEnv): SubscriptionClient;
}

/**
 * Build the registry. `providers` is the patch point every `subscription-<provider>` module
 * appends to. See `src/index.ts`.
 */
export function defineSubscription(
  config: SubscriptionConfig
): SubscriptionRegistry {
  const { providers } = config;

  return {
    create(env: SubscriptionEnv): SubscriptionClient {
      const provider = selectProvider(providers, env.SUBSCRIPTION_PROVIDER);

      // Every method goes through the same wrapper, so one raw throw anywhere in a
      // provider still reaches the caller as a `SubscriptionError`. A provider that has
      // already mapped its vendor code is re-thrown untouched.
      const call = async <T>(
        method: string,
        run: () => Promise<T>
      ): Promise<T> => {
        try {
          return await run();
        } catch (error) {
          throw normalize(error, `${provider.name}: ${method} failed`);
        }
      };

      return {
        cancel: (ctx, input) =>
          call("cancel", () =>
            Promise.resolve(provider.cancel(env, ctx, input))
          ),
        changePlan: (ctx, input) =>
          call("changePlan", () =>
            Promise.resolve(provider.changePlan(env, ctx, input))
          ),
        createCheckout: (ctx, input) =>
          call("createCheckout", () =>
            Promise.resolve(provider.createCheckout(env, ctx, input))
          ),
        createPortal: (ctx, input) =>
          call("createPortal", () =>
            Promise.resolve(provider.createPortal(env, ctx, input))
          ),
        listInvoices: (ctx, input) =>
          call("listInvoices", () =>
            Promise.resolve(provider.listInvoices(env, ctx, input))
          ),
        provider: provider.name,
        restore: (ctx, input) =>
          call("restore", () =>
            Promise.resolve(provider.restore(env, ctx, input))
          ),
        setQuantity: (ctx, input) =>
          call("setQuantity", () =>
            Promise.resolve(provider.setQuantity(env, ctx, input))
          ),
      };
    },
    providers,
  };
}

/**
 * Declare the project's plans. Exactly one plan carries no `providerIds`, and that is the
 * default — what a subject with no live subscription, or a locked one, resolves to. Both
 * "none" and "more than one" throw here, at module load, rather than resolving to an
 * undefined plan inside a request.
 */
export function definePlans(configs: PlanConfig[]): Plan[] {
  const plans: Plan[] = configs.map((config) => ({
    features: config.features ?? {},
    id: config.id,
    isDefault:
      config.providerIds === undefined ||
      Object.keys(config.providerIds).length === 0,
    limits: config.limits ?? {},
    name: config.name,
    providerIds: config.providerIds ?? {},
    ...(config.trialDays === undefined ? {} : { trialDays: config.trialDays }),
  }));

  const ids = plans.map((plan) => plan.id);
  const duplicate = ids.find((id, at) => ids.indexOf(id) !== at);
  if (duplicate) {
    throw new SubscriptionError(
      "invalid_request",
      `Two plans share the id "${duplicate}". A plan id is what subscriptions.plan stores, so it has to be unique.`
    );
  }

  const defaults = plans.filter((plan) => plan.isDefault);
  if (defaults.length !== 1) {
    throw new SubscriptionError(
      "invalid_request",
      defaults.length === 0
        ? "No default plan: every plan in plans.ts carries providerIds. Exactly one plan must carry none — it is what an unsubscribed subject resolves to."
        : `More than one default plan: ${defaults
            .map((plan) => plan.id)
            .join(", ")} all carry no providerIds. Exactly one must.`
    );
  }

  return plans;
}

/** The one plan with no `providerIds`. `definePlans` has already proved it exists. */
export function defaultPlan(plans: Plan[]): Plan {
  const plan = plans.find((candidate) => candidate.isDefault);
  if (!plan) {
    throw new SubscriptionError(
      "not_found",
      "No default plan is registered. Build the list with definePlans, which enforces exactly one."
    );
  }
  return plan;
}

/** Look a plan up by id, or throw rather than return `undefined` into a price lookup. */
export function findPlan(plans: Plan[], id: string): Plan {
  const plan = plans.find((candidate) => candidate.id === id);
  if (!plan) {
    throw new SubscriptionError(
      "not_found",
      `No plan with id "${id}". Registered plans: ${plans
        .map((candidate) => candidate.id)
        .join(", ")}.`
    );
  }
  return plan;
}

/**
 * `SUBSCRIPTION_PROVIDER` is required even when exactly one provider is installed, and an
 * unknown value is an error rather than a fallback. Both directions of the silent failure
 * are worse than a throw: a production deploy that quietly stops taking payments, and a
 * test run that quietly starts charging a real card.
 */
function selectProvider(
  providers: SubscriptionProvider[],
  selected: string | undefined
): SubscriptionProvider {
  const registered = providers.map((p) => p.name);
  const known =
    registered.length > 0
      ? `Registered providers: ${registered.join(", ")}.`
      : "No providers are registered — install one, e.g. `saasaloy add subscription-console`.";

  if (!selected) {
    throw new Error(`SUBSCRIPTION_PROVIDER is not set. ${known}`);
  }

  const provider = providers.find((p) => p.name === selected);
  if (!provider) {
    throw new Error(
      `SUBSCRIPTION_PROVIDER is "${selected}", which is not registered. ${known}`
    );
  }
  return provider;
}

/**
 * A provider is contractually responsible for normalizing its own failures, and is not
 * guaranteed to: a raw `TypeError` from a failed `fetch` reaching a route would break the
 * one-error-shape promise, and a caller reading `retryable` off it would get `undefined`.
 * Re-throw a well-formed error untouched; wrap anything else, keeping the original in
 * `cause`.
 */
function normalize(error: unknown, message: string): SubscriptionError {
  if (error instanceof SubscriptionError) {
    return error;
  }
  return new SubscriptionError("provider_error", message, {
    cause: error,
    retryable: false,
  });
}
