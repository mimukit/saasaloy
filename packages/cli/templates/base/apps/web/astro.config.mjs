// @ts-check
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

// Static output — the marketing site is content-first and ships to Cloudflare as
// Workers static assets (see wrangler.jsonc). No SSR adapter needed for the base;
// an `add api`/`add admin` module introduces server runtime where it's actually used.
//
// The React integration ships in the base template itself (not per-feature) — every
// downstream module (waitlist, admin, ui components) needs `.tsx` islands sooner or
// later, so it's set up once here rather than patched in repeatedly.
export default defineConfig({
  site: "https://example.com",
  integrations: [react()],
  vite: {
    resolve: {
      // `@web` mirrors saasaloy.json's alias of the same name (apps/web/src) — that
      // alias only drives the CLI's file-placement when a module's files[] target
      // `@web/...`; this is what makes the dropped source's own `@web/...` imports
      // (e.g. a sections/*.astro importing @web/components/*) actually resolve.
      alias: { "@web": fileURLToPath(new URL("./src", import.meta.url)) },
    },
  },
});
