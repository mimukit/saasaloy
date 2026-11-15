import { cloudflare } from "@cloudflare/vite-plugin";
import { devPort } from "@repo/env/dev-port";
import { restartOnLockfile } from "@repo/tooling/vite";
import { defineConfig, loadEnv } from "vite";

// Builds and serves the Worker on the real `workerd` runtime (via `vite dev`),
// and reads bindings/entry from wrangler.jsonc. Routes are static imports chained
// in src/index.ts, so nothing here has to resolve them at build time.

const ENV_LOCAL = "apps/api/.env.local";

export default defineConfig(({ mode }) => ({
  // `restartOnLockfile()` restarts the dev server after an install, so a package added
  // while it runs resolves on the next request. Dev only.
  plugins: [cloudflare(), restartOnLockfile()],
  // The dev port is `DEV_PORT` from this workspace's `.env.local`, which `pnpm dev:ports`
  // writes: a per-worktree port in a linked worktree, 4000 in the main checkout. Unset, it
  // falls back to 4000, the `dev.port` in wrangler.jsonc, so `vite dev` and `wrangler dev`
  // serve the same Worker on the same URL. A bad value fails here, naming the file.
  // `strictPort` matters more than the number: Vite's default is to take the next free
  // port, and a shifted api port shows up as an unexplained CORS failure rather than an
  // obvious "port in use".
  //
  // `cors: false` turns Vite's own dev CORS middleware off so the Worker's
  // `hono/cors` is the only thing answering. Vite's middleware terminates every
  // OPTIONS preflight itself and never emits `Access-Control-Allow-Credentials`,
  // which breaks any `credentials: "include"` fetch under `vite dev` even though
  // the same request works under `wrangler dev`. It also reflects every loopback
  // origin, so the allowlist looked wider than it is. Off, both dev paths behave
  // identically.
  server: {
    cors: false,
    port: devPort(
      loadEnv(mode, process.cwd(), "DEV_PORT").DEV_PORT,
      4000,
      ENV_LOCAL
    ),
    strictPort: true,
  },
}));
