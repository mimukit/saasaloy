// The one number the capability reads out of the environment, the whole environment itself,
// and the two ports that carry them in. The third sibling of `./store.ts` and
// `./enqueue.ts`, for the same reason and by the same shape.
//
// `BILLING_LOCKOUT_DAYS` is needed by the daily lockout job, and a job handler gets
// `(payload, ctx)` and no `env` (packages/queue/src/provider.ts). The core also never reads
// `process.env` and holds no importable Workers env of its own, so it cannot look the value
// up itself. `apps/api/src/billing-store.ts` — the one file that already registers the store
// resolver and the enqueuer — reads it once at module load and calls `setBillingConfig`.

import type { BillingEnv } from "./provider";

/** What the capability needs to know beyond its provider selection. */
export interface BillingConfigValues {
  /**
   * Days a subscription may stay `past_due` before the daily job sets `lockedAt` and the
   * subject drops to the default plan.
   */
  lockoutDays: number;
}

/** What the capability falls back to when nothing registers a config. */
export const DEFAULT_LOCKOUT_DAYS = 14;

let values: BillingConfigValues = { lockoutDays: DEFAULT_LOCKOUT_DAYS };

/**
 * Read `BILLING_LOCKOUT_DAYS` off an environment.
 *
 * A separate pure function rather than a branch inside `setBillingConfig`, so the parsing
 * rule is unit-testable and the caller stays one line. An unset, empty, non-numeric or
 * non-positive value falls back to 14: the var is documented as optional, and a typo that
 * silently locked every past-due subject on the first tick is worse than ignoring it.
 */
export function readLockoutDays(raw: string | undefined): number {
  // Floor before the guard, not after. `"0.5"` is finite and above zero, so testing first
  // would pass it through and `Math.floor` would hand the sweep a `lockoutDays` of 0 —
  // exactly the every-row lockout this fallback exists to prevent. `Math.floor(NaN)` is
  // `NaN`, so `Number.isFinite` still catches a non-numeric value.
  const days = Math.floor(Number(raw));
  if (!raw || !Number.isFinite(days) || days <= 0) {
    return DEFAULT_LOCKOUT_DAYS;
  }
  return days;
}

/**
 * Register the capability's config. Called once, at module load, by
 * `apps/api/src/billing-store.ts`. Calling it again replaces the values, which is what a
 * test wants and what nothing else should do.
 */
export function setBillingConfig(next: Partial<BillingConfigValues>): void {
  values = { ...values, ...next };
}

/** The registered config, or the defaults when nothing registered one. */
export function billingConfig(): BillingConfigValues {
  return values;
}

let providerEnv: BillingEnv | undefined;

/**
 * Register the Worker environment a provider's background work may read.
 *
 * The sibling of `setBillingConfig` above, and it exists for the same reason: a queue
 * handler is called as `(payload, ctx)` and gets no `env` (packages/queue/src/provider.ts),
 * and the core never reads `process.env`. `setBillingConfig` carries the one value the
 * *core* needs. A provider that owns a scheduled job needs its own keys, and the core must
 * not learn which ones those are — so the whole environment goes through, opaque, exactly as
 * `createBilling(env)` already hands it to every contract method (ADR 0040).
 *
 * Called once, at module load, by `apps/api/src/billing-store.ts`. Calling it again replaces
 * the value, which is what a test wants and what nothing else should do.
 */
export function setBillingProviderEnv(env: BillingEnv): void {
  providerEnv = env;
}

/**
 * The registered environment, for a provider's background work.
 *
 * Throws rather than answering an empty object. A job that read `{}` would see every key
 * unset and report the provider as unconfigured, which sends a reader looking for a missing
 * secret instead of the missing registration.
 */
export function billingProviderEnv(): BillingEnv {
  if (!providerEnv) {
    throw new Error(
      "No billing provider environment is registered. `apps/api/src/billing-store.ts` calls " +
        "`setBillingProviderEnv(env)` at module load; import that file before running a " +
        "provider's background job."
    );
  }
  return providerEnv;
}
