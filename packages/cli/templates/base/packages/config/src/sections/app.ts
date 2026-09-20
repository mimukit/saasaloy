import { defineSection } from "../define";

// The one section the base owns. Everything here is a project-level fact that is the same
// in dev, in staging and in production: the product's name, the locale its HTML declares,
// the currency symbol its prices are written in, and where its legal pages live.
//
// Words do not belong here. A sentence a reader sees lives in
// `packages/ui/src/content/`, and that file reads its numbers and ids back from config.
// The split is the rule: numbers and ids here, sentences there.

/** The base's `app` section. Override any leaf of it in `../project.ts`. */
export function app() {
  return defineSection("app", {
    /** The product name. `siteName` in `@repo/ui` re-exports it, and emails read it. */
    name: "Acme",
    /** The BCP 47 tag `<html lang>` declares. One string; translation is a separate job. */
    locale: "en",
    /** Prefixed to every price the pricing table renders. */
    currencySymbol: "$",
    /**
     * Where the legal pages live. `apps/web` ships both, and the footer links them.
     * A nested record is replaced whole by an override, so name both paths when you
     * change one.
     */
    legal: { termsPath: "/terms", privacyPath: "/privacy" },
  });
}
