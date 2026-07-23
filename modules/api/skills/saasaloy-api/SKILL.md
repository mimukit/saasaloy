---
name: saasaloy-api
description: Runbook for the api capability — Hono on Cloudflare Workers with file-based route registration. Use when adding, changing, or debugging routes in apps/api, wiring bindings (c.env), running the Worker locally, or deploying it. Covers the routes/ auto-glob convention, the mount-relative path rule, and how features add their own wrangler bindings.
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

## Run it locally

```sh
pnpm --filter @repo/api dev       # vite dev → serves on workerd, hot-reloads routes
curl http://localhost:5173/health # → {"status":"ok"}
```

`vite dev` runs the actual Workers runtime, so local behavior matches the edge closely. Add a
route file and it appears on the next request with no restart of the config.

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
- **A new binding patches `wrangler.jsonc`**; it does not hand-edit another module's files.
