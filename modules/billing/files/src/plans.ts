import { definePlans } from "./define";

// The project's plans, in code. This is the file you edit: add a tier, add a feature flag,
// add a limit. Nothing seeds a table and nothing reads a plan back from a vendor.
//
// Exactly one plan carries no `providerIds`, and that one is the default — what a subject
// with no live subscription resolves to, and what a locked subject falls back to.
// `definePlans` throws at module load if that stops being true.
//
// `providerIds` maps a provider name to its price ids per interval. `billing-stripe` reads
// `providerIds.stripe.monthly` as the price id and `.yearly` as the annual one, and
// `trialDays` as the free-trial length. Fill them in from your Stripe dashboard; the empty
// strings below are placeholders and checkout refuses an empty price id.
//
// The landing page's `pricing-table` block keeps its own copy in `content/landing.ts`.
// Nothing patches one from the other, so change both when a price changes.
export const plans = definePlans([
  {
    features: { export: false, prioritySupport: false },
    id: "free",
    limits: { projects: 1, seats: 1 },
    name: "Free",
  },
  {
    features: { export: true, prioritySupport: true },
    id: "pro",
    limits: { projects: -1, seats: 10 },
    name: "Pro",
    providerIds: {
      stripe: { monthly: "", yearly: "" },
    },
    trialDays: 14,
  },
]);
