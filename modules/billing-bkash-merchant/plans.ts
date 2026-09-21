import { definePlans } from "../billing/files/src/define";

// Test-only resolution shim; see ./provider.ts for why the shims exist at all. Not shipped:
// the descriptor's `files` list names `files/bkash-merchant.ts` and nothing else.
//
// This one does not re-export `modules/billing/files/src/plans.ts`, and the others do. The
// reason is the one `modules/billing-sslcommerz/plans.ts` records: the provider under test
// reads a **BDT price** off the plan, and the template's own plan table is priced for Stripe.
// So the table below is the fixture, built with the real `definePlans` so every rule the
// capability enforces is enforced here too.
//
// Four plans, one per branch the provider takes: the default, a plan priced in BDT, a plan
// that carries a trial and therefore never reaches the gateway, and a plan priced in a
// currency bKash does not settle.
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
    id: "dollars",
    name: "Dollars",
    price: { monthly: { amount: 4900, currency: "USD" } },
  },
]);
