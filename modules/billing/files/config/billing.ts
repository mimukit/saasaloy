import { defineSection } from "@repo/config/define";

// `billing`'s config section, installed by `saasaloy add billing` (#154).
//
// It lands in `packages/config/src/sections/`, beside every other module's section, because
// `@repo/config` imports nothing and so everything may import it. The helper comes in by
// package subpath (`@repo/config/define`) rather than by relative path.
//
// What is *not* here: a Stripe key, a webhook secret, the provider selection. Those differ
// between two deployments of this same project, which makes them `env` values — see the
// `envVars` block of this module's descriptor.

/** The `billing` section. Override it in `packages/config/src/project.ts`. */
export function billingConfigSection() {
  return defineSection("billing", {
    /**
     * What the three billing emails call this project — the trial reminder, the
     * payment-failed notice and the account-locked notice.
     *
     * Empty means "use `config.app.name`", which is what almost every project wants and
     * the reason this is not a second copy of the product name. Set it only when billing
     * mail should sign itself differently from the product, e.g. `"Acme Billing"`.
     *
     * A section never reads another section: the two are composed side by side, so the
     * fallback is applied where the value is used (`apps/api/src/billing-store.ts`).
     */
    appName: "",
  });
}
