---
name: saasaloy-api
description: Runbook for the api capability — Hono on Cloudflare Workers with a statically chained, RPC-typed route table. Use when adding, changing, or debugging routes in apps/api, building a typed client with hc<AppType>, wiring bindings (c.env), logging from a route (c.get("log")), running the Worker locally, or deploying it. Covers the chained-route registration convention, the mount-relative path rule, explicit status codes, and how features add their own wrangler bindings.
---

# api — Hono on Cloudflare Workers

`apps/api` is the backend spine, shared by `web` and `admin`. It's a [Hono](https://hono.dev)
app running on Cloudflare Workers, built and served with Vite via `@cloudflare/vite-plugin` (so
`vite dev` runs the real `workerd` runtime locally). Its defining convention is the **statically
chained route table**: every mounted route is one `.route()` link in a single expression in
`src/index.ts`, and the type of that expression is exported as `AppType`.

The chain is what makes the api typed end to end. A client built with `hc<AppType>` reads every
path, request body, and per-status response shape straight off that type. A route discovered at
build time by scanning a folder carries none of that, which is why registration is an edit to the
chain rather than a file drop.

## The entry, in shape

```ts
// src/index.ts
export const base: Hono<{ Bindings: Bindings; Variables: Variables }> = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

base.use("*", cors({ /* … */ }));
base.use("*", /* request correlation — see Logging below */);

const app = base.route("/health", health);

export type AppType = typeof app;
export default app;
```

Two bindings, and the split between them is the point:

- **`base`** carries app-wide middleware and anything whose routes must stay opaque to the
  client, such as a catch-all auth handler. Its type annotation is written out on purpose. That
  freezes `base` at `Hono<{ Bindings: Bindings; Variables: Variables }>`, so mounting on it cannot widen `AppType`.
- **`app`** is the typed chain. Everything a caller should see through `hc` goes here.

## Add a route

Two steps. The handler is still a file; only its registration changed.

**1. Write `src/routes/<feature>.ts` as one chained expression**, default-exporting the sub-app:

```ts
// src/routes/widgets.ts  →  mounted at /widgets
import { Hono } from "hono";

const widgets = new Hono()
  .get("/", (c) => c.json({ widgets: [] }, 200)) //         GET  /widgets
  .post("/", (c) => c.json({ created: true }, 201)) //      POST /widgets
  .get("/:id", (c) => c.json({ id: c.req.param("id") }, 200)); // GET /widgets/:id

export default widgets;
```

**2. Add the link to the chain** in `src/index.ts`:

```ts
import widgets from "./routes/widgets";

const app = base.route("/health", health).route("/widgets", widgets);
```

A module does step 2 through a **`chained-route` patch** in its `registry-item.json`, not by hand:

```json
{
  "kind": "chained-route",
  "file": "apps/api/src/index.ts",
  "exportName": "default",
  "path": "/widgets",
  "call": "widgets",
  "import": { "name": "widgets", "from": "./routes/widgets" }
}
```

`saasaloy add` appends the link and its import; `saasaloy remove` takes both back out, leaving the
file byte-identical to its pre-add state. `exportName: "default"` resolves through
`export default app` to the `const app = …` declarator, so the chain is edited and the export line
is untouched. Use `exportName: "base"` for a handler that must stay out of `AppType`.

### Keep the chain unbroken

The chain is a type, not a style. These two are not equivalent:

```ts
const widgets = new Hono().get("/", handler); // ✅ the type carries GET /widgets
```

```ts
const widgets = new Hono();
widgets.get("/", handler); // ❌ `typeof widgets` forgot the route
```

The second form still serves the request at runtime and still typechecks. It just hands the
client an empty type, so `api.widgets.$get()` stops existing with no error anywhere in `apps/api`.
The same holds in `src/index.ts`: a route mounted with a bare `app.route(...)` statement is
invisible to `AppType`.

### Pass the status code explicitly

`c.json(body, 200)` and `c.json(body)` differ on the client. `hc` keys the response type by status,
so an omitted code leaves the caller with a looser type than the route actually has. Write the
code every time, on the success path as well as the error path.

### The one rule that trips people up: paths are relative to the mount

A route file is mounted at the `path` its chain link gives, so its internal paths are **relative to
that mount**:

