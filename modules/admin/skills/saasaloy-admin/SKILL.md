---
name: saasaloy-admin
description: Runbook for the admin capability — a role-gated TanStack Router + Vite SPA in apps/admin. Use when adding an admin screen, wiring the typed hc<AppType> client and TanStack Query, gating a new admin api route with requireAdmin, changing the admin-role guard or the login screen, debugging the :3001 → :4000 cookie and CORS flow, reading a typecheck error that points into apps/api, removing the module, or deploying the static bundle to Workers.
---

# admin — the role-gated backoffice SPA

`apps/admin` (`@repo/admin`) is a plain browser bundle: [TanStack Router](https://tanstack.com/router)
over Vite, built to static assets and served by a Worker with a single-page-application fallback.
It carries **no server code and no Cloudflare bindings**. Everything it knows, it asks `apps/api`
for over the credentialed CORS spine, which is why it `dependsOn: ["api", "auth"]`.

Two conventions define it, and both are file drops rather than patches:

- **A screen is a file** under `src/routes/`. The router plugin regenerates `src/routeTree.gen.ts`
  and the screen is live, guarded, and typed — no descriptor patch, the admin twin of the schema
  barrel in `packages/db`.
- **A request is a `queryOptions` object**, prefetched in the route's `loader` and read in the
  component with `useQuery`, over a single `hc<AppType>` client.

## Add a screen

Drop `src/routes/<feature>.tsx` with a `createFileRoute` whose id matches the file path:

```tsx
// src/routes/widgets.tsx  →  /widgets
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@admin/lib/api";

const widgetsQuery = queryOptions({
  queryKey: ["widgets"],
  queryFn: async () => {
    const res = await api.widgets.$get();
    if (!res.ok) throw new Error(`The api answered ${res.status}.`);
    return res.json();
  },
});

export const Route = createFileRoute("/widgets")({
  loader: ({ context }) => context.queryClient.ensureQueryData(widgetsQuery),
  component: Widgets,
});

function Widgets() {
  const { data } = useQuery(widgetsQuery);
  // `useQuery` types `data` as `T | undefined` and the repo compiles with `strict`, so read
  // it through `?.` even when the loader has already filled the cache.
  return <main className="mx-auto max-w-3xl px-6 py-10">{data?.widgets.length ?? 0} widgets</main>;
}
```

That is the whole registration. The file is a child of `src/routes/__root.tsx`, so it inherits the
sidebar shell and the access gate with no work of its own. `src/routes/index.tsx` is the worked
example in the scaffold; copy from it.

Three things the plugin owns, so do not hand-write them:

- **`src/routeTree.gen.ts`.** `@tanstack/router-plugin` rewrites it whenever a file under
  `src/routes/` appears or disappears. It is committed rather than ignored, so `tsc --noEmit` and a
  fresh `pnpm build` work on a clean checkout before Vite has ever run. Edit routes, not the tree.
- **The route id string.** `createFileRoute("/widgets")` is derived from the file's path. Rename the
  file and let the plugin rewrite the call; changing one without the other breaks the build.
- **Plugin order in `vite.config.ts`.** `tanstackRouter()` runs before `react()`. Reversed, the
  code-split rewrite lands on already-transformed output and the generated tree goes stale.

Adding the screen to `NAV_ITEMS` in `src/components/app-shell.tsx` is a separate, optional step.
The `to` values are checked against the generated tree, so a nav entry for a route that does not
exist fails `pnpm typecheck` rather than 404-ing in the browser.

## The gate: a session is never enough

`src/routes/__root.tsx` decides access in `beforeLoad`, top-down, before any child route's `loader`
fires. Three outcomes and no fourth:

| Visitor | Outcome |
|---|---|
| Anonymous | `throw redirect({ to: "/login" })`, except on `/login` itself |
| Signed in, `user.role !== "admin"` | `throw new NotAdminError(session)` → the root `errorComponent` renders `AccessDenied` **in place** |
| Signed in, `user.role === "admin"` | the shell renders |

The middle row is the one to keep. A non-admin holds a valid session, so redirecting them to
`/login` sends them straight back the moment the guard reads it, and the address bar ping-pongs.
They get a terminal panel with a sign-out button instead.

**Every deny is a throw, and that is load-bearing.** `beforeLoad` runs before any loader, but only a
throw ends the match; a `beforeLoad` that returns normally lets every matched route's `loader` run.
So the non-admin case is a thrown `NotAdminError` (exported from `__root.tsx`) that the root route's
`errorComponent` turns into the panel, not a role check inside the component. Deny it in the
component instead and the loaders of the route the visitor asked for fire first, on their cookie,
before the panel paints. Keep the check in `beforeLoad` and no child loader runs for anyone the
guard turns away.

### This guard is the second half of the gate

The first half is `requireAdmin` in `@repo/auth/server`, and the api route is where it runs. `beforeLoad` stops this app from asking on a denied visitor's behalf; it cannot stop `curl`, a stale bundle, or a second client someone writes against the same api. Ship a new admin route and you wire both halves or you have shipped neither:

```ts
// apps/api/src/routes/reports.ts — the server half
import { Hono } from "hono";
import { requireAdmin } from "@repo/auth/server";

export const reports = new Hono().get("/", async (c) => {
  await requireAdmin(c.req.raw);
  return c.json({ reports: await listReports() }, 200);
});
```

```tsx
// apps/admin/src/routes/reports.tsx — the client half
export const Route = createFileRoute("/reports")({
  loader: ({ context }) => context.queryClient.ensureQueryData(reportsQuery),
  component: Reports,
});
```

The screen needs no guard of its own. It is a child of `__root.tsx`, so it inherits `beforeLoad`, and a non-admin never reaches its loader. That inheritance is exactly what makes the server half easy to forget: the screen behaves correctly while the endpoint behind it answers anyone.

`GET /admin/users` is the shipped example. `modules/admin/files/api/routes/admin-users.ts` calls `requireAdmin`, then `auth.api.listUsers`, and answers `{ users, total }`. A `chained-route` patch registers it on api's exported chain, so `hc<AppType>` types it here for free. Nothing in this app renders it yet; it exists to prove the gate and to be the pattern the next route copies.

Prove the server half yourself rather than trusting the screen. Sign in as a non-admin, take the cookie, and call the endpoint directly:

```sh
curl -i -b /tmp/non-admin-cookies.txt http://localhost:4000/admin/users
```

That answers `403` with `{"error":{"code":"forbidden","message":"role required: admin"}}`. A `200` means the route skipped the gate, whatever the browser shows.

`src/lib/auth.ts` owns the read. `loadSession()` fetches once per page load and hands the same
promise to every caller, so a burst of navigations costs one round trip; `forgetSession()` drops it.
The memo has no expiry by design — a session revoked elsewhere stays cached until a sign-out or a
reload, which shows up as api calls answering 401 under a shell that still paints, never as access
a server denied. **Every code path that changes who is signed in calls `forgetSession()` before
`router.invalidate()`** — invalidating first re-runs the guard against the stale cache and undoes
the sign-in or sign-out that just happened. `login.tsx` and `components/sign-out-button.tsx` both
show the order.

The role string itself comes from better-auth's `admin()` plugin, which the `auth` module enables on both halves (`admin()` server-side, `adminClient()` in `packages/auth/src/client.ts`). Drop the client half and `session.user.role` stops being typed.

**The first account to sign up becomes the admin.** A `databaseHooks.user.create.before` hook in `packages/auth/src/auth.ts` writes `role: "admin"` when the `user` table is still empty, so a fresh project reaches this shell without SQL. Every account after it keeps the plugin's `"user"` default and lands on `AccessDenied`. Sign-up is open, so claim that first slot the moment the api answers; if somebody beat you to it, the `wrangler d1 execute` one-liner in the `saasaloy-auth` skill flips the row. That skill owns the rule and the recovery path both.

There is deliberately **no sign-up route** here. An admin account is made by promoting an existing
user, never by self-service at the backoffice door.

## The typed client

`src/lib/api.ts` is the only place `hc` is called:

```ts
export const api = hc<AppType>(apiBaseUrl, { init: { credentials: "include" } });
```

Three properties are load-bearing:

- **`AppType` is `apps/api`'s route chain.** `api.health.$get()`, its path and its per-status
  response shape all come from the route file. Change a response schema in `apps/api` and this app
  stops typechecking. Turbo runs `typecheck` across every workspace, so CI catches it.
- **`apiBaseUrl` is imported from `src/lib/auth.ts`**, not re-read from `import.meta.env`. The
  session cookie is scoped to the api origin, so an api client bound elsewhere would send none.
- **`init.credentials: "include"`** is why this file exists instead of a one-line `hc()` per call
  site. `fetch` omits cookies cross-origin by default, so without it every request from `:3001`
  arrives anonymous and the api answers 401.

`@repo/api/client` is a **types-only** export (its `package.json` maps `./client` under a `types`
condition alone), which is why `@repo/api` is a `devDependency`. No Worker code enters this bundle.

### Why `@cloudflare/workers-types` is in this app's `types`

`tsconfig.json` lists `"types": ["@cloudflare/workers-types", "vite/client"]`, and the first entry
looks wrong in a browser-only SPA. It is not.

Importing `AppType` makes `tsc` read **apps/api's whole source graph**, because the type *is* that
graph. That graph includes the auth handler api mounts, which imports `cloudflare:workers` and
annotates a `D1Database`. Without the ambient Workers types, those declarations fail to resolve and
the errors surface **here**, in `apps/admin`, pointing at files in `apps/api` that admin never
bundles a byte of.

So: **an admin typecheck error whose path starts `apps/api/` is usually not an admin bug.** Add a
Worker-only dependency to the api and read the error where it is reported, not where it is thrown.
The fix is nearly always in `apps/api` (or in another ambient type this app must declare), never a
change to `src/lib/api.ts`. The entry is types only; there is no runtime dependency on the Workers
runtime in this app.

### Why the two TanStack Router pins carry different numbers

`@tanstack/react-router` is pinned at `1.170.32` and `@tanstack/router-plugin` at `1.168.35`, which reads like drift and is not. TanStack releases the two on independent version lines, and `router-plugin@1.168.35` names `"@tanstack/react-router": "^1.170.32"` in its own `peerDependencies` — the pins are the matching pair, they just do not share a number. Do not "fix" the mismatch by inventing a `router-plugin@1.170.32`; no such release exists. Check the plugin's `peerDependencies` against the router pin instead, and move both together when `pnpm deps:update` offers a bump.

## Loader + Query, and why both

`src/main.tsx` creates one `QueryClient` at module scope and puts it on the **router context**, so a
route's `loader` prefetches through the same cache the component then reads:

```tsx
const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });
```

`ensureQueryData` in the loader starts the request while the route resolves, and `defaultPreload:
"intent"` starts it on hover, so the cache is warm before the component mounts. The component still
reads through `useQuery` rather than the loader's return value, because `useQuery` **subscribes**:
an invalidation anywhere in the app re-renders the screen.

Refresh by **invalidating the key**, not by calling `refetch()`. `invalidateQueries({ queryKey })`
refreshes every screen holding that query, and it is the same call a mutation's `onSuccess` makes.

The scaffold's defaults are `retry: 1` and `staleTime: 30_000` — backoffice numbers, not universal
ones. An admin clicks between a handful of screens, so a short stale window keeps a revisit instant,
and one retry absorbs a dropped packet without sitting on a down api for seconds.

Give every data route an `errorComponent`. A down api is the ordinary case in dev, and the route's
error boundary catches both the loader's throw and the query's.

## Ports and CORS

| Service | Port | Pinned in |
|---|---|---|
| `apps/web` (Astro) | **3000** | `astro.config.mjs` |
| `apps/admin` (this app) | **3001** | `vite.config.ts` (`server.port` + `strictPort`) |
| `apps/api` (Worker) | **4000** | `vite.config.ts` and `wrangler.jsonc` (`dev.port`) |

`3001` is not cosmetic. The api's `DEV_ORIGINS` allowlist and better-auth's `trustedOrigins` both
hardcode `http://localhost:3001` as the keyless dev fallback, so a drifting port turns into a CORS
rejection that reads like a code bug. `strictPort` makes a busy port fail loudly instead of quietly
shifting to `3002`.

In production the origin comes from `PUBLIC_API_URL`, and the api needs the admin origin in
`CORS_ORIGINS`. The prefix is `PUBLIC_` rather than Vite's default `VITE_` (`envPrefix` in
`vite.config.ts`), so the bundle only inlines a variable a human deliberately named `PUBLIC_*`, and
one env key spells the api origin for `web`, `admin` and `waitlist` alike. Unset or empty, it falls
back to `http://localhost:4000`.

