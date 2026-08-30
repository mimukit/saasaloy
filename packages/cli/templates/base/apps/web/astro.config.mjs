// @ts-check
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
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
  // Fixed dev port. Every cross-origin consumer in this repo — the api Worker's CORS
  // allowlist, auth's `trustedOrigins`, the waitlist form's `PUBLIC_API_URL` fallback —
  // hardcodes the localhost dev origins, so the port cannot be allowed to drift.
  // `strictPort` makes a busy port a loud failure instead of a silent +1 that turns
  // into a mystery CORS rejection. web is 3000, api is 4000 (see apps/api).
  server: { port: 3000 },
  vite: {
    // Tailwind 4 is a Vite plugin, not an Astro integration — `@astrojs/tailwind` is EOL
    // and never supported v4. The theme itself (tokens, @source globs) lives in
    // packages/ui/src/styles/globals.css, which Layout.astro imports via @repo/ui.
    plugins: [tailwindcss()],
    server: { strictPort: true },
    resolve: {
      // `@web` mirrors saasaloy.json's alias of the same name (apps/web/src) — that
      // alias only drives the CLI's file-placement when a module's files[] target
      // `@web/...`; this is what makes the dropped source's own `@web/...` imports
      // (e.g. a sections/*.astro importing @web/components/*) actually resolve.
      alias: { "@web": fileURLToPath(new URL("src", import.meta.url)) },
    },
  },
});
