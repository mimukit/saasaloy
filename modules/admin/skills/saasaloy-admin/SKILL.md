---
name: saasaloy-admin
description: Runbook for the admin capability — a role-gated TanStack Router + Vite SPA in apps/admin. Use when adding an admin screen, composing the page blocks (page header, page body, page layout, data table, detail panel, filter chips, empty state, error state) and the admin primitive set in @repo/ui/components/admin, adding a nav group or an area to the sidebar shell, changing the admin theme in admin.css or the dark-by-default rule, wiring the typed hc<AppType> client and TanStack Query, gating a new admin api route with requireAdmin or requireAdminApp, changing the admin-role guard, the login screen or the admin session client (createAdminClient, /admin/auth, x-auth-audience), debugging the :3001 → :4000 cookie and CORS flow, reading a typecheck error that points into apps/api, removing the module, or deploying the static bundle to Workers.
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
- **A screen composes the admin blocks and primitives** in `@repo/ui`, which this module writes into `packages/ui/src/{components,blocks,containers}/admin/`. It writes no shell markup, no table markup, no page padding and no colours of its own.

## Add a screen

Drop `src/routes/<feature>.tsx` with a `createFileRoute` whose id matches the file path:

```tsx
// src/routes/widgets.tsx  →  /widgets
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { DataTable } from "@repo/ui/blocks/admin/data-table";
import { EmptyState } from "@repo/ui/blocks/admin/empty-state";
import { PageHeader } from "@repo/ui/blocks/admin/page-header";
import { PageLayout } from "@repo/ui/containers/admin/page-layout";

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
      <DataTable
        caption="Widgets"
        columns={COLUMNS}
        rows={data?.widgets ?? []}
        rowId={(widget) => widget.id}
        emptyState={<EmptyState title="No widgets yet" />}
      />
    </PageLayout>
  );
}
```

