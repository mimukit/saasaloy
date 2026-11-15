import { defineSection } from "@repo/config/define";

// `cms`'s config section, installed by `saasaloy add cms` into
// `packages/config/src/sections/`. These are `config` values, not `env` values: two
// deployments of the same project agree on where the blog lives and what its feed is called
// (ADR 0052).
//
// The keys are flat on purpose. `project.ts` overrides one leaf below the section, so each
// value here can be changed alone.

/** The `cms` section. Override any key in `packages/config/src/project.ts`. */
export function cmsConfig() {
  return defineSection("cms", {
    /** The blog's URL prefix on `apps/web`. A post lives at `<basePath>/<slug>`. */
    basePath: "/blog",
    /** Posts per page on the blog index and in the public list route. */
    pageSize: 10,
    /** The RSS feed's channel title. */
    rssTitle: "Blog",
    /** The RSS feed's channel description. */
    rssDescription: "The latest posts.",
  });
}
