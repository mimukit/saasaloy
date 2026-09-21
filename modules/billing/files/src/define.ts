import { BillingError } from "./provider";
import type {
  BillingEnv,
  BillingProvider,
  CallbackResult,
  ChangePlanInput,
  CheckoutInput,
  CheckoutResult,
  HostContext,
  Invoice,
  Plan,
  PlanConfig,
  PortalInput,
  QuantityInput,
  RenewalMode,
  SubjectInput,
} from "./provider";

// The provider registry, the plan table, and the `createBilling(env)` factory behind them.
// This file holds everything that is true of *every* provider — selection and error
// normalization — so a provider module only ever ships the contract methods.

export interface BillingConfig {
  providers: BillingProvider[];
}

/**
 * The providers the project registered, as `defineBilling` last saw them.
 *
 * Read by the renewal job, which has to know which provider names renew manually and runs
 * from a cron tick with no `env` and no request. It cannot import `./index.ts` for the
 * registry — that file imports this one — so the registration is recorded here instead.
 */
let registered: BillingProvider[] = [];

/** Every registered provider. Empty until `defineBilling` runs, which it does at load. */
export function registeredProviders(): BillingProvider[] {
  return registered;
}

/** The names of the providers that declare `renewal: "manual"`. The renewal job's filter. */
export function manualRenewalProviders(): string[] {
  return registered
    .filter((provider) => provider.renewal === "manual")
    .map((provider) => provider.name);
}

/** What a route calls. Returned by `createBilling(env)`. */
export interface BillingClient {
  /** The selected provider's name — handy in logs and in a `doctor` check. */
  provider: string;
  /** How the selected provider renews. `"vendor"` unless it says otherwise. */
  renewal: RenewalMode;
  /**
   * Whether the selected provider owns a callback surface. False means the callback route
   * answers 404 rather than 500 on a POST nobody is there to handle.
   */
  handlesCallbacks: boolean;
  /**
   * Hand one callback to the selected provider. Throws `not_found` when it has none, so the
   * route can answer without reaching inside the registry.
   */
  handleCallback(request: Request, path: string): Promise<CallbackResult>;
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

export interface BillingRegistry {
  providers: BillingProvider[];
  create(env: BillingEnv): BillingClient;
}

/**
 * Build the registry. `providers` is the patch point every `billing-<provider>` module
 * appends to. See `src/index.ts`.
 */
export function defineBilling(config: BillingConfig): BillingRegistry {
  const { providers } = config;
  registered = providers;

  return {
    create(env: BillingEnv): BillingClient {
      const provider = selectProvider(providers, env.BILLING_PROVIDER);

      // Every method goes through the same wrapper, so one raw throw anywhere in a
      // provider still reaches the caller as a `BillingError`. A provider that has
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
        handleCallback: (request, path) =>
          call("handleCallback", () => {
            if (!provider.handleCallback) {
              throw new BillingError(
                "not_found",
                `${provider.name} has no callback surface, so nothing should be posting to /billing/callback/${provider.name}/.`
              );
            }
            return Promise.resolve(provider.handleCallback(env, request, path));
          }),
        handlesCallbacks: provider.handleCallback !== undefined,
        listInvoices: (ctx, input) =>
          call("listInvoices", () =>
            Promise.resolve(provider.listInvoices(env, ctx, input))
          ),
        provider: provider.name,
        renewal: provider.renewal ?? "vendor",
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
 * Declare the project's plans. Exactly one plan names no price at all, and that is the
 * default — what a subject with no live subscription, or a locked one, resolves to. Both
 * "none" and "more than one" throw here, at module load, rather than resolving to an
 * undefined plan inside a request.
 *
 * "Names a price" means a `providerIds` entry **or** a `price`. A vendor that owns a hosted
 * price object gets the first; a gateway that is handed a figure gets the second. A paid
 * plan that carried only a `price` would otherwise read as the free tier here, and every
 * unsubscribed subject would resolve to it.
 */
export function definePlans(configs: PlanConfig[]): Plan[] {
  const plans: Plan[] = configs.map((config) => ({
    features: config.features ?? {},
    id: config.id,
    isDefault:
      Object.keys(config.providerIds ?? {}).length === 0 &&
      Object.keys(config.price ?? {}).length === 0,
    limits: config.limits ?? {},
    name: config.name,
    price: config.price ?? {},
    providerIds: config.providerIds ?? {},
    ...(config.trialDays === undefined ? {} : { trialDays: config.trialDays }),
  }));

  const ids = plans.map((plan) => plan.id);
  const duplicate = ids.find((id, at) => ids.indexOf(id) !== at);
  if (duplicate) {
    throw new BillingError(
      "invalid_request",
      `Two plans share the id "${duplicate}". A plan id is what billing_subscriptions.plan stores, so it has to be unique.`
    );
  }

  const defaults = plans.filter((plan) => plan.isDefault);
  if (defaults.length !== 1) {
    throw new BillingError(
      "invalid_request",
      defaults.length === 0
        ? "No default plan: every plan in plans.ts names a price, through providerIds or price. Exactly one plan must name neither — it is what an unsubscribed subject resolves to."
        : `More than one default plan: ${defaults
            .map((plan) => plan.id)
            .join(
              ", "
            )} all name no price, through neither providerIds nor price. Exactly one must.`
    );
  }

  return plans;
}

/** The one plan with no `providerIds`. `definePlans` has already proved it exists. */
export function defaultPlan(plans: Plan[]): Plan {
  const plan = plans.find((candidate) => candidate.isDefault);
  if (!plan) {
    throw new BillingError(
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
    throw new BillingError(
      "not_found",
      `No plan with id "${id}". Registered plans: ${plans
        .map((candidate) => candidate.id)
        .join(", ")}.`
    );
  }
  return plan;
}

/**
 * `BILLING_PROVIDER` is required even when exactly one provider is installed, and an
 * unknown value is an error rather than a fallback. Both directions of the silent failure
 * are worse than a throw: a production deploy that quietly stops taking payments, and a
 * test run that quietly starts charging a real card.
 */
function selectProvider(
  providers: BillingProvider[],
  selected: string | undefined
): BillingProvider {
  const names = providers.map((p) => p.name);
  const known =
    names.length > 0
      ? `Registered providers: ${names.join(", ")}.`
      : "No providers are registered — install one, e.g. `saasaloy add billing-console`.";

  if (!selected) {
    throw new Error(`BILLING_PROVIDER is not set. ${known}`);
  }

  const provider = providers.find((p) => p.name === selected);
  if (!provider) {
    throw new Error(
      `BILLING_PROVIDER is "${selected}", which is not registered. ${known}`
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
function normalize(error: unknown, message: string): BillingError {
  if (error instanceof BillingError) {
    return error;
  }
  return new BillingError("provider_error", message, {
    cause: error,
    retryable: false,
  });
}
