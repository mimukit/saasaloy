import { config } from "@repo/config";
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
// The tier ids and names come from `config.plans`, which the landing page's pricing table
// reads too — so an id can no longer drift between the marketing page and the biller.
// Prices still live in both places and nothing reconciles them: a marketing price is copy in
// `content/landing.ts`, a charged price is a Stripe price id below.
export const plans = definePlans([
  {
    features: { export: false, prioritySupport: false },
    id: config.plans.tiers.free.id,
    limits: { projects: 1, seats: 1 },
    name: config.plans.tiers.free.name,
  },
  {
    features: { export: true, prioritySupport: true },
    id: config.plans.tiers.pro.id,
    limits: { projects: -1, seats: 10 },
    name: config.plans.tiers.pro.name,
    providerIds: {
      stripe: { monthly: "", yearly: "" },
    },
    trialDays: 14,
  },
]);
