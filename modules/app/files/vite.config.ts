import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { devPort } from "@repo/env/dev-port";
import { devGzip, restartOnLockfile } from "@repo/tooling/vite";
import { defineConfig, loadEnv } from "vite";

// Plain SPA build: Vite emits static assets into dist/ and wrangler.jsonc serves them
// with a single-page-application fallback. There is no Worker entry and no SSR — the
// customer app talks to apps/api over the credentialed CORS spine instead.
const ENV_LOCAL = "apps/app/.env.local";

export default defineConfig(({ mode }) => ({
  plugins: [
    // MUST run before the React plugin. It rewrites the route files (and generates
    // src/routeTree.gen.ts from src/routes/**) before React's JSX transform sees them;
    // reversed, the code-split rewrite lands on already-transformed output and the
    // generated tree goes stale.
    //
    // The generated tree is committed rather than ignored, so `tsc --noEmit` and a
    // fresh `pnpm build` work on a clean checkout before Vite has ever run. Do not
    // hand-edit it — add or delete a file under src/routes/ and let the plugin rewrite it.
    // `quoteStyle` and `semicolons` match Prettier's output. The generator defaults to single
    // quotes and no semicolons, which made every build rewrite the committed file and dirty
    // the tree. `.prettierignore` lists the file too, so a format pass leaves it alone.
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      quoteStyle: "double",
      semicolons: true,
    }),
    react(),
    // Tailwind 4 is a Vite plugin. The theme lives in packages/ui: the @source globs in
    // src/styles/globals.css, this app's stylesheet in src/styles/app.css, which
    // src/main.tsx imports via `@repo/ui/styles/app.css`. Do not declare a second
    // entrypoint here.
    tailwindcss(),
    // Dev only. `devGzip()` compresses what the dev server sends, which matters when the
    // app is opened from another machine. `restartOnLockfile()` restarts the server after
    // an install, so a package added while it runs resolves on the next reload.
    devGzip(),
    restartOnLockfile(),
  ],
  // `PUBLIC_` replaces Vite's default `VITE_` prefix, so the browser bundle only ever
  // inlines a variable a human deliberately named PUBLIC_*. It also unifies this app
  // with the waitlist module and apps/web, which already read `PUBLIC_API_URL` —
  // one env key spells the api origin for every consumer in the repo.
  envPrefix: "PUBLIC_",
  resolve: {
    // Mirrors saasaloy.json's `@app` alias (apps/app/src). That alias only drives the
    // CLI's file placement when a module's files[] target `@app/...`; this entry is what
    // makes the dropped source's own `@app/...` imports actually resolve.
    alias: { "@app": fileURLToPath(new URL("src", import.meta.url)) },
  },
  // The dev port is `DEV_PORT` from this workspace's `.env.local`, which `pnpm dev:ports`
  // writes: a per-worktree port in a linked worktree, 3002 in the main checkout. Unset,
  // it falls back to 3002; a bad value fails here, naming the file. The api's
  // `CORS_ORIGINS` and auth's trusted origins come from the same run, so the port and the
  // allow-lists move together. `strictPort` turns a busy port into a loud failure
  // instead of a silent +1 that later shows up as an unexplained CORS rejection.
  server: {
    port: devPort(
      loadEnv(mode, process.cwd(), "DEV_PORT").DEV_PORT,
      3002,
      ENV_LOCAL
    ),
    strictPort: true,
  },
}));
