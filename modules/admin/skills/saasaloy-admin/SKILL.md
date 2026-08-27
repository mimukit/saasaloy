---
name: saasaloy-admin
description: Runbook for the admin capability — a TanStack Router SPA on Vite, deployed as Cloudflare Workers static assets. Use when adding, changing, or debugging pages in apps/admin, calling the api from the shell, wiring the session guard, or setting VITE_API_URL per environment. Covers the routes/ file-based convention, the staticData nav entry, the api() helper, and the pre-paint theme rule.
---

# admin — TanStack Router SPA on Cloudflare Workers

`apps/admin` is the signed-in shell, the place a logged-in user stands. It is a client-rendered [TanStack Router](https://tanstack.com/router) app built with Vite and served as Workers static assets, so nothing renders on the edge (build-spec §2.3: Router, not Start, because an SPA never asks Workers to render it, and SEO is irrelevant behind a login).

Its defining convention is **file-based routing**: a page is a file you drop into `src/routes/`, never an edit to a router or to a nav array.

## Add a page (the core convention)

A guarded page goes under `src/routes/_authed/`. Create the file, export a `Route`, and stop:

```tsx
// src/routes/_authed/billing.tsx  →  /billing
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/billing")({
  component: Billing,
  staticData: { nav: { label: "Billing", order: 20 } },
});

function Billing() {
  return <main className="mx-auto max-w-3xl px-6 py-16">…</main>;
}
```

That is the whole step. No other file changes, and no patch touches the router. `src/routes/_authed/index.tsx` is the worked example already in the tree.

Three things the file gets for free:

- **The URL.** `_authed` is a *pathless* layout route: the leading underscore means the folder adds no segment, so `_authed/billing.tsx` is served at `/billing`, not `/_authed/billing`.
- **The guard.** Everything under `_authed/` inherits the session check in `src/routes/_authed.tsx`. A page that must stay reachable while signed out goes *outside* that folder, which is exactly how `/login` and `/signup` work.
- **The nav entry.** `staticData.nav` is read back off the route tree by `src/components/nav.tsx`.

`@tanstack/router-plugin` regenerates `src/routeTree.gen.ts` on every `dev` and `build`. That file is plugin-owned: never edit it by hand, and commit the regenerated version alongside the route that caused it.

### The nav is read, never written

`src/components/nav.tsx` walks `router.routesById` and renders every route carrying a `nav` entry, sorted by `order` then label. There is no `navItems` array to append to, so the nav cannot disagree with the routes it points at. Delete a route file and its link goes with it.

The shape is typed by augmenting TanStack's own `StaticDataRouteOption` in `src/main.tsx`, so a missing `order` or a misspelt `label` is a type error rather than a silent omission:

```ts
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    nav?: { label: string; order: number };
  }
}
```

`nav` stays optional. Leave it off and the page still works, it just does not appear in the nav — the right answer for a detail page like `/billing/$invoiceId`.

`order` is an ascending sort key. The dashboard holds `0`; leave gaps (10, 20, 30) so a later module can slot in between without renumbering anyone.

`Nav` takes `email`, `onSignOut` and `signOutPending` as props. The `_authed` layout owns the sign-out call and passes it down, so the nav renders and decides nothing.

## The session guard contract

`src/routes/_authed.tsx` runs `beforeLoad`, calls `context.auth.load()`, and redirects to `/login?redirect=<href>` when there is no session. It returns `{ session }`, which merges into the context of every route below it, so a page reads the signed-in user with no fetch of its own:

```tsx
const { session } = Route.useRouteContext();
session.user.email;
```

**The session is fetched once per app load, not per navigation.** `createAuthState()` in `src/lib/auth.ts` holds the one in-flight promise and its answer; `beforeLoad` runs on every navigation into the guarded tree but hits that cache after the first time. This is deliberate. The guard is UX, not enforcement: the session cookie is httpOnly, so the client can never be the real gate, and re-asking the server on each click buys latency and nothing else. The api rejects a stale session with a 401 and `lib/api.ts` turns that into a trip back to `/login`.

Two rules follow from the cache:

- **Call `auth.reset()` after any sign-in or sign-out.** `login.tsx`, `signup.tsx` and `_authed.tsx` all do. Skip it after sign-in and the guard bounces the brand-new session straight back to `/login` on a cached "signed out"; skip it after sign-out and the guard waves the next visit through on an answer the server has already invalidated.
- **Do not add a second session fetch.** A page that wants fresher data asks the api for that data and lets the 401 path handle expiry.

A network failure resolves to `null` and clears the cache, so a dropped connection costs one redirect to `/login` rather than pinning the app to "signed out".

### The redirect param is untrusted

`safeRedirect()` in `src/lib/auth.ts` is the only thing that reads `?redirect=`. It rejects anything that is not a single-slash-prefixed path (`https://evil.com` and the protocol-relative `//evil.com` both collapse to `/`). Route it through `safeRedirect` or `loginHref` — never navigate to a raw search param.

## Calling the api: `api()`, never a raw fetch

`src/lib/api.ts` is *the* way this app talks to the api Worker. Pass a leading-slash path, never a full URL:

```tsx
import { api, ApiError } from "@admin/lib/api";

const invoices = await api<Invoice[]>("/billing/invoices");
await api<Invoice>("/billing/invoices", { method: "POST", body: JSON.stringify(draft) });
```

It owns three things a raw `fetch` gets wrong:

| It handles | Why it matters |
|---|---|
| The origin (`VITE_API_URL`) | Hardcoding an origin in a page ships a dev URL to production. |
| `credentials: "include"` | The session cookie is httpOnly and cross-origin. One forgotten flag is a silently signed-out request, not an error. |
| A `401` response | It hard-navigates to `/login` (throwing away the app's cached session with the rest of its state) and throws, so no caller renders against a logged-out response. |

Any other non-2xx throws `ApiError` carrying `status` and the parsed `body`, which is what a page should catch to render its own error state. A `401` is not yours to catch.

For auth calls specifically (`signIn`, `signUp`, `signOut`, `useSession`), use the exports from `src/lib/auth.ts`. That is the Better Auth React client, wrapping `createAuthClient` with the same `baseURL` / `basePath: "/auth"` / `credentials: "include"` contract as `@repo/auth/client`. It lives here rather than in `packages/auth` because no patch kind edits a package's `exports` map (see the plan's rejected alternatives); revisit if a third React consumer appears.

## Env checklist

| Var | Owned by | Prod | Local |
|---|---|---|---|
| `VITE_API_URL` | **admin** (build time) | The api's origin, e.g. `https://api.x.com`, set in the build step for that environment | Unset. Falls back to `http://localhost:4000`. |
| `CORS_ORIGINS` | `api` (runtime) | **Must include the admin origin**, e.g. `https://app.x.com`, alongside the web one | Unset. `DEV_ORIGINS` already carries `http://localhost:3001`. |
| `COOKIE_DOMAIN` | `auth` (runtime) | **Must span both subdomains**, e.g. `.x.com`, when api and admin sit on different hosts | Unset. Localhost cookies are host-only and `SameSite=Lax` treats ports as same-site. |

Local dev is keyless: every var above has a working default, so a fresh playground signs up its first user with no `.env` at all.

Prod fails on any one of the three, in three different ways:

- **`VITE_API_URL` missing at build time** bakes `http://localhost:4000` into the production bundle. The app loads and every call fails at the network layer. It is a *build* input, so a redeploy of the same artifact will not fix it — rebuild.
- **The admin origin missing from `CORS_ORIGINS`** means the Worker answers without `Access-Control-Allow-Origin`, the browser refuses to hand the response to the page, and Better Auth's `trustedOrigins` (fed from the same var) additionally answers `403 INVALID_ORIGIN` on sign-in. Login looks broken; the api looks fine to `curl`.
- **`COOKIE_DOMAIN` not spanning the subdomains** lets sign-in succeed and the session vanish on the next request, because the cookie was scoped to `api.x.com` and never rides along from `app.x.com`. See `saasaloy-auth` for the full cookie-domain rule.

`VITE_API_URL` is read at **build** time, not run time. Vite inlines `import.meta.env` at compile time, so build once per environment. There is no runtime config file to edit after deploy, by choice: a `config.js` fetched before boot is machinery for a problem the deploy pipeline already solves.

## The theme rule (#64)

`index.html` carries no theme code. `vite.config.ts` injects `THEME_INIT_SCRIPT` from `@repo/ui/lib/theme` at `head-prepend` through a `transformIndexHtml` plugin, so the script runs synchronously during head parsing and `<html>` carries `data-theme` before the first paint. A dark-mode visitor never sees a white flash.

Two rules that plugin must keep, and that a change here must not break:

- **Never `type: "module"`.** Module scripts are deferred by specification and always run after first paint, which is the exact flash this prevents.
- **Never a pasted copy of the script body.** Import the constant. A copy drifts from `@repo/ui`'s the moment that file changes.

Vite only substitutes `%VITE_*%` values inside `index.html`, so it cannot reach a TypeScript constant. The plugin is the supported way in, not a workaround.

The nav renders `@repo/ui`'s `theme-toggle` block, which cycles light → dark → system. It is inert chrome and renders nothing useful until `THEME_INIT_SCRIPT` has set `data-theme`, which is another reason the injection is not optional.

## Dev servers and ports

```sh
pnpm --filter @repo/api dev     # http://localhost:4000
pnpm --filter @repo/admin dev   # http://localhost:3001
```

`apps/admin` runs on port 3001 with `strictPort: true`. The api Worker's `CORS_ORIGINS` fallback and auth's `trustedOrigins` both hardcode `http://localhost:3001`, so the port must not drift; `strictPort` turns a busy port into a loud failure instead of a silent `+1` that resurfaces later as an unexplained CORS rejection. Frontends take 3xxx (`web` 3000, `admin` 3001), backends 4xxx.

Both servers are needed for anything past the login screen, because the guard's very first act is a call to the api.

## Deploy

Workers static assets, the same shape as `apps/web`, plus `not_found_handling: "single-page-application"` so a deep link like `/billing` returns `index.html` and the router resolves it on the client instead of the edge answering 404. There is no Worker script and no `main` entry.

`wrangler.jsonc` uses the literal name `"admin"`. Module files are copied byte-for-byte by the applier, so a `{{PROJECT_NAME}}` placeholder would ship the braces into the project; rename the Worker by hand if the account needs a prefixed name. The `deploy` script exists for manual use, but production deploys belong to the future `infra` capability, as with every other service.

## Conventions to honor

- **Never edit `src/routeTree.gen.ts`.** The plugin owns it; commit what the build emits.
- **Never edit `nav.tsx` to add a link.** Declare `staticData.nav` on the route.
- **A guarded page lives under `src/routes/_authed/`.** Outside it means public.
- **Call the api through `api()`**, with a path, not a URL, and never a bare `fetch`.
- **Call `auth.reset()` after any sign-in or sign-out**, and add no second session fetch.
- **Route every `?redirect=` value through `safeRedirect()`.**
- **The theme script stays imported and `head-prepend`ed**, never pasted and never a module script.
- **Port 3001 is fixed**, and `strictPort` stays on.
