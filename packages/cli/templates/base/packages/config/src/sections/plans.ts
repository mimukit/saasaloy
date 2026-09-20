import { defineSection } from "../define";

// The tier ids and display names, in one place, because two files need them and nothing
// reconciles them: the marketing pricing table in `packages/ui/src/content/landing.ts`
// and — once `billing` is installed — `packages/billing/src/plans.ts`.
//
// Ids and names only. A price, a feature bullet and a Stripe price id each stay where
// they were: a price is marketing copy in one file and a vendor object in the other, and
// unifying those is a different decision than giving the ids one home.

/** The base's `plans` section, keyed by tier slug. Override a name in `../project.ts`. */
export function plans() {
  return defineSection("plans", {
    /**
     * A record rather than an array, so a consumer reads `tiers.pro.id` instead of
     * indexing a position. An override replaces the whole record, so a project selling
     * different tiers writes all of them.
     */
    tiers: {
      free: { id: "free", name: "Free" },
      pro: { id: "pro", name: "Pro" },
      enterprise: { id: "enterprise", name: "Enterprise" },
    },
  });
}
