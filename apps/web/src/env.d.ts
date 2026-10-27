// The build-time environment the site reads through `import.meta.env`. Astro inlines
// each value into the HTML when the page is prerendered, so nothing here reaches a
// runtime Worker.

interface ImportMetaEnv {
  /**
   * The Cloudflare Web Analytics site token. Layout.astro writes the beacon only when it
   * is set; unset, the page carries no analytics script. A `workers.dev` host has no
   * zone, so Cloudflare cannot inject the beacon itself.
   */
  readonly PUBLIC_CF_ANALYTICS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