- `widgets.get("/")` → `GET /widgets` ✅
- `widgets.get("/widgets")` → `GET /widgets/widgets` ❌ (double prefix)

Name the Hono instance after the file (`const widgets = new Hono()`) so the file reads clearly.
The folder is **flat**, one level of `routes/*.ts`. To nest, nest *inside* a sub-app
(`.route("/archived", archivedSub)`), not with subdirectories.

## The typed client

`apps/api` exposes one type-only export, `@repo/api/client`, which re-exports `AppType` and
nothing else. `package.json` maps it under a `types` condition alone, so there is no runtime entry
and the Worker never enters a browser bundle.

Each consumer owns its own three-line client:

```ts
import { hc } from "hono/client";
import type { AppType } from "@repo/api/client";

const api = hc<AppType>(import.meta.env.PUBLIC_API_URL ?? "http://localhost:4000");

const res = await api.health.$get();
const body = await res.json(); // { status: string }
```

A consumer needs `hono` and `@repo/api` in its `package.json`. A module that adds a caller adds
both through `package-json-dependency` patches.

### What a wide chain costs to typecheck

Measured 2026-08-28 on the reference dev box (6-core Intel Haswell container, Node 24.19.0,
TypeScript 7.0.2), with 30 synthetic routes generated alongside `health`. Each synthetic route
chains a `GET /`, a `GET /:id`, and a `zValidator("json", …)` `POST /`, so the numbers include zod
inference rather than bare handlers.

| What | 1 route | 31 routes |
|---|---|---|
| `apps/api` alone (`tsc --noEmit`) | **0.59 s** | **1.02 s** |
| Whole project (`pnpm exec turbo run typecheck --force`) | **6.6 s** | **7.2 s** |

Roughly **14 ms per route**, and adding a file that calls `hc<AppType>` against the 31-route chain
cost nothing measurable on top (1.05 s). Reproduce it by generating the routes and their chain
links in `apps/api`, then timing `tsc --noEmit` in that workspace.

So a single shared `AppType` is the right default, and it stays right well past the route count any
of these projects has. If a chain ever does get expensive, the mitigation is a **per-feature
client**: export a narrower type for one slice of the chain and point that feature's `hc` at it,
rather than splitting the api. Reach for it on a measured number, not a hunch.

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

Adding a binding is a structural edit to `api`'s scaffold, the same class of edit as adding a link
to the chain.

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

const widgets = new Hono<{ Variables: LoggerVariables }>().post("/", async (c) => {
  const log = c.get("log");
  log.info("creating widget", { plan: "pro" }); // → one line, carrying this request's requestId
  try {
    // …
  } catch (err) {
    log.error("widget creation failed", { err }); // `err` is serialized, not `{}`
    throw err;
  }
  return c.json({ ok: true }, 201);
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

`vite dev` runs the actual Workers runtime, so local behavior matches the edge closely. Editing a
route file is picked up on the next request with no restart.

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

`src/index.ts` mounts credentialed `hono/cors` on `base` for the whole app: the `origin` callback
reflects the caller's origin only if it's in `CORS_ORIGINS` (comma-separated) or, when that's
unset, in `DEV_ORIGINS`. It never answers `*`, because `credentials: true` and `*` are
incompatible.

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

- **Register a route with a `chained-route` patch**, not a file drop. The entry is edited on
  purpose, and `saasaloy remove` reverses the edit.
- **Build every sub-app as one unbroken chain.** A statement-per-route file typechecks and serves
  correctly while handing the client an empty type.
- **Pass the status code to `c.json`** on every path, success included.
- **One route file = one mounted prefix**, named after the file. Keep the folder flat.
- **Internal paths are mount-relative** (`get("/")` for the index of the mount).
- **Mount on `base`, not on the chain**, when a handler must stay out of `AppType`.
- **`c.env` for bindings, never `process.env`.**
- **`c.get("log")` for logging, never `console.log`** — a bare console call is unlevelled and
  uncorrelated, and it bypasses redaction.
- **A new binding patches `wrangler.jsonc`**; it does not hand-edit another module's files.
- **Request validation belongs in `@repo/validators`**, not in an inline schema in the route.
