import { defineSection } from "../define";

// The one section the base owns. Everything here is a project-level fact that is the same
// in dev, in staging and in production: the product's name, the locale its HTML declares,
// and where its legal pages live.
//
// Words do not belong here. A sentence a reader sees lives in `packages/ui/src/content/`.

/** The base's `app` section. Override any leaf of it in `../project.ts`. */
export function app() {
  return defineSection("app", {
    /**
     * The product name. `siteName` in `@repo/ui` re-exports it, and emails read it. It
     * ships as "Saasaloy" because the default landing page describes Saasaloy itself, so
     * the name and the copy agree on a fresh project. Set yours in `../project.ts`.
     */
    name: "Saasaloy",
    /** The BCP 47 tag `<html lang>` declares. One string; translation is a separate job. */
    locale: "en",
    /**
     * Where the legal pages live. `apps/web` ships both, and the footer links them.
     * A nested record is replaced whole by an override, so name both paths when you
     * change one.
     */
    legal: { termsPath: "/terms", privacyPath: "/privacy" },
  });
}
