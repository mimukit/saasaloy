import { Hono } from "hono";

// Bindings live on the Workers runtime and are threaded through Hono's context
// (`c.env`) — never `process.env`. Base `api` declares none; a capability or feature
// that adds a D1/R2/KV/Queue binding extends this type and patches wrangler.jsonc.
export type Bindings = {};

const app = new Hono<{ Bindings: Bindings }>();

// File-based route registration. Every module in ./routes default-exports a Hono
// sub-app named after its service; `import.meta.glob` resolves them to static imports
// at build time (Workers has no runtime filesystem), and each mounts at `/<basename>`.
// So dropping `routes/<feature>.ts` adds `/<feature>` with no edit to this file.
const routes = import.meta.glob<{ default: Hono }>("./routes/*.ts", {
  eager: true,
});

for (const [path, module] of Object.entries(routes)) {
  const name = path.match(/\.\/routes\/(.+)\.ts$/)?.[1];
  if (name) app.route(`/${name}`, module.default);
}

export default app;
