import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { THEME_INIT_SCRIPT } from "@repo/ui/lib/theme";
import { defineConfig, type Plugin } from "vite";

// Pre-paint theme resolution for the SPA. index.html holds no theme code at all —
// Vite only substitutes `%VITE_*%` env values in that file, so it cannot reach a
// TypeScript constant, and this plugin is the supported way in (see the note on
// THEME_INIT_SCRIPT in @repo/ui/lib/theme).
//
// `head-prepend` puts it before the stylesheet link and the entry module, so it runs
// synchronously during head parsing and `<html>` carries `data-theme` before the first
// paint. Two rules this must keep: never `type: "module"` (module scripts are deferred
// by specification and always run after first paint, which is the flash this prevents),
// and never a pasted copy of the script body (it would drift from @repo/ui's).
function themeInit(): Plugin {
  return {
    name: "admin:theme-init",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          children: THEME_INIT_SCRIPT,
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [
    // File-based routing: the plugin globs src/routes/ and regenerates
    // src/routeTree.gen.ts on every dev start and build. A feature module adds a page
    // by dropping one file into src/routes/ — nothing here is edited, and nothing
    // patches the router.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    // Tailwind 4 is a Vite plugin. The token set and @source globs live in
    // packages/ui/src/styles/globals.css, imported through @repo/ui/globals.css; that
    // file's `apps/**` glob already covers this app's sources.
    tailwindcss(),
    themeInit(),
  ],
  resolve: {
    // `@admin` mirrors saasaloy.json's alias of the same name (apps/admin/src). The
    // alias there drives the CLI's file placement when a module targets `@admin/...`;
    // this is what makes the dropped source's own `@admin/...` imports resolve at
    // build time. apps/web does the same for `@web` in astro.config.mjs.
    alias: { "@admin": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Fixed dev port. The api Worker's CORS allowlist and auth's `trustedOrigins` both
  // hardcode http://localhost:3001 for this app, so the port cannot be allowed to
  // drift. `strictPort` turns a busy port into a loud failure instead of a silent +1
  // that later shows up as an unexplained CORS rejection. web is 3000, api is 4000.
  server: { port: 3001, strictPort: true },
});
