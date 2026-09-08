// The one number the capability reads out of the environment, and the port that carries it
// in. The third sibling of `./store.ts` and `./enqueue.ts`, for the same reason and by the
// same shape.
//
// `BILLING_LOCKOUT_DAYS` is needed by the daily lockout job, and a job handler gets
// `(payload, ctx)` and no `env` (packages/queue/src/provider.ts). The core also never reads
// `process.env` and holds no importable Workers env of its own, so it cannot look the value
// up itself. `apps/api/src/billing-store.ts` — the one file that already registers the store
// resolver and the enqueuer — reads it once at module load and calls `setBillingConfig`.

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
  const days = Number(raw);
  if (!raw || !Number.isFinite(days) || days <= 0) {
    return DEFAULT_LOCKOUT_DAYS;
  }
  return Math.floor(days);
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
