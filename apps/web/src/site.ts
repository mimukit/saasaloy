// The site's checked-in facts: the same in dev, in a preview and in production. This
// file replaces the base template's `@repo/config` and `@repo/env` for this app, because
// the public site has one deployment and calls no API, so it has no per-deployment value.
//
// A page reads the public origin as `Astro.site`. `siteOrigin` is for code that runs
// outside Astro, such as the agent prompts a remark plugin and a node:test file load.

/** The brand every block and page shows. */
export const siteName = "Saasaloy";

/** The BCP 47 tag `<html lang>` declares. */
export const locale = "en";

/** The source repository, which every GitHub link and the JSON-LD `sameAs` build on. */
export const repoUrl = "https://github.com/mimukit/saasaloy";

/** The public origin, which astro.config.mjs sets as `site`. Change wrangler.jsonc with it. */
export const siteOrigin = "https://saasaloy.com";
