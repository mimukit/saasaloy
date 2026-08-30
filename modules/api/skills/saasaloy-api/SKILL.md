---
name: saasaloy-api
description: Runbook for the api capability — Hono on Cloudflare Workers with file-based route registration. Use when adding, changing, or debugging routes in apps/api, wiring bindings (c.env), logging from a route (c.get("log")), running the Worker locally, or deploying it. Covers the routes/ auto-glob convention, the mount-relative path rule, and how features add their own wrangler bindings.
---

# api — Hono on Cloudflare Workers

`apps/api` is the backend spine, shared by `web` and `admin`. It's a [Hono](https://hono.dev)
app running on Cloudflare Workers, built and served with Vite via `@cloudflare/vite-plugin` (so
`vite dev` runs the real `workerd` runtime locally). Its defining convention is **file-based route
registration**: a route is a file you drop into `src/routes/`, never an edit to the entry.

## Add a route (the core convention)

Create `src/routes/<feature>.ts` that **default-exports a Hono sub-app named after the service**:

```ts
// src/routes/widgets.ts  →  mounted at /widgets
import { Hono } from "hono";

const widgets = new Hono();

widgets.get("/", (c) => c.json({ widgets: [] })); // GET  /widgets
widgets.post("/", (c) => c.json({ created: true })); // POST /widgets
widgets.get("/:id", (c) => c.json({ id: c.req.param("id") })); // GET  /widgets/:id

export default widgets;
```

That's the whole step. `src/index.ts` uses `import.meta.glob("./routes/*.ts", { eager: true })`
to discover every route file **at build time** (Workers has no runtime filesystem) and mounts each
under `/<basename>`. Nothing in the entry is edited when you add a route.

### The one rule that trips people up: paths are relative to the mount

A route file is mounted at `/<filename>`, so its internal paths are **relative to that mount**:

- `widgets.get("/")` → `GET /widgets` ✅
- `widgets.get("/widgets")` → `GET /widgets/widgets` ❌ (double prefix)

Name the Hono instance after the file (`const widgets = new Hono()`) so the file reads clearly.
Folder is **flat** — one level of `routes/*.ts`. To nest, nest *inside* a sub-app
(`widgets.route("/archived", archivedSub)`), not with subdirectories.

## Bindings: use `c.env`, never `process.env`

Cloudflare bindings (D1, R2, KV, Queues, secrets) arrive on the Worker's `env` and are threaded
through Hono context as `c.env`. Never reach for `process.env` — it doesn't exist on Workers.

```ts
const app = new Hono<{ Bindings: { DB: D1Database } }>();
app.get("/", (c) => c.env.DB.prepare("select 1").first());
```

Base `api` ships **zero bindings**. A capability or feature that needs one:

1. **Patches `wrangler.jsonc`** to add its binding (via the jsonc-parser patch engine) — e.g. a
   `d1_databases` entry from `database`, an `r2_buckets` entry from `storage`.
2. **Extends the `Bindings` type** where its code reads the binding.

Adding a binding is the one genuinely structural edit to `api`'s scaffold; everything else is a
pure file-drop into `routes/`.

## Logging: `c.get("log")`, never `console.log`

`api` depends on `logger`, so every project gets `packages/logger` and the `logger-console`
provider from `saasaloy add api` — nothing to install, nothing to wire. `src/index.ts` mounts a
correlation middleware right after CORS that binds a request id to a child logger and puts it on
the context:

```ts
const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
c.set("log", createLogger(c.env).child({ requestId }));
```

Read it in a route with `c.get("log")`. Compose `LoggerVariables` into the sub-app's generic so
it's typed — the same move `database` asks for with `DbBindings`, and for the same reason: a route
can't import the entry's types without creating a cycle.

```ts
// src/routes/widgets.ts
import { Hono } from "hono";
import type { LoggerVariables } from "@repo/logger";

const widgets = new Hono<{ Variables: LoggerVariables }>();

widgets.post("/", async (c) => {
  const log = c.get("log");
  log.info("creating widget", { plan: "pro" }); // → one line, carrying this request's requestId
  try {
    // …
  } catch (err) {
    log.error("widget creation failed", { err }); // `err` is serialized, not `{}`
    throw err;
  }
  return c.json({ ok: true });
});

export default widgets;
```

Every line from one request shares its `requestId`, so a single query in Workers Logs reconstructs
the whole request. The message comes **first** and the structured data second — `log.info(msg,
fields?)` — and the fields are what get indexed, so put values in `fields` rather than
interpolating them into the message.

