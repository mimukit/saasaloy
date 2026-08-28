import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Plain SPA build: Vite emits static assets into dist/ and wrangler.jsonc serves them
// with a single-page-application fallback. There is no Worker entry and no SSR — the
// admin app talks to apps/api over the credentialed CORS spine instead.
export default defineConfig({
  plugins: [
    // MUST run before the React plugin. It rewrites the route files (and generates
    // src/routeTree.gen.ts from src/routes/**) before React's JSX transform sees them;
    // reversed, the code-split rewrite lands on already-transformed output and the
    // generated tree goes stale.
    //
    // The generated tree is committed rather than ignored, so `tsc --noEmit` and a
    // fresh `pnpm build` work on a clean checkout before Vite has ever run. Do not
    // hand-edit it — add or delete a file under src/routes/ and let the plugin rewrite it.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    // Tailwind 4 is a Vite plugin. The theme, the tokens and the @source globs all live
    // in packages/ui/src/styles/globals.css, which src/main.tsx imports via
    // `@repo/ui/globals.css`. Do not declare a second entrypoint here.
    tailwindcss(),
  ],
  // `PUBLIC_` replaces Vite's default `VITE_` prefix, so the browser bundle only ever
  // inlines a variable a human deliberately named PUBLIC_*. It also unifies this app
  // with the waitlist module and apps/web, which already read `PUBLIC_API_URL` —
  // one env key spells the api origin for every consumer in the repo.
  envPrefix: "PUBLIC_",
  resolve: {
    // Mirrors saasaloy.json's `@admin` alias (apps/admin/src). That alias only drives
    // the CLI's file placement when a module's files[] target `@admin/...`; this entry
    // is what makes the dropped source's own `@admin/...` imports actually resolve.
    alias: { "@admin": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Fixed dev port. The api Worker's CORS allowlist and better-auth's `trustedOrigins`
  // both hardcode http://localhost:3001, so this port cannot be allowed to drift.
  // `strictPort` turns a busy port into a loud failure instead of a silent +1 that
  // later shows up as an unexplained CORS rejection. web is 3000, admin is 3001,
  // api is 4000.
  server: { port: 3001, strictPort: true },
});
