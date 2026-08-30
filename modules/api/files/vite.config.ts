import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// Builds and serves the Worker on the real `workerd` runtime (via `vite dev`),
// and reads bindings/entry from wrangler.jsonc. Routes are static imports chained
// in src/index.ts, so nothing here has to resolve them at build time.
export default defineConfig({
  plugins: [cloudflare()],
  // Fixed dev port, matching `dev.port` in wrangler.jsonc — `vite dev` and
  // `wrangler dev` serve the same Worker on the same URL, so nothing downstream has
  // to care which one is running. `strictPort` matters more than the number itself:
  // Vite's default is to silently take the next free port, and a shifted api port
  // shows up as an unexplained CORS failure rather than an obvious "port in use".
  // web is 3000 (see apps/web), api is 4000.
  //
  // `cors: false` turns Vite's own dev CORS middleware off so the Worker's
  // `hono/cors` is the only thing answering. Vite's middleware terminates every
  // OPTIONS preflight itself and never emits `Access-Control-Allow-Credentials`,
  // which breaks any `credentials: "include"` fetch under `vite dev` even though
  // the same request works under `wrangler dev`. It also reflects every loopback
  // origin, so the allowlist looked wider than it is. Off, both dev paths behave
  // identically.
  server: { cors: false, port: 4000, strictPort: true },
});