```

That is the whole registration. The file is a child of `src/routes/__root.tsx`, so it inherits the
shell and the access gate with no work of its own. `src/routes/users.tsx` is the worked example in
the scaffold; copy from it.

Every route renders inside the page frame (`@repo/ui/containers/admin/page-frame`), which the root route wraps around `<Outlet />`. The frame owns the height and the gutter: it sets `--page-gutter`, and `PageHeader`, `PageBody`, toolbar rows (`px-(--page-gutter)`) and the table's first and last columns pad with it. A route never sets its own page width, background or padding. A screen that reaches for `mx-auto max-w-3xl` or `p-6` is fighting the frame, and the next change to the gutter will skip it.

Three things the plugin owns, so do not hand-write them:

- **`src/routeTree.gen.ts`.** `@tanstack/router-plugin` rewrites it whenever a file under
  `src/routes/` appears or disappears. It is committed rather than ignored, so `tsc --noEmit` and a
  fresh `pnpm build` work on a clean checkout before Vite has ever run. Edit routes, not the tree.
- **The route id string.** `createFileRoute("/widgets")` is derived from the file's path. Rename the
  file and let the plugin rewrite the call; changing one without the other breaks the build.
- **Plugin order in `vite.config.ts`.** `tanstackRouter()` runs before `react()`. Reversed, the
  code-split rewrite lands on already-transformed output and the generated tree goes stale.

Loading, not-found and error handling come with the app as well:

- `src/main.tsx` sets `defaultPendingComponent` to the `PageSkeleton` block and `defaultErrorComponent` to `RouteError` (`src/components/route-error.tsx`), which renders the admin `ErrorState` with a retry and the error's message. Every route gets a skeleton while its loader runs and an error screen when it throws, inside the frame, with no code of its own.
- `__root.tsx` carries a `notFoundComponent` and an `errorComponent` that render the same admin `ErrorState`, so an unknown address shows the themed 404 inside the shell.

A route sets its own `errorComponent` only when its words should differ, as `/users` and the overview do. Never register a second `notFoundComponent`: it captures every miss below it. Change the words in `packages/ui/src/content/errors.ts`, not in a new component. The router types `error` as `unknown`, so read a message with `error instanceof Error ? error.message : undefined` and pass it as `detail`.

Putting the screen in the sidebar is a separate, optional step. See [The shell](#the-shell) below.

## The shell

Every route except `/login` renders inside `src/components/app-shell.tsx`, and so does every screen except the refusal page (`AccessDenied`, see [The gate](#the-gate-a-session-is-never-enough)). That file reads the router and the session and hands them to `ShellLayout` in `@repo/ui/containers/admin/shell-layout`, which imports no router and no session:

| Part | File | What it holds |
|---|---|---|
| Sidebar | `containers/admin/shell-sidebar.tsx` | the brand row (`BrandMark` and the product name), the organization picker's empty slot for #141, every area's nav groups, and the account menu at the foot with the name, the email and sign-out |
| Content panel | `containers/admin/shell-layout.tsx` | a sticky header with the sidebar toggle and the page path, then the route inside the page frame |

The sidebar is the coss sidebar from the admin set, `variant="inset"` and `collapsible="icon"`. It sits on the canvas; the content panel is the one raised surface beside it. The header toggle and ⌘B / Ctrl+B collapse it to a 56 px icon strip, where each row shows its label in a tooltip. Below `md` it opens as a sheet from the same toggle, and following a link closes the sheet. The open state is component state only, never storage, so a reload lands on the expanded sidebar.

Active state is `aria-current`. `AppShell`'s link component wraps TanStack Router's `Link`, which sets `aria-current="page"` on the active row, and the sidebar row styles that attribute. There is no second "which page am I on" comparison to keep in step. The page path in the header is the area's label and the label of the nav item whose `to` is the longest prefix of the current path.

### Add a nav group or an area

`NAV_AREAS` in `src/components/nav.ts` is the one list to edit:

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

- **A new nav row** is one entry in an existing group's `items`. It needs `to`, `label` and `icon`, and takes an optional `count`. A feature module adds its row with a `nav-entry` patch.
- **A new group** is one entry in an area's `groups`, with a `label` and its own `items`. The sidebar renders it under the ones above it, with its label.
- **A new area** is one entry in `NAV_AREAS`. The sidebar lists every area's groups in order, and `areaFor(pathname)` picks the area whose label starts the header's page path.

Keep the `as const`. It is what holds every `to` at a literal type the router can check, so a nav entry naming a route that does not exist fails `pnpm typecheck` instead of 404-ing in the browser. The shell in `@repo/ui` reads the entries through structural types with `to: string`; the one cast from that string back to a route lives in `AppShell`'s link component.

`nav.ts` holds the data and the two rules that read it, and nothing else, so its rules stay unit-testable without React. Read an optional count through the `navCount(entry)` helper rather than `entry.count`.

## The admin primitive set and the page blocks

This module writes the admin app's whole UI kit into `packages/ui/src/`, and admin code uses nothing else:

- **`components/admin/`** holds the primitives: 39 components adapted from coss ui on Base UI, plus `StatusPill`. Alert, alert dialog, avatar, badge, breadcrumb, button, card, checkbox, collapsible, combobox, dialog, empty, field, fieldset, form, group, input, input group, kbd, label, menu, meter, popover, radio group, scroll area, select, separator, sheet, sidebar, skeleton, spinner, switch, table, tabs, textarea, toast, toggle, toggle group and tooltip. The names are coss's: `*Popup` and `*Panel` for the parts shadcn calls `*Content`, `Menu*` for the dropdown menu, and a `render` prop instead of `asChild`. A few shadcn aliases (`DialogContent`, `DropdownMenu*`, `TabsTrigger`) are exported too. `NOTICE.md` in the folder carries the MIT notice the copy needs; keep it there.
- **`blocks/admin/`** holds the page blocks below, plus `BrandMark`, `ThemeMenuItem` and `ErrorState`. `ThemeMenuItem` (in `theme-toggle.tsx`) and `ErrorState` are the admin twins of the base blocks; the theme control is a row in the sidebar's account menu, not a header button.
- **`containers/admin/`** holds `ShellLayout`, `ShellSidebar`, `PageFrame`, `PageLayout` and `PageBody`.
- **`lib/admin/`** holds two helpers the primitives use, and **`assets/`** holds the brand mark.

A lint rule in `oxlint.config.mjs` fails any import of a base `@repo/ui/components/*`, `@repo/ui/blocks/error-state` or `@repo/ui/blocks/theme-toggle` under `apps/admin/**` and the `admin/` folders of `@repo/ui`. Both sets have a `button`, and without the rule an editor's autocomplete picks the wrong one with no error.

The copy is frozen. Nothing syncs from coss: a fix or a new component is a hand edit in `components/admin/`, from coss's MIT registry folder only and never from its AGPL `packages/ui`.

The page blocks take plain props and callbacks. None imports `@repo/api`, `hono/client`, `@admin/lib/api` or `import.meta.env`.

| Block | Import | Props | Notes |
|---|---|---|---|
| `PageHeader` | `blocks/admin/page-header` | `title`, `count?`, `description?`, `actions?` | The page's only `h1`. `count` stays out of the heading text; `0` renders, `undefined` does not. `actions` holds the page-level buttons, such as Refresh or New. |
| `PageBody` | `containers/admin/page-body` | `children` | The padded, scrolling body under the header, for cards, forms and editors. A list page that hands its height to `DataTable` does not need it. |
| `PageLayout` | `containers/admin/page-layout` | `children`, `detail?`, `detailLabel?`, `onDetailClose?` | Puts a list beside its detail. `detail` docks as a column at `md` and up and opens as a bottom sheet below it; the same node either way. Passing `undefined` closes both. |
| `DataTable` | `blocks/admin/data-table` | `columns`, `rows`, `rowId`, `caption`, `onRowClick?`, `selectedId?`, `emptyState?` | See below. |
| `DetailPanel` | `blocks/admin/detail-panel` | `title`, `onClose`, `description?`, `media?`, `status?`, `banner?`, `attributes?`, `groups?`, `tabs?`, `actions?`, `footer?`, `onOpenInNew?` | A header with the record's avatar, name and second line, optional tabs, then the attributes, collapsible groups and the record's actions. `status` renders after the title in the header, for one `StatusPill` or two; when the header shows the status, drop the status attribute row. `banner` renders under the header and above the tabs and does not scroll; pass an `Alert` from `components/admin/alert`. `footer` is pinned under the scrolling body behind a hairline, for the record's main decision such as Confirm and Reject. `actions` stays inside the scrolling body, for in-body controls such as a role select. A panel with none of the three renders as before. It draws no border; `PageLayout` supplies the edge. |
| `FilterChips` | `blocks/admin/filter-chips` | `chips`, `selectedId`, `onSelect`, `label` | Each chip is a real `button` with `aria-pressed`. Filtering is the route's. |
| `AttributeList` | `blocks/admin/attribute-list` | `items` | A `dl` of label and value. An empty value renders as an em dash. |
| `EmptyState` | `blocks/admin/empty-state` | `title`, `description?`, `icon?`, `action?` | The filler for `DataTable`'s `emptyState`. Write different words for an empty list and a list filtered down to nothing. |
| `ErrorState` | `blocks/admin/error-state` | `code`, `title?`, `description?`, `detail?`, `primaryAction?`, `secondaryAction?` | The admin error screen, with the words from `content/errors.ts`. |
| `StatusPill` | `components/admin/status-pill` | `label`, `tone?`, `icon?` | Five tones: `neutral` (the default), `open` (the muted blue of a live state), `ok` (settled, such as paid or verified), `warn` (waiting on someone, such as pending or open) and `bad` (a failure, such as site closed). Use it for a value that is a state; a tag such as a plan name, a flag type or a count stays a `Badge`. The route maps a value onto a tone. |

`DataTable` is the only file that imports `@tanstack/react-table`, and that is the point: a caller describes its screen with `columns` and `rows` and never sees a `ColumnDef` or a sorting state. A column is:

```tsx
{ id, header, value, cell?, sortable?, align? }
```

`value(row)` is both the sort key and the cell content when `cell` is absent, so the two cannot fall out of step. `cell(row)` renders anything richer. `rowId(row)` keys the rows, matches `selectedId`, and is what `onRowClick` should store, because an index breaks the moment a sort reorders the table. Sorting is client side and two-state, and the active header is the one place `--accent-sort` orange appears. Empty cells render `—`, a boolean renders `Yes`/`No`, and a `Date` renders through `toLocaleDateString()`.

Inside a page, build every control from the primitive set: `Field` with `FieldLabel` and `Input`, `Select` or `Checkbox` in a form; `Switch` for an on/off setting; `Dialog` for a create flow; `AlertDialog` before a revoke, a delete or a cancel; and `toastManager.add({ type, title, description })` from `components/admin/toast` for the result of every mutation. The toast provider is already mounted in `__root.tsx`.

## The users screen, end to end

`src/routes/users.tsx` is the worked example, and every row in it is real data from `GET /admin/users`.

- `usersQuery` in `src/lib/users-query.ts` is a `queryOptions` over `api.admin.users.$get()`, keyed `["admin", "users"]`. The overview reads the same query for its user count and newest sign-ups, so a refresh on either screen updates the other.
- The row type is derived from the query's own return type, so a field dropped in `apps/api` lands as a typecheck failure here.
- `PageHeader` shows `data.total`, the api's count. The endpoint caps its answer at 100 users, so the loaded page and the real total can differ.
- `FilterChips` narrows the loaded rows by role, in the component, with no refetch.
- `DataTable` renders name with an avatar, email, role as a `StatusPill`, verified as an `ok` or `warn` `StatusPill`, and created. The columns are a module-scope constant.
- An empty list shows one `EmptyState`, and a list filtered to nothing shows another with a "Show all users" button.
- The selected user is `useState` in the route. The route builds the `DetailPanel`, with the role pill in its `status` slot, and hands it to `PageLayout` as `detail`.
- `UsersError` is the worked example of a route overriding the router's default error screen.

Copy that split when you add a screen: **the route owns the state and the data, the blocks own the pixels.**

## The gate: a session is never enough

This app signs in on the **admin session**: `adminAuth` at `/admin/auth`, cookie `admin.session_token`. A client signed in on another app in the same browser holds `client.session_token`, which this app never reads, so the two stay signed in side by side. See "Two instances" in the `saasaloy-auth` skill.

`src/routes/__root.tsx` decides access in `beforeLoad`, top-down, before any child route's `loader` fires. Three outcomes and no fourth:

| Visitor | Outcome |
|---|---|
| No admin session (anonymous, or signed in only as a client) | `throw redirect({ to: "/login", search: { redirect: location.href } })`, except on `/login` itself |
| Admin session, role not in `ADMIN_APP_ROLES` | `throw new NotAdminError(session)` → the root `errorComponent` renders `AccessDenied` **in place**, alone, without `AppShell` |
| Admin session, role in `ADMIN_APP_ROLES` | the shell renders |

`isAdmin` in `src/lib/auth.ts` makes the check against `ADMIN_APP_ROLES`, the browser copy of the list in `packages/auth/src/authorize.ts`. A project that adds a role such as `support` to the admin group adds it to both copies; the `saasaloy-auth` skill has the recipe.

The middle row is rare. `adminAuth` refuses to open a session for an account outside `ADMIN_APP_ROLES`, with "Invalid email or password" on the login screen, so a client account never gets this far. The row is for an account whose role a superadmin removed after it signed in. It still holds a valid admin session, so redirecting it to `/login` sends it straight back the moment the guard reads it, and the address bar ping-pongs. It gets a terminal panel with a sign-out button instead.

`AccessDenied` (`src/components/access-denied.tsx`) renders on its own, centered on the login screen's card, with no sidebar, header or user menu. The shell names every screen this app has, which a refused account has no reason to learn. The panel is the page's `<main>`, because no shell gives it one. `NotAdminError` keeps the session only so the panel can name the signed-in email.

**Every deny is a throw, and that is load-bearing.** `beforeLoad` runs before any loader, but only a
throw ends the match; a `beforeLoad` that returns normally lets every matched route's `loader` run.
So the non-admin case is a thrown `NotAdminError` (exported from `__root.tsx`) that the root route's
`errorComponent` turns into the panel, not a role check inside the component. Deny it in the
component instead and the loaders of the route the visitor asked for fire first, on their cookie,
before the panel paints. Keep the check in `beforeLoad` and no child loader runs for anyone the
guard turns away.

### This guard is the second half of the gate

The first half is `requireAdmin` (or `requireAdminApp`) in `@repo/auth/server`, and the api route is where it runs. Both read the admin session whatever the request's `x-auth-audience` header says. Use `requireAdmin` for admin-only work and `requireAdminApp` for a route every admin-app role may call, `support` included when a project adds it. `beforeLoad` stops this app from asking on a denied visitor's behalf; it cannot stop `curl`, a stale bundle, or a second client someone writes against the same api. Ship a new admin route and you wire both halves or you have shipped neither:

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

`GET /admin/users` is the shipped example. `modules/admin/files/api/routes/admin-users.ts` calls `requireAdmin`, then `adminAuth.api.listUsers` (the admin plugin's endpoints answer only on the admin instance), and answers `{ users, total }`. A `chained-route` patch registers it on api's exported chain, so `hc<AppType>` types it here for free. `src/routes/users.tsx` renders it, so both halves of the gate are live in the scaffold and the next route has a pattern to copy on each side.

Prove the server half yourself rather than trusting the screen. Sign in as a client through `POST /auth/sign-in/email`, take the cookie jar, and call the endpoint directly:

```sh
curl -i -b /tmp/client-cookies.txt http://localhost:4000/admin/users
```

That answers `401` with `{"error":{"code":"unauthorized","message":"sign in first"}}`, because a client cookie is no admin session at all. An admin session whose role was removed after sign-in gets `403` with `"role required: admin or superadmin"`. A `200` means the route skipped the gate, whatever the browser shows.

`src/lib/auth.ts` owns the read. `loadSession()` fetches once per page load and hands the same
promise to every caller, so a burst of navigations costs one round trip; `forgetSession()` drops it.
The memo has no expiry by design — a session revoked elsewhere stays cached until a sign-out or a
reload, which shows up as api calls answering 401 under a shell that still paints, never as access
a server denied. **Every code path that changes who is signed in calls `forgetSession()` before
`router.invalidate()`** — invalidating first re-runs the guard against the stale cache and undoes
the sign-in or sign-out that just happened. `login.tsx` and `components/sign-out-button.tsx` both
show the order.

`src/lib/auth.ts` builds its client with `createAdminClient(apiBaseUrl)` from `@repo/auth/client`, which talks to `/admin/auth` with `credentials: "include"`. It keeps the export name `auth`, so a module screen that imports `auth` from `@admin/lib/auth` reaches the admin session with no change. Never build this app's client with `createClient`: that is the client-group factory at `/auth`, and its session never opens this app.

The role string itself comes from better-auth's `admin()` plugin, which the `auth` module enables on both halves (`admin()` server-side, `adminClient()` in `adminAuthClientPlugins` in `packages/auth/src/client.ts`). Drop the client half and `session.user.role` stops being typed.

**The first account to sign up becomes the superadmin.** A `databaseHooks.user.create.before` hook in `packages/auth/src/auth.ts` writes `role: "superadmin"` when the `users` table is still empty, so a fresh project reaches this shell without SQL. This app has no sign-up, and neither has the admin instance, so the first account signs up as a client on `/auth` (a client app's sign-up screen, or `POST /auth/sign-up/email`) and then signs in here with the same email and password. Every account after it keeps the plugin's `"user"` default, and this app's login refuses it until a superadmin grants an admin-group role. Client sign-up is open, so claim that first slot the moment the api answers; if somebody beat you to it, the recovery SQL in the `saasaloy-auth` skill flips the row. That skill owns the rule and the recovery path both.

**A deep link survives the login hop.** The guard records the path it turned an anonymous visitor
away from as `?redirect=` on `/login`, and `login.tsx` navigates there after `forgetSession()` and
`router.invalidate()`. `src/lib/redirect.ts` decides whether that value may be used, and it has two
gates: `toInternalPath` rejects anything a browser could read as another origin (`//host`, `/\host`,
an absolute url, a control character), and `resolveDestination` then asks the router itself, through
`getMatchedRoutes(pathname)`, whether a route claims the path. Either failure falls back to `/`. A
new screen needs nothing here — it is in the generated route tree, so it is already a valid
destination.

There is deliberately **no sign-up route** here, and `adminAuth` sets `disableSignUp: true`. An admin account is made by promoting an existing user, never by self-service at the backoffice door. Only a superadmin may grant `admin` or `superadmin` (the rank guard in the `saasaloy-auth` skill).

## The typed client

`src/lib/api.ts` is the only place `hc` is called:

```ts
export const api = hc<AppType>(apiBaseUrl, {
  headers: { "x-auth-audience": "admin" },
  init: { credentials: "include" },
});
```

Four properties are load-bearing:

- **`AppType` is `apps/api`'s route chain.** `api.health.$get()`, its path and its per-status
  response shape all come from the route file. Change a response schema in `apps/api` and this app
  stops typechecking. Turbo runs `typecheck` across every workspace, so CI catches it.
- **`apiBaseUrl` is imported from `src/lib/auth.ts`**, not re-read from `import.meta.env`. The
  session cookie is scoped to the api origin, so an api client bound elsewhere would send none.
- **`init.credentials: "include"`** is why this file exists instead of a one-line `hc()` per call
  site. `fetch` omits cookies cross-origin by default, so without it every request from `:3001`
  arrives anonymous and the api answers 401.
- **`x-auth-audience: admin`** names which of the browser's two sessions each call means. The browser sends both cookies to the api host, the client one included when a client is signed in on another app in the same browser. The `requireAdmin*` gates read the admin session whatever the header says, but a generic gate (`requireSession`, `requireTenant`, `authFor(c)`) reads the session the header names. Without it, a teams or billing screen here would act as the client in the other tab. Any value other than `client` or `admin` gets 400.

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

A data route needs no `errorComponent` of its own: the router's default renders the admin `ErrorState` for a loader's throw and for a render failure. Add one only when the words should say more, as `/users` and the overview do.

## Theme and font

**The admin app carries its own theme file.** This module writes `packages/ui/src/styles/admin.css`, beside the web app's `web.css`. It imports the shared `globals.css`, which owns Tailwind's entrypoint, the `@source` globs and the base layer and holds no token values. `admin.css` then declares the `dark` custom variant, this app's `:root` and `.dark` values, its own `@theme inline` colour mapping and radius scale, the two extra accents, and one `@source` line. The variant and the mapping repeat `web.css`'s on purpose: each theme file holds its own, so a shadcn preset aimed at `web.css` never reaches this app.

That `@source` line is load-bearing. Tailwind scans content rather than imports, so `globals.css` names the base primitives the landing page renders one file at a time. This app renders only the admin set, so `admin.css` scans `../components/admin/**/*.tsx` and not the base components. A new file in `components/admin/` is covered with no change; drop the line and every admin primitive renders unstyled with no error. The admin blocks and containers are already in `globals.css`'s `blocks/**` and `containers/**` globs.

`src/main.tsx` imports `@repo/ui/styles/admin.css` and the Inter font package, and nothing else. That import needs the `"./styles/*": "./src/styles/*"` export in `packages/ui/package.json`, which the base template ships from the theme split onward. A project made before the split lacks it, and the admin build then fails to resolve `@repo/ui/styles/admin.css`. Run `saasaloy update` for the base and follow the steps under "A project made before the theme split" in the root `AGENTS.md` first. **No route imports a stylesheet.** Two Tailwind entrypoints in one bundle means two copies of the base layer and a token set whose winner depends on import order.

The palette is a three-step neutral ramp measured off the reference screenshots — canvas darkest, panel one step lighter, hover and selected one step lighter again — with alpha hairlines over it: white at 8 % on dark, black at 8 % on light, and inputs a step stronger. The measured values are written into the header comment of `admin.css` beside the roles they fill; change a value there and update the comment with it. Light is a mapped cream variant and is first-class, not a fallback.

`apps/admin/DESIGN.md` records these tokens and the rules behind them, and fingerprints `admin.css`. After you change `admin.css`, run the `saasaloy-design` skill's `update` flow for the admin app. A theme preset never targets `admin.css`; it reaches the web app only.

Beyond the shadcn set, `admin.css` declares the status pairs the primitives read (`--success`, `--warning`, `--info` and `--destructive-foreground`, each a fill tone and a darker text tone), the skeleton and toast keyframes, and two accents, all surfaced through `@theme inline`:

- `--status-open` (and `--status-open-foreground`) — the muted blue of `StatusPill`'s `open` tone and of a primary circular action.
- `--status-ok`, `--status-warn` and `--status-bad` (each with a `-foreground`) — `StatusPill`'s `ok`, `warn` and `bad` tones. They copy the `--success`, `--warning` and `--destructive` values, and they exist so a theme preset, which sets `--destructive` and `--destructive-foreground` with another meaning, never repaints a status. No preset sets a `status-*` key.
- `--accent-sort` — the orange on `DataTable`'s active sort header. It is reserved for one indicator at a time and for an AI surface. It is never a section background, and `StatusPill` deliberately has no orange tone.

**Dark by default, and every stored choice wins — `system` included.** `applyStartingTheme()` in `src/main.tsx` runs above `createRoot` and is one line: `setTheme(hasChosenTheme() ? getStoredTheme() : "dark")`.

The `theme` key alone cannot carry this. `setTheme("system")` DELETES it — that is how `@repo/ui`'s state machine spells "follow the OS", and the landing page depends on it — so a first visit and a deliberate `system` both read as an absent key. `hasChosenTheme()` separates them by reading a second key, `theme-chosen`, which `installThemeToggle()` writes on every press and nothing clears. Never chosen means dark; chosen with no `theme` key means `system`, resolved against the OS.

`index.html` emits no `THEME_INIT_SCRIPT` — that is the Astro host's mechanism, and there is no Vite plugin here. The trade is one frame of the light palette on an empty body before the entry module runs. `main.tsx` calls `installThemeToggle()` from `@repo/ui/lib/theme` instead, for the OS listener that script would otherwise install. The Theme submenu below sets the theme itself.

`ThemeMenuItem` is a "Theme" submenu (`MenuSub`, `MenuSubTrigger`, `MenuSubPopup`) with one `MenuRadioItem` per entry in its `THEME_OPTIONS` list. A pick calls `setTheme(value)` inside `revealTheme`, then writes `THEME_CHOICE_KEY`, so the starting-theme rule in `main.tsx` keeps the choice on the next load, `system` included. It does not use the delegated `[data-theme-toggle]` handler, because that handler only flips light and dark. The current choice is the `data-theme` attribute on `<html>`, which `setTheme` writes, read through a `MutationObserver`. To add a theme, teach `@repo/ui/lib/theme` to apply it, then add one entry to `THEME_OPTIONS`. `main.tsx` still calls `installThemeToggle()` for its OS listener, which repaints a visitor on `system` when the OS changes.

### The two dependencies the theme and the table add

- **`@fontsource-variable/inter`** is a runtime `dependency` of this app, imported from `src/main.tsx` beside `admin.css`, and set as `--font-sans` in a `@theme` block in `admin.css`. The import stays in the app because Tailwind resolves a CSS `@import` from the stylesheet's own folder, and `packages/ui` does not depend on the font. It is the app's only face; no mono font is loaded. The body enables Inter's `cv11` and `ss01` sets and `tabular-nums`, because counts sit in right-aligned columns in the nav and the table.
- **`@tanstack/react-table`** is a runtime `dependency` of `@repo/ui`, added by this module's `package-json-dependency` patch, and imported by `blocks/admin/data-table.tsx` and nowhere else. Features are registered once at module scope through `tableFeatures({ rowSortingFeature, ... })`; v9 has no global feature set, and naming them there is also what keeps the unused ones out of the bundle.

Both are exact-pinned. Template and module-descriptor dependencies are invisible to pnpm, so move them with `pnpm deps:update` and never by hand-typing a version.

A project that installed admin before the table moved into `@repo/ui` gets the dependency in a new workspace on `saasaloy update`. pnpm can then record it in `pnpm-lock.yaml` without its React peers and link `packages/ui/node_modules/@tanstack/react-table` to a folder that does not exist, and the admin build fails with "failed to resolve import @tanstack/react-table". Run `pnpm install --fix-lockfile` once to repair the entry.

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

Cookie behaviour is the `auth` module's (ADR 0004). Cross-origin dev works because api's `cors()` sets `credentials: true` for the allowlisted origins and the cookie is host-only on `localhost`. Cookies ignore the port, so `:3000` and `:3001` see the same jar; the names `client.session_token` and `admin.session_token` are what keep a client sign-in on the web app from replacing this app's session. In
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

`pnpm deploy:production` deploys this app with every other Worker. Its `deploy` script is
`env-deploy admin`, which builds with the `admin` service's production values in the
environment, so the bundle inlines the production `PUBLIC_API_URL` and the dev `.env` stays as it
is. The app is assets-only, so it gets no secrets.

`saasaloy add admin` appends `{ service: "admin", order: 20 }` to `DEPLOY_TARGETS` in `packages/tooling/src/targets.ts`, so the admin deploys after the api it calls and before the web. It also appends the `admin-home` smoke check, `GET /` with a 200, which runs once `apps/admin/wrangler.jsonc` has a `routes[]` entry with `custom_domain: true`. `pnpm deploy:production --only admin` deploys this app alone after the gates. See the `saasaloy-deploy` skill.

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
- **A screen composes the admin blocks.** Start from `PageHeader` and `PageLayout` or `PageBody`; do not write shell markup, table markup, padding, or a page width of your own.
- **Admin code imports the admin set only.** `@repo/ui/components/admin/*`, `blocks/admin/*` and `containers/admin/*`; the lint rule fails a base primitive.
- **A block takes plain props and callbacks.** Nothing in `@repo/ui` imports `@repo/api`, `hono/client`, `@admin/lib/api`, a router, or reads `import.meta.env`.
- **`@tanstack/react-table` is imported by `data-table.tsx` and by nothing else.** A route that imports a `ColumnDef` has skipped the wrapper the next screen depends on.
- **Every mutation reports through a toast**, a destructive one confirms in an `AlertDialog` first, and a create flow opens in a `Dialog`.
- **`NAV_AREAS` stays `as const`.** That literal type is what turns a nav entry for a missing route
  into a typecheck failure instead of a 404.
- **One theme file, `@repo/ui/styles/admin.css`, imported once from `src/main.tsx`.** A second Tailwind
  entrypoint duplicates the base layer and makes the token set order-dependent.
- **Dark is the default, and a stored choice wins.** Gate it on `hasChosenTheme()`. `getStoredTheme()`
  alone cannot tell an unset key from a deliberate `system`, because `system` is spelled as no key.
- **Orange is `--accent-sort` and nothing else.** One active sort indicator, or an AI surface. Never
  a section background and never a status pill.
- **Loading, not-found and error screens come from the app.** Inherit the router defaults and `__root.tsx`'s `notFoundComponent`; override a route's `errorComponent` only for better words, and do not write error markup outside the admin `ErrorState`.
- **One `hc` call, in `src/lib/api.ts`.** Import `api`; do not build a second client, and do not drop its `x-auth-audience: admin` header.
- **The auth client is `createAdminClient`.** `src/lib/auth.ts` exports it as `auth`; never swap in `createClient`.
- **`/admin/auth/*` belongs to the admin auth instance.** An api route or middleware this app adds under `/admin/*` must not claim or gate it.
- **One origin for api and auth**, from `src/lib/auth.ts`'s `apiBaseUrl`. A split origin loses the
  session cookie.
- **The guard lives in `__root.tsx`'s `beforeLoad`**, and it is default-deny. A per-route session
  check is redundant, because every deny there is a throw and no child loader runs after one. Keep
  it that way: a deny that returns instead of throwing silently re-opens the loaders it was meant to
  stop. Do not turn `AccessDenied` into a redirect either.
- **Every admin endpoint calls `requireAdmin` or `requireAdminApp`**, whatever the guard in `__root.tsx` does. The screen inheriting `beforeLoad` is not authorization; it is the reason a missing server check looks fine in a browser.
- **`forgetSession()` before `router.invalidate()`**, on every sign-in and sign-out path.
- **Describe a request once with `queryOptions`**, prefetch in the loader, read with `useQuery`,
  refresh by invalidating the key.
- **Browser env vars are `PUBLIC_*`.** A `VITE_*` name is not exposed here.
- **No bindings and no Worker entry.** Anything needing D1, R2 or a secret belongs in `apps/api`.
