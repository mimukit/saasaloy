import { definePlans } from "../billing/files/src/define";

// Test-only resolution shim; see ./provider.ts for why the shims exist at all. Not shipped:
// the descriptor's `files` list names `files/bkash-personal.ts` and nothing else.
//
// This one does not re-export `modules/billing/files/src/plans.ts`, and the other two do.
// The reason is that the provider under test reads a **BDT price** off the plan, and the
// template's own plan table is priced for Stripe: its paid tier carries `providerIds` and a
// trial, and no `price` at all. So the table below is the fixture, built with the real
// `definePlans` so every rule the capability enforces is enforced here too.
export const plans = definePlans([
  { id: "free", name: "Free" },
  {
    id: "pro",
    name: "Pro",
    // 499.00 BDT a month and 4,990.00 a year, in poisha.
    price: {
      monthly: { amount: 49_900, currency: "BDT" },
      yearly: { amount: 499_000, currency: "BDT" },
    },
  },
  {
    id: "trial",
    name: "Trial",
    price: { monthly: { amount: 49_900, currency: "BDT" } },
    trialDays: 14,
  },
  {
    // Priced for one interval only, so the "no price for this interval" branch has a plan
    // to take. A trial plan cannot stand in: it never reaches the price check at all.
    id: "monthly-only",
    name: "Monthly only",
    price: { monthly: { amount: 49_900, currency: "BDT" } },
  },
  {
    id: "dollars",
    name: "Dollars",
    price: { monthly: { amount: 4900, currency: "USD" } },
  },
]);