`createLogger(c.env)` (from `@repo/logger`) is the uncorrelated escape hatch for code that runs
outside a request — a module-scope singleton, a scheduled handler, a queue consumer. Inside a
route, prefer `c.get("log")`; a fresh `createLogger` there loses the request id.

`LOG_LEVEL` sets the threshold (default `info`), and `wrangler.jsonc`'s `observability` block is
what makes the output queryable in the dashboard — `head_sampling_rate` is its cost dial. The
`saasaloy-logger` skill covers levels, redaction, reading logs, and writing another provider.

## Request validation lives in `@repo/validators`

A route does not define its own input shape inline. The schema belongs in `packages/validators`
(`@repo/validators/<feature>`), which the `validators` capability scaffolds, and the route wraps it
with `zValidator` from `@hono/zod-validator`. `c.req.valid("json")` then carries the inferred type
into the handler, with the target matching the one `zValidator` was given. Error bodies use the
shared `{ error: { code, message } }` envelope from `@repo/validators/common`. See the
`saasaloy-validators` skill for the full convention.

Keep the three layers apart: request shapes in `@repo/validators`, database column shapes in
`packages/db`, HTTP wiring here in `apps/api`.

## Run it locally

```sh
pnpm --filter @repo/api dev       # vite dev → serves on workerd, hot-reloads routes
curl http://localhost:4000/health # → {"status":"ok"}
```

`vite dev` runs the actual Workers runtime, so local behavior matches the edge closely. Add a
route file and it appears on the next request with no restart of the config.

## Ports are fixed, on purpose

| Service | Port | Pinned in |
|---|---|---|
| `apps/web` (Astro) | **3000** | `astro.config.mjs` (`server.port` + `vite.server.strictPort`) |
| `apps/admin` (future) | **3001** | reserved in `DEV_ORIGINS` |
| `apps/api` (Worker) | **4000** | `vite.config.ts` (`server.port` + `strictPort`) and `wrangler.jsonc` (`dev.port`) |

Frontends take 3xxx, backends 4xxx. These aren't cosmetic: `DEV_ORIGINS` in `src/index.ts` (and
`auth`'s `trustedOrigins`, and `waitlist`'s `PUBLIC_API_URL` fallback) hardcode them as the
keyless dev fallback, so a drifting port turns into a CORS rejection that looks like a code bug.
`strictPort` makes a busy port fail loudly instead of quietly shifting to the next one.

Because `wrangler.jsonc` pins the same `4000`, `wrangler dev` is a drop-in swap for the Vite loop.

## CORS lives here, in the spine

`src/index.ts` mounts credentialed `hono/cors` for the whole app: the `origin` callback reflects
the caller's origin only if it's in `CORS_ORIGINS` (comma-separated) or, when that's unset, in
`DEV_ORIGINS`. It never answers `*`, because `credentials: true` and `*` are incompatible.

**Keep `server.cors: false` in `vite.config.ts`.** Vite's own dev CORS middleware otherwise
intercepts CORS in two ways that both mislead: it reflects `Access-Control-Allow-Origin` for
*every* loopback origin (Vite 8's default `server.cors.origin` is a localhost regex), so a
disallowed `http://localhost:9999` looks allowed; and it **terminates every `OPTIONS` preflight
itself** without emitting `Access-Control-Allow-Credentials`, which breaks any
`credentials: "include"` fetch under `vite dev` while the identical request works under
`wrangler dev`. With the middleware off, `hono/cors` is the only responder and both dev paths
agree.

```sh
curl -i -H 'Origin: http://localhost:3000' http://localhost:4000/health # → header reflected
curl -i -H 'Origin: http://localhost:9999' http://localhost:4000/health # → no ACAO header
```

## Deploy

`api` owns **no** deploy step — it ships only its own `wrangler.jsonc` (this service's config).
Deployment of all services is centralized in the future **`infra`** capability (IaC). The
`deploy` script (`wrangler deploy`) exists for local/manual use, but production deploys are
`infra`'s job, not this module's.

## Conventions to honor

- **Never edit `src/index.ts` to register a route** — drop a `routes/*.ts` file; the glob finds it.
- **One route file = one mounted prefix**, named after the file. Keep the folder flat.
- **Internal paths are mount-relative** (`get("/")` for the index of the mount).
- **`c.env` for bindings, never `process.env`.**
- **`c.get("log")` for logging, never `console.log`** — a bare console call is unlevelled and
  uncorrelated, and it bypasses redaction.
- **A new binding patches `wrangler.jsonc`**; it does not hand-edit another module's files.
- **Request validation belongs in `@repo/validators`**, not in an inline schema in the route.
