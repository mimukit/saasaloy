---
name: saasaloy-admin
description: Runbook for the admin capability — a role-gated TanStack Router + Vite SPA in apps/admin. Use when adding an admin screen, composing the page primitives (page layout, page header, filter chips, data table, status pill, attribute list, detail panel), adding a rail area or a nav group to the three-panel shell, changing the admin-scoped theme or the dark-by-default rule, wiring the typed hc<AppType> client and TanStack Query, gating a new admin api route with requireAdmin, changing the admin-role guard or the login screen, debugging the :3001 → :4000 cookie and CORS flow, reading a typecheck error that points into apps/api, removing the module, or deploying the static bundle to Workers.
---

# admin — the role-gated backoffice SPA

`apps/admin` (`@repo/admin`) is a plain browser bundle: [TanStack Router](https://tanstack.com/router)
over Vite, built to static assets and served by a Worker with a single-page-application fallback.
It carries **no server code and no Cloudflare bindings**. Everything it knows, it asks `apps/api`
for over the credentialed CORS spine, which is why it `dependsOn: ["api", "auth"]`.

Three conventions define it, and the first two are file drops rather than patches:

- **A screen is a file** under `src/routes/`. The router plugin regenerates `src/routeTree.gen.ts`
  and the screen is live, guarded, and typed — no descriptor patch, the admin twin of the schema
  barrel in `packages/db`.
- **A request is a `queryOptions` object**, prefetched in the route's `loader` and read in the
  component with `useQuery`, over a single `hc<AppType>` client.
- **A screen composes the page primitives** in `src/components/`. It writes no shell markup, no
  table markup, and no colours of its own.

## Add a screen

Drop `src/routes/<feature>.tsx` with a `createFileRoute` whose id matches the file path:

```tsx
// src/routes/widgets.tsx  →  /widgets
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@admin/components/page-header";
import { PageLayout } from "@admin/components/page-layout";
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
  return (
    <PageLayout>
      <PageHeader title="Widgets" count={data?.total} />
      <div className="min-h-0 flex-1 overflow-auto p-4">…</div>
    </PageLayout>
  );
}
```

That is the whole registration. The file is a child of `src/routes/__root.tsx`, so it inherits the
shell and the access gate with no work of its own. `src/routes/users.tsx` is the worked example in
the scaffold; copy from it.

`PageLayout` fills the content panel the shell gives the route, so the route never sets its own page
width, background or padding. A screen that reaches for `mx-auto max-w-3xl` is fighting the shell.

Three things the plugin owns, so do not hand-write them:

- **`src/routeTree.gen.ts`.** `@tanstack/router-plugin` rewrites it whenever a file under
  `src/routes/` appears or disappears. It is committed rather than ignored, so `tsc --noEmit` and a
  fresh `pnpm build` work on a clean checkout before Vite has ever run. Edit routes, not the tree.
- **The route id string.** `createFileRoute("/widgets")` is derived from the file's path. Rename the
  file and let the plugin rewrite the call; changing one without the other breaks the build.
- **Plugin order in `vite.config.ts`.** `tanstackRouter()` runs before `react()`. Reversed, the
  code-split rewrite lands on already-transformed output and the generated tree goes stale.

Not-found and error handling comes with the root route as well. `__root.tsx` carries a
`notFoundComponent` and an `errorComponent`, both rendering `@repo/ui`'s `ErrorState`, so an
address matching no file under `src/routes/` shows the themed 404 inside the shell, and a
throw during render shows a retry screen instead of a blank page. A feature module inherits both
and registers neither: a second `notFoundComponent` on your own route captures every miss below it
and answers with markup nobody else restyles. Change the words in
`packages/ui/src/content/errors.ts`, not in a new component here.

Putting the screen in the nav is a separate, optional step. See [The shell](#the-shell) below.

## The shell

Every route except `/login` renders inside `src/components/app-shell.tsx`, which lays out three floating panels on the canvas with an 8px gutter between them and to the viewport edge:

| Panel | File | Width | What it holds |
|---|---|---|---|
| Icon rail | `src/components/rail.tsx` | 56px, no panel chrome | one icon per top-level area, each in a `Tooltip` with an optional count `Badge`; a footer with the theme toggle and an `Avatar` opening a `DropdownMenu` that carries the account name, the email and sign-out |
| Nav panel | `src/components/nav-panel.tsx` | 240px, hidden below `md` | the active area's title row with actions, then `Collapsible` groups of rows with icon, label and right-aligned count |
| Content panel | `app-shell.tsx` | the rest | the route, through `PageLayout` |

Below `md` the nav panel leaves the row and reappears in a `Sheet` behind a toggle in the content header. The rail stays at every width. Nav state resets on every load: groups open by default, nothing written to `localStorage`, no server-side layout preference.

Active state is `aria-current`. TanStack Router sets it on the active `Link`, and both the rail and the nav rows style themselves with `aria-[current=page]:` off that same attribute. There is no second "which page am I on" comparison to keep in step.

### Add a rail area and a nav group

`NAV_AREAS` in `src/components/nav.ts` is the one list to edit. An area is a rail icon plus the nav panel it opens:

```tsx
export const NAV_AREAS = [
  {
    label: "Admin",
    to: "/",
    icon: LayoutDashboardIcon,
    groups: [
      {
        label: "Manage",
        items: [
          { to: "/", label: "Overview", icon: GaugeIcon },
          { to: "/users", label: "Users", icon: UsersIcon },
        ],
      },
    ],
  },
] as const;
```

- **A new nav row** is one entry in an existing group's `items`. It needs `to`, `label` and `icon`, and takes an optional `count`.
- **A new group** is one entry in an area's `groups`, with a `label` and its own `items`. It renders as a collapsible block under the ones above it.
- **A new rail area** is one entry in `NAV_AREAS`, with its own `icon`, `label`, `to` and `groups`. Nothing else in the shell changes: the rail renders every area, and `areaFor(pathname)` in the same file picks the active one by longest matching `to` prefix.

Keep the `as const`. It is what holds every `to` at a literal type the router can check, so a nav entry naming a route that does not exist fails `pnpm typecheck` instead of 404-ing in the browser. Widen `to` to `string` and that check is gone.

`nav.ts` holds the data and the two rules that read it, and nothing else. It is a plain `.ts` module rather than part of `app-shell.tsx` so that all three shell files can import it without the rail and the nav panel importing their own composer.

Read an optional count through the `navCount(entry)` helper rather than `entry.count`. Under `as const` an entry that omits `count` has no such key on its type at all, and the helper is the one signature that accepts both shapes.

## Page primitives

Seven components in `src/components/`, all of them plain props and callbacks. None imports `@repo/api`, `hono/client`, `@admin/lib/api` or `import.meta.env` — data reaches them from the route, and holding that line is what keeps them reusable by the next screen.

| Component | Props | Notes |
|---|---|---|
| `PageLayout` | `children`, `detail?`, `detailLabel?`, `onDetailClose?`, `className?` | Fills the content panel. `detail` renders as a fourth panel at `md` and up, and in a `Sheet` below it; the same node either way. `detail` doubles as the open state, so passing `undefined` closes both placements. The width is read with `matchMedia`, not a CSS class, because a `md:hidden` sheet still mounts and would trap focus at desktop. |
| `PageHeader` | `title`, `count?`, `description?`, `actions?`, `className?` | The screen's only `h1`. `count` is separate from `title` so the number stays out of the accessible heading text; `0` renders, `undefined` does not. |
| `FilterChips` | `chips`, `selectedId`, `onSelect`, `label`, `className?` | A chip is `{ id, label, count? }`. Every chip is a real `button` carrying `aria-pressed`, and the styling keys off that attribute. It holds no selection state and runs no query — filtering is the route's. |
| `DataTable` | `columns`, `rows`, `rowId`, `caption`, `onRowClick?`, `selectedId?`, `emptyState?`, `className?` | See below. |
| `StatusPill` | `label`, `tone?`, `icon?`, `className?` | `tone` is `"neutral"` or `"open"`, and `open` is the muted blue keyed to `--status-open`. Mapping a domain value onto a tone is the caller's job. |
| `AttributeList` | `items`, `className?` | An item is `{ label, value? }`. A `dl` with a 132px label column. `null`, `undefined` and `""` all render as an em dash, so no caller writes the dash. |
| `DetailPanel` | `title`, `onClose`, `attributes?`, `groups?`, `tabs?`, `onOpenInNew?`, `className?` | A `Tabs` header with open-in-new and close actions, then a `ScrollArea` of `Collapsible` groups each wrapping an `AttributeList`. A group is `{ id, label, icon?, items, defaultOpen? }`; a tab is `{ id, label, content? }`, and a tab with no `content` renders an empty panel. |

`DataTable` is the only file in the app that imports `@tanstack/react-table`, and that is the point: a caller describes its screen with `columns` and `rows` and never sees a `ColumnDef` or a sorting state. A column is:

```tsx
{ id, header, value, cell?, sortable?, align? }
```

`value(row)` is both the sort key and the cell content when `cell` is absent, so the two cannot fall out of step. `cell(row)` renders anything richer. `rowId(row)` is the row's identity — it keys the rows, matches `selectedId`, and is what `onRowClick` should store, because an index breaks the moment a sort reorders the table. Sorting is client side and two-state: a sortable header cycles ascending and descending with no unsorted third step, and the active header is the one place `--accent-sort` orange appears.

Empty cells render `—` from the shared `EMPTY` constant in `attribute-list.tsx`, a boolean renders `Yes`/`No`, and a `Date` renders through `toLocaleDateString()`, so a column of dates needs no renderer.

## The users screen, end to end

`src/routes/users.tsx` is the worked example. It is the only screen that uses every primitive at once, and every row in it is real data from `GET /admin/users` — there are no demo rows to delete.

- `usersQuery` is a `queryOptions` over `api.admin.users.$get()`, keyed `["admin", "users"]` and prefetched by the route's `loader`.
- The row type is derived from the query's own return type, not written out by hand, so a field dropped in `apps/api` lands as a typecheck failure here.
- `PageHeader` shows `data.total` — the api's count, not `rows.length`. The endpoint caps its answer at 100 users, so the loaded page and the real total can differ.
- `FilterChips` narrows the loaded rows by role, in the component, with no refetch. The api takes no role parameter, so a chip press that fired a request would come back with the same page.
- `DataTable` renders name, email, role, verified and created. The columns are a module-scope constant, not an array built in the render pass; the lint rule against components defined during render flags `cell` renderers that live inside the component body.
- The selected user is `useState` in the route. The route builds the `DetailPanel` and hands it to `PageLayout` as `detail`, which is what lets one node be a side panel at desktop and a sheet below `md`.

Copy that split when you add a screen: **the route owns the state and the data, the primitives own the pixels.**

## The gate: a session is never enough

`src/routes/__root.tsx` decides access in `beforeLoad`, top-down, before any child route's `loader`
fires. Three outcomes and no fourth:

| Visitor | Outcome |
|---|---|
| Anonymous | `throw redirect({ to: "/login", search: { redirect: location.href } })`, except on `/login` itself |
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
  await requireAdmin(c);
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

`GET /admin/users` is the shipped example. `modules/admin/files/api/routes/admin-users.ts` calls `requireAdmin`, then `auth.api.listUsers`, and answers `{ users, total }`. A `chained-route` patch registers it on api's exported chain, so `hc<AppType>` types it here for free. `src/routes/users.tsx` renders it, so both halves of the gate are live in the scaffold and the next route has a pattern to copy on each side.

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

**The first account to sign up becomes the admin.** A `databaseHooks.user.create.before` hook in `packages/auth/src/auth.ts` writes `role: "admin"` when the `users` table is still empty, so a fresh project reaches this shell without SQL. Every account after it keeps the plugin's `"user"` default and lands on `AccessDenied`. Sign-up is open, so claim that first slot the moment the api answers; if somebody beat you to it, the `wrangler d1 execute` one-liner in the `saasaloy-auth` skill flips the row. That skill owns the rule and the recovery path both.

**A deep link survives the login hop.** The guard records the path it turned an anonymous visitor
away from as `?redirect=` on `/login`, and `login.tsx` navigates there after `forgetSession()` and
`router.invalidate()`. `src/lib/redirect.ts` decides whether that value may be used, and it has two
gates: `toInternalPath` rejects anything a browser could read as another origin (`//host`, `/\host`,
an absolute url, a control character), and `resolveDestination` then asks the router itself, through
`getMatchedRoutes(pathname)`, whether a route claims the path. Either failure falls back to `/`. A
new screen needs nothing here — it is in the generated route tree, so it is already a valid
destination.

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

## Theme and font

**The admin app carries its own token set.** `src/styles/admin.css` imports `@repo/ui/globals.css` and then redeclares the shadcn variables for `:root` and `.dark`. `packages/ui/src/styles/globals.css` still owns Tailwind's entrypoint, the `dark` custom variant and the base layer; `admin.css` reassigns values and adds one `@source` line.

That `@source` line is load-bearing. Tailwind scans content rather than imports, so `globals.css` names the primitives the landing page renders one file at a time — a blanket components glob would push this app's tooltip, menu, sheet, tabs, table, avatar and scroll-area utilities into the landing page stylesheet as well. This app renders all of them, so it scans the whole directory itself. Vendor a primitive only this app uses and it is already covered; drop the line and every shell primitive renders unstyled with no error.

`src/main.tsx` imports `./styles/admin.css` and nothing else. **No route imports a stylesheet.** Two Tailwind entrypoints in one bundle means two copies of the base layer and a token set whose winner depends on import order.

The dark palette is a three-step neutral ramp measured off the reference screenshots — canvas darkest, panel one step lighter, hover and selected one step lighter again — with an opaque hairline rather than the base template's low-alpha white, which is invisible on a near-black canvas. The measured values are written into the header comment of `admin.css` beside the roles they fill; change a value there and update the comment with it. Light is a mapped cream variant and is first-class, not a fallback.

Two tokens exist beyond the shadcn set, both surfaced through `@theme inline`:

- `--status-open` (and `--status-open-foreground`) — the muted blue of `StatusPill`'s `open` tone and of a primary circular action.
- `--accent-sort` — the orange on `DataTable`'s active sort header. It is reserved for one indicator at a time and for an AI surface. It is never a section background, and `StatusPill` deliberately has no orange tone.

**Dark by default, and every stored choice wins — `system` included.** `applyStartingTheme()` in `src/main.tsx` runs above `createRoot` and is one line: `setTheme(hasChosenTheme() ? getStoredTheme() : "dark")`.

The `theme` key alone cannot carry this. `setTheme("system")` DELETES it — that is how `@repo/ui`'s state machine spells "follow the OS", and the landing page depends on it — so a first visit and a deliberate `system` both read as an absent key. `hasChosenTheme()` separates them by reading a second key, `theme-chosen`, which `installThemeToggle()` writes on every press and nothing clears. Never chosen means dark; chosen with no `theme` key means `system`, resolved against the OS.

`index.html` emits no `THEME_INIT_SCRIPT` — that is the Astro host's mechanism, and there is no Vite plugin here. The trade is one frame of the light palette on an empty body before the entry module runs. `main.tsx` calls `installThemeToggle()` from `@repo/ui/lib/theme` instead: `ThemeToggle` is inert chrome whose click handling normally lives in that script, and importing the handler keeps the cycle rule in one place. It cycles light → dark → system off what is painted, not off storage, so it still advances where storage is unwritable.

The rail calls `relabelThemeToggles()` in a `useEffect`. `setTheme` renames every toggle it can find, but the theme is applied before React mounts the button, so without that call the control keeps `ThemeToggle`'s static `system` label over a painted dark page.

### The two dependencies the theme and the table add

- **`@fontsource-variable/inter`** is a runtime `dependency`, imported from `admin.css` and set as `--font-sans` in a `@theme` block. It is the app's only face; no mono font is loaded. The body enables Inter's `cv11` and `ss01` sets and `tabular-nums`, because counts sit in right-aligned columns in the nav and the table.
- **`@tanstack/react-table`** is a runtime `dependency`, imported by `src/components/data-table.tsx` and nowhere else. Features are registered once at module scope through `tableFeatures({ rowSortingFeature, ... })`; v9 has no global feature set, and naming them there is also what keeps the unused ones out of the bundle.

Both are exact-pinned. Template and module-descriptor dependencies are invisible to pnpm, so move them with `pnpm deps:update` and never by hand-typing a version.

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
- **A screen composes the primitives.** Start from `PageLayout` and `PageHeader`; do not write shell
  markup, table markup, or a page width of your own.
- **A primitive takes plain props and callbacks.** Nothing under `src/components/` imports
  `@repo/api`, `hono/client`, `@admin/lib/api`, or reads `import.meta.env`.
- **`@tanstack/react-table` is imported by `data-table.tsx` and by nothing else.** A route that
  imports a `ColumnDef` has skipped the wrapper the next screen depends on.
- **`NAV_AREAS` stays `as const`.** That literal type is what turns a nav entry for a missing route
  into a typecheck failure instead of a 404.
- **One stylesheet, `src/styles/admin.css`, imported once from `src/main.tsx`.** A second Tailwind
  entrypoint duplicates the base layer and makes the token set order-dependent.
- **Dark is the default, and a stored choice wins.** Gate it on `hasChosenTheme()`. `getStoredTheme()`
  alone cannot tell an unset key from a deliberate `system`, because `system` is spelled as no key.
- **Orange is `--accent-sort` and nothing else.** One active sort indicator, or an AI surface. Never
  a section background and never a status pill.
- **Not-found and error screens are the root route's.** Inherit `__root.tsx`'s
  `notFoundComponent` and `errorComponent`; do not register a second pair on a feature route, and
  do not write error markup outside `@repo/ui`'s `ErrorState`.
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
