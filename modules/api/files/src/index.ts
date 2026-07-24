import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

// Bindings live on the Workers runtime and are threaded through Hono's context
// (`c.env`) — never `process.env`. Base `api` declares `CORS_ORIGINS` (below); a
// capability or feature that adds a D1/R2/KV/Queue binding extends this type and
// patches wrangler.jsonc.
export type Bindings = {
  CORS_ORIGINS?: string;
};

// Local dev origins for `apps/web` (Astro) and `apps/admin` (TanStack Router/Vite) —
// the keyless dev fallback so `wrangler dev`/`vite dev` works with zero config. Prod
// sets `CORS_ORIGINS` (comma-separated) explicitly; a misconfigured prod value fails
// visibly (CORS rejects the real origin) rather than silently falling back.
const DEV_ORIGINS = ["http://localhost:4321", "http://localhost:5173"];

const app = new Hono<{ Bindings: Bindings }>();

// Credentialed CORS lives in api's spine — every cross-origin caller (the admin SPA,
// the waitlist form on the marketing site, auth's cookie-based session) shares the
// same origin allowlist, so it's a property of api's topology, not any one consumer's.
// `auth`'s `trustedOrigins` reuses this same `CORS_ORIGINS` var (one list, two readers,
// no drift).
app.use(
  "*",
  cors({
    origin: (origin, c: Context<{ Bindings: Bindings }>) => {
      const configured = c.env.CORS_ORIGINS?.split(",")
        .map((o: string) => o.trim())
        .filter(Boolean);
      const allowed = configured && configured.length > 0 ? configured : DEV_ORIGINS;
      return origin && allowed.includes(origin) ? origin : null;
    },
    credentials: true,
  }),
);

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
