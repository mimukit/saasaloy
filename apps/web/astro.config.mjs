// @ts-check
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// `astro build` gets its own Vite cache. Both commands keep pre-bundled dependencies under
// node_modules/.vite, each stamped with a hash of the config that made them. The two
// hashes always differ, and Vite deletes a cache whose hash does not match. So a build
// run beside a live `astro dev` deletes the dev server's deps_ssr folder, and the next
// module the dev server loads from it fails with "The file does not exist at
// .../deps_ssr/<dep>.js which is in the optimize deps directory". A separate folder for
// the build keeps the two apart; dev keeps the default.
/** @returns {import("astro").AstroIntegration} the integration that moves the build cache */
function separateBuildCache() {
  return {
    name: "separate-build-cache",
    hooks: {
      "astro:config:setup": ({ command, updateConfig }) => {
        if (command === "build") {
          updateConfig({ vite: { cacheDir: "node_modules/.vite-build" } });
        }
      },
    },
  };
}

// Every React component the dev server can render, for Vite's dependency scan. See the
// `optimizeDeps` notes in `vite` below.
const COMPONENT_ENTRIES = ["src/**/*.tsx"];

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
// The public origin. Layout.astro builds each canonical URL, `og:url` and `og:image`
// from it as `Astro.site`, and src/pages/robots.txt.ts and sitemap.xml.ts do the same.
// The owner chose saasaloy.com on 2026-10-27 (docs/seo/0001-seo-saasaloy-com-2026-10-27.md).
export default defineConfig({
  site: "https://saasaloy.com",
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
  // they release as a pair.
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [react(), separateBuildCache()],
  // Fixed dev port, the same as a generated project's web app. `strictPort` makes a busy
  // port a loud failure instead of a silent +1.
  server: { port: 3000 },
  vite: {
    // Tailwind 4 is a Vite plugin, not an Astro integration — `@astrojs/tailwind` is EOL
    // and never supported v4. The theme lives in src/styles: the @source globs in
    // globals.css, the tokens in brand.css, and the landing utilities in web.css, which
    // imports brand.css and which Layout.astro imports via `@web/styles/web.css`.
    plugins: [tailwindcss()],
    server: { strictPort: true },
    // Dev only: pre-bundle every dependency the React components import before the
    // first request. In dev the adapter renders inside workerd, and Vite's scan starts
    // from the pages, so it never walks into the React blocks and components under src/.
    // Without these entries Vite finds
    // lucide-react, @base-ui/react and the rest mid-request, re-bundles, and reloads the
    // worker. The re-run components then import a fresh copy of react while
    // react-dom/server holds the old one, and every hook throws "Invalid hook call".
    // A glob, not an include list, so a new component is covered with no edit here.
    ssr: {
      optimizeDeps: { entries: COMPONENT_ENTRIES },
    },
    // The browser needs the same entries. Its scan reads an .astro page's <script> tags but
    // not the frontmatter that imports an island, so the islands' own dependencies arrive
    // mid-request. Vite re-bundles, renames the shared chunks, and deletes the ones the
    // page already asked for: "The file does not exist at .../deps/react-dom-<hash>.js
    // which is in the optimize deps directory", then a full reload.
    optimizeDeps: { entries: COMPONENT_ENTRIES },
    resolve: {
      // `@web` mirrors saasaloy.json's alias of the same name (apps/web/src) — that
      // alias only drives the CLI's file-placement when a module's files[] target
      // `@web/...`; this is what makes the dropped source's own `@web/...` imports
      // (e.g. a dropped page importing @web/components/*) actually resolve.
      alias: { "@web": fileURLToPath(new URL("src", import.meta.url)) },
    },
  },
});
