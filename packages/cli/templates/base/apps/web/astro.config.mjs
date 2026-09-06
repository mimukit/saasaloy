// @ts-check
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Static output — the marketing site is content-first, and every page here is
// prerendered at build time. `output: "static"` is written out rather than left to the
// default so the next person changing this file has to mean it.
//
// The Cloudflare adapter is registered anyway, and src/pages/500.astro is why. Astro
// only treats a 500 page as an error handler when an adapter is present; without one it
// is an ordinary page nothing ever routes to. The adapter also means the first page a
// module drops in with `prerender = false` runs on demand with no config change and
// inherits that same 500 screen.
//
// Registering it costs no Worker while everything is prerendered: the adapter builds in
// assets-only mode, emits no server entry, and moves the site to dist/client. That move
// is why wrangler.jsonc points `assets.directory` there — read its comment before you
// change either file.
//
// The React integration ships in the base template itself (not per-feature) — every
// downstream module (waitlist, admin, ui components) needs `.tsx` islands sooner or
// later, so it's set up once here rather than patched in repeatedly.
export default defineConfig({
  site: "https://example.com",
  output: "static",
  // `imageService: "compile"` optimises images during the build and serves the results
  // as plain assets. The adapter's default would reach for Cloudflare's IMAGES binding
  // at runtime, which needs a Worker this site does not have.
  adapter: cloudflare({ imageService: "compile" }),
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
      // (e.g. a dropped page importing @web/components/*) actually resolve.
      alias: { "@web": fileURLToPath(new URL("src", import.meta.url)) },
    },
  },
});