Cookie behaviour is the `auth` module's (ADR 0004). Cross-origin dev works because api's `cors()`
sets `credentials: true` for the allowlisted origins and the cookie is host-only on `localhost`. In
production, put the api and the admin app on sibling subdomains and set `COOKIE_DOMAIN`.

## Run it

```sh
pnpm --filter @repo/api dev    # :4000, the real workerd runtime
pnpm --filter @repo/admin dev  # :3001
```

Both, in two terminals. Admin on its own serves a login screen that cannot sign anyone in.

## Deploy

Static assets on a Worker, exactly like `apps/web`:

```sh
pnpm --filter @repo/admin build           # vite build → dist/
pnpm --filter @repo/admin exec wrangler deploy --dry-run
```

`wrangler.jsonc` declares `assets.directory: "./dist"` with
`not_found_handling: "single-page-application"` and **no `main`**. The SPA fallback is what makes a
hard reload of `/login` work; without it the request 404s, because no such file exists in `dist/`.
There are no bindings, and there should not be — the session and the database are reached through
`apps/api` over HTTP.

Set `PUBLIC_API_URL` at **build** time, not on the Worker. Vite inlines it into the bundle, so a
runtime variable would arrive too late to matter.

Like every other module, `admin` owns no deploy pipeline. The `deploy` script is for local and
manual use; centralized deployment is the future `infra` capability's job.

