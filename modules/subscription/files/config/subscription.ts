import { defineSection } from "@repo/config/define";

// `subscription`'s config section, installed by `saasaloy add subscription` (#154).
//
// It lands in `packages/config/src/sections/`, beside every other module's section, because
// `@repo/config` imports nothing and so everything may import it. The helper comes in by
// package subpath (`@repo/config/define`) rather than by relative path.
//
// `lockoutDays` was the `SUBSCRIPTION_LOCKOUT_DAYS` env var until #162. Two deployments of
// one project give a past-due customer the same grace, so it is checked in here.
//
// What is *not* here: a Stripe key, a webhook secret, the provider selection. Those differ
// between two deployments of this same project, which makes them `env` values — see the
// `envVars` block of this module's descriptor.

/** The `subscription` section. Override it in `packages/config/src/project.ts`. */
export function subscriptionConfigSection() {
  return defineSection("subscription", {
    /**
     * What the three subscription emails call this project — the trial reminder, the
     * payment-failed notice and the account-locked notice.
     *
     * Empty means "use `config.app.name`", which is what almost every project wants and
     * the reason this is not a second copy of the product name. Set it only when subscription
     * mail should sign itself differently from the product, e.g. `"Acme Subscription"`.
     *
     * A section never reads another section: the two are composed side by side, so the
     * fallback is applied where the value is used (`apps/api/src/subscription-store.ts`).
     */
    appName: "",
    /**
     * Days a subscription may stay `past_due` before the daily sweep sets `lockedAt` and
     * the subject drops to the default plan. The `payment-failed` email names the date
     * this gives.
     *
     * What a change costs: a longer window lets a customer whose card keeps failing use
     * the paid plan for free that much longer; a shorter one cuts off a customer whose
     * vendor retry would have succeeded. The sweep applies a change to every row at its
     * next run, including rows already past due, so dropping the number can lock many
     * subjects in one night. A whole number above zero: `0` locks every `past_due` row on
     * the next sweep.
     */
    lockoutDays: 14,
  });
}
