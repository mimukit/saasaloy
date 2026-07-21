// @ts-check
import { defineConfig } from "astro/config";

// Static output — the marketing site is content-first and ships to Cloudflare as
// Workers static assets (see wrangler.jsonc). No SSR adapter needed for the base;
// an `add api`/`add admin` module introduces server runtime where it's actually used.
export default defineConfig({
  site: "https://example.com",
});