## Removing the module

`saasaloy remove admin` deletes the files **this module** installed and prunes the directories that
leaves empty. A route file another module dropped into `src/routes/` is that module's, so it
survives, and `apps/admin/` survives with it as a half-workspace: no `package.json`, no
`vite.config.ts`, a stale `src/routeTree.gen.ts`, and the `@admin` alias still in `saasaloy.json`
because its prefix directory did not vanish.

**Remove the feature modules that dropped routes first, then `admin`.** Otherwise delete the
leftovers by hand before re-adding, or the next `add admin` restores a workspace around orphaned
files.

## Conventions to honor

- **A screen is a file drop** under `src/routes/`, never a patch. Let the plugin rewrite
  `src/routeTree.gen.ts`; never hand-edit it.
- **`tanstackRouter()` stays ahead of `react()`** in `vite.config.ts`.
- **One `hc` call, in `src/lib/api.ts`.** Import `api`; do not build a second client.
- **One origin for api and auth**, from `src/lib/auth.ts`'s `apiBaseUrl`. A split origin loses the
  session cookie.
- **The guard lives in `__root.tsx`'s `beforeLoad`**, and it is default-deny. A per-route session
  check is redundant, because every deny there is a throw and no child loader runs after one. Keep
  it that way: a deny that returns instead of throwing silently re-opens the loaders it was meant to
  stop. Do not turn `AccessDenied` into a redirect either.
- **Every admin endpoint calls `requireAdmin`**, whatever the guard in `__root.tsx` does. The screen inheriting `beforeLoad` is not authorization; it is the reason a missing server check looks fine in a browser.
- **`forgetSession()` before `router.invalidate()`**, on every sign-in and sign-out path.
- **Describe a request once with `queryOptions`**, prefetch in the loader, read with `useQuery`,
  refresh by invalidating the key.
- **Browser env vars are `PUBLIC_*`.** A `VITE_*` name is not exposed here.
- **No bindings and no Worker entry.** Anything needing D1, R2 or a secret belongs in `apps/api`.
