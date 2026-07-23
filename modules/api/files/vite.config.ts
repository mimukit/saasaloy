import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// Builds and serves the Worker on the real `workerd` runtime (via `vite dev`),
// and reads bindings/entry from wrangler.jsonc. The route auto-registration in
// src/index.ts relies on Vite's `import.meta.glob`, which this build provides.
export default defineConfig({
  plugins: [cloudflare()],
});
