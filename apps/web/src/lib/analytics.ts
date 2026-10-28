// The Cloudflare Web Analytics site token, read once at build time. Layout.astro writes
// the beacon only when it is set, and the footer claims analytics only then, so the page
// never names a tracker it does not load. `site.yml` passes it from a repository variable
// once the deploy job exists (plan 0091, Phase 2).

/** The token, or undefined when the build has none. */
export const analyticsToken: string | undefined =
  import.meta.env.PUBLIC_CF_ANALYTICS_TOKEN?.trim() || undefined;
