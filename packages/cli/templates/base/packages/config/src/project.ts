import type { ProjectOverride } from "./sections";

// This is the file you edit.
//
// Every other file in `packages/config` is owned by the base template or by a module, and
// `saasaloy update` may rewrite them. This one is yours: nothing overwrites it, so an
// override written here survives every update.
//
// What belongs here: a value your project checks into its repo and ships identically to
// every environment — the product name, the locale, a tier's display name, a role string.
//
// What does not: anything that differs between two deployments of this same project. An
// API origin, a database url, a Stripe key, a provider selection. Those are `.env` values,
// secret or not, and `config` deliberately cannot read one.
//
// The merge goes one level below the section. `app: { name: "..." }` replaces the name and
// keeps the rest of `app`; `app: { legal: { termsPath: "/legal/terms" } }` replaces the
// whole `legal` record, so name every path in it. A key that no installed section defines
// is a `typecheck` error, which is the whole reason this file is typed.
export const project: ProjectOverride = {
  app: {
    name: "{{PROJECT_NAME}}",
    // locale: "en-GB",
    // currencySymbol: "£",
  },
  // plans: {
  //   tiers: {
  //     free: { id: "free", name: "Starter" },
  //     pro: { id: "pro", name: "Studio" },
  //     enterprise: { id: "enterprise", name: "Enterprise" },
  //   },
  // },
};
