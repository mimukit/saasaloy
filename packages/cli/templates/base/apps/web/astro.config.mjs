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
  // Sessions off. Left unset, the Cloudflare adapter reads this key, decides sessions are
  // wanted, and writes a `SESSION` KV namespace binding with no id into the config it
  // generates at dist/client/wrangler.json — which is the config `wrangler deploy` actually
  // reads (see wrangler.jsonc). A prerendered marketing site stores no session, so that
  // would be a namespace to provision for nothing. Note this is Astro's own `session`, not
  // an adapter option; passing it to `cloudflare()` below does nothing.
  session: false,
  // `imageService: "compile"` optimises images during the build and serves the results
  // as plain assets. The adapter's default would reach for Cloudflare's IMAGES binding
  // at runtime, which needs a Worker this site does not have.
  //
  // package.json pins @cloudflare/vite-plugin, which this file never imports. The
  // adapter takes it through a caret range, and each release of the plugin raises the
  // wrangler version it demands at startup, so an unpinned install pairs a new plugin
  // with our pinned wrangler and `astro dev` exits before it is ready. The direct pin
  // makes pnpm install the same plugin for the adapter. Move it and `wrangler` together:
  // they release as a pair, and apps/api (once added) pins the same two versions.
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
    // Dev only: pre-bundle every dependency the React components import before the
    // first request. In dev the adapter renders inside workerd, and Vite's scan starts
    // from the pages, so it never walks into @repo/ui (a linked workspace, not an npm
    // package) or the islands a module drops in src/. Without these entries Vite finds
    // lucide-react, @base-ui/react and the rest mid-request, re-bundles, and reloads the
    // worker. The re-run components then import a fresh copy of react while
    // react-dom/server holds the old one, and every hook throws "Invalid hook call".
    // A glob, not an include list, so a component a module adds is covered with no edit
    // here.
    ssr: {
      optimizeDeps: {
        entries: ["src/**/*.tsx", "../../packages/ui/src/**/*.tsx"],
      },
    },
    resolve: {
      // `@web` mirrors saasaloy.json's alias of the same name (apps/web/src) — that
      // alias only drives the CLI's file-placement when a module's files[] target
      // `@web/...`; this is what makes the dropped source's own `@web/...` imports
      // (e.g. a dropped page importing @web/components/*) actually resolve.
      alias: { "@web": fileURLToPath(new URL("src", import.meta.url)) },
    },
  },
});
