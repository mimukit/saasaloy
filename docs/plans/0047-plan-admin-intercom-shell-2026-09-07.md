# Plan: Intercom-style shell, layout, and theme for the admin app
Grilled: 2026-09-07

## Context

`apps/admin` (scaffolded by `modules/admin`) renders one 240px sidebar next to a content column, on the shared shadcn `neutral` theme, in light mode only: `index.html` never emits `THEME_INIT_SCRIPT`, so the `.dark` class is never set. The dashboard is a single `Card` under a page heading. The api already ships `GET /admin/users` (typed through `hc<AppType>`, role-gated by `requireAdmin`) and nothing in the app renders it. The seed proves the wiring (guard, typed client, Query) and nothing about how a real backoffice should look.

The target is the Intercom inbox app, as shown in three reference screenshots (2026-09-07) and the `DESIGN-intercom.md` analysis of intercom.com. The screenshots show the in-app surface: a near-black canvas, three or four floating panels with rounded corners and a small gutter between them, an icon rail on the far left, a secondary nav panel with collapsible groups and per-item counts, a content panel with a title bar, a filter chip row, a dense data table with sortable columns and status pills, and an optional detail panel on the right with tabs and stacked attribute groups. The design file describes the marketing site (cream canvas, Saans type, charcoal primary). Where the two disagree, the screenshots win for surfaces and colour; the design file supplies the type scale, radii, spacing, and the font substitute.

Success means `saasaloy add admin` in `.dev` scaffolds an app whose shell, overview, users screen, and login read as this design in both dark and light mode, and a feature module can add a screen that inherits the shell and reuses the page primitives with no styling work of its own.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Source of truth | Screenshots win for surfaces and colour. `DESIGN-intercom.md` supplies type scale, radii (8/12/16px), spacing (8px base), and the Inter substitute. The cream canvas and Saans are marketing-site facts and are not copied into the app. |
| Default theme (grilled Q1, Q10) | Dark unless the user picks otherwise. `main.tsx` calls `setTheme("dark")` when no theme key is stored, else `setTheme(getStoredTheme())`, before `createRoot`. The admin app runs on its own origin, so its storage key never touches the landing page's. Light is a mapped variant: cream canvas `#f5f1ec` from the design file, white panels, warm hairline `#d3cec6`. Both themes ship and the light theme is first-class. |
| Theme init (grilled Q2) | No Vite plugin and no pasted script. The `setTheme` call at the top of `main.tsx` runs before React renders into an empty root div, so nothing paints untinted. The rail footer renders the existing `theme-toggle` block. |
| Where the theme lives | Admin-scoped. `modules/admin/files/src/styles/admin.css` imports `@repo/ui/globals.css` and then redeclares the shadcn variables (`--background`, `--card`, `--sidebar*`, `--border`, `--radius`, and the rest) for `:root` and `.dark`. `main.tsx` imports `admin.css` instead of `globals.css`. `packages/ui/src/styles/globals.css` and the landing page do not change; the base `DESIGN.md` gains prose only (see below), so its token fingerprint (ADR 0027) holds. |
| Base `DESIGN.md` (grilled Q9, Q11) | Gains a new `## Apps` section with one generic statement: an app may carry its own token set in its own stylesheet on top of these tokens, the admin app does, and its skill documents the values. True with or without the admin module, because a module cannot patch Markdown. Run the official linter after the edit. |
| Font | Inter variable through an exact-pinned `@fontsource-variable/inter` dependency in `apps/admin`, imported from `admin.css`, set as `--font-sans` in a `@theme` block. Weight 500 for titles, 400 for body, negative tracking on titles only. |
| Layout | Three floating panels on the canvas: icon rail (fixed, about 56px wide, no panel chrome), nav panel (about 240px, hidden behind a toggle below `md`), content panel (fills the rest). Panels have `rounded-xl` corners and an 8px gutter. The detail panel is not a shell slot (see below). |
| Nav model (grilled Q12) | The rail holds top-level areas (icon plus tooltip, badge for a count). The nav panel holds the active area's tree: a title row with actions, then `Collapsible` groups of rows with icon, label, and right-aligned count. The seed ships one area, "Admin", whose nav panel lists Overview and Users under one group. `NAV_ITEMS` in `app-shell.tsx` becomes `NAV_AREAS` and stays typed against the route tree. |
| Nav state (grilled Q8) | Resets per load. Groups open by default. No storage key. |
| Detail panel (grilled Q6, Q13) | Route-owned. A `PageLayout` component takes an optional `detail` node, and the route holds the selected row in its own state. Below `md` the detail renders in a `Sheet` that slides over the content. |
| Data table (grilled Q5) | `@tanstack/react-table`, exact-pinned, wrapped by an admin `DataTable` component that exposes a plain `columns` and `rows` API with optional client-side sort. Callers never import the library directly. |
| Screens (grilled Q3, Q4) | Two routes. `/` keeps the health overview, restyled on the new primitives. New `/users` renders `GET /admin/users` as the table (name, email, role, verified, created) with a `FilterChips` row filtering by role client-side, and a detail panel showing the selected user's attributes. No static demo rows anywhere. |
| Page primitives | Admin-side components under `src/components/`: `PageLayout`, `PageHeader`, `FilterChips`, `DataTable`, `StatusPill`, `AttributeList`, `DetailPanel`. They compose ui primitives, take plain props and callbacks, and stay free of api imports (ADR 0030 rule). |
| New ui primitives (grilled Q7) | `tooltip`, `dropdown-menu`, `collapsible`, `table`, `avatar`, `tabs`, `scroll-area`, and `sheet` are added to the base `packages/ui/src/components/` through `pnpm --filter @repo/ui exec shadcn add`. They land in the base, not in the admin module's `files/`, because a module dropping into `@ui/components/` would collide with a later base addition. Projects without admin carry the unused files. |
| Accent colours | Neutral charcoal/white primary. A muted blue pill for the `Open`-style status and the primary action, as in the screenshots. Orange is reserved for the active sort indicator and any AI surface, never a section background. Colours land as `--status-open`, `--accent-sort` variables in `admin.css`. |
| Login | Keeps its logic and re-renders as one centred panel on the canvas. |

## Approach

Restyle from the outside in: theme first, then the shell, then the page primitives, then the routes on top of them. Every step reuses what exists.

Reused as is: `@repo/ui/lib/theme` (`getStoredTheme`, `setTheme`), `@repo/ui/blocks/theme-toggle`, `Button`, `Badge`, `Card`, `Input`, `Label`, `Separator`, `cn`, `lucide-react`, the root guard in `__root.tsx`, `loadSession`/`isAdmin`, the `queryOptions` + loader pattern in `routes/index.tsx`, the `GET /admin/users` route and its `hc<AppType>` typing, and the `ErrorState` block for not-found and errors. The shell keeps the `aria-current` active-link styling and the nav-checked-against-route-tree property the current `app-shell.tsx` explains.

Rejected at a line each: changing the shared `globals.css` so the whole monorepo turns dark (the landing page has its own design contract); a Vite plugin to inject the theme script (a one-line call in `main.tsx` does the job); system fonts (the design reads flat without a weight-500 geometric sans); static demo rows (the api already has real, typed, gated data); a shell-level detail slot (state would live above the route); a hand-rolled table (every module would reinvent sort).

### Phase 1: admin theme and font (#123)

- Add `modules/admin/files/src/styles/admin.css`. It imports `@repo/ui/globals.css` and `@fontsource-variable/inter`, then redeclares the shadcn variables for `:root` (light: cream canvas, white panels, warm hairline) and `.dark` (measured from the screenshots: canvas about `oklch(0.14 0 0)`, panel about `oklch(0.20 0 0)`, hover row one step lighter, hairline at low-alpha white). Record the final measured values in the file's header comment. Set `--radius: 0.75rem` and add `--font-sans`, `--status-open`, `--accent-sort` in `@theme inline`.
- `main.tsx` imports `./styles/admin.css` and drops the `globals.css` import. Keep the comment that no route imports a stylesheet again. Above `createRoot`, apply the theme: `setTheme("dark")` when `localStorage` has no `THEME_STORAGE_KEY`, else `setTheme(getStoredTheme())`, with a comment naming the dark-by-default decision.
- Add `@fontsource-variable/inter` to `modules/admin/files/package.json`, exact-pinned via `pnpm deps:update`, and register the new file in `registry-item.json`.
- Add the `## Apps` section to `packages/cli/templates/base/DESIGN.md` and run the official linter through `pnpm dlx` as the `saasaloy-design` skill prescribes. Confirm the fingerprint is untouched.
- Verify in `.dev`: `saasaloy add admin`, `pnpm dev`, the shell paints dark with Inter on a fresh profile, the toggle cycles and persists, and `pnpm deps:verify` and the four-pass `pnpm lint` are green.

### Phase 2: ui primitives in the base (#123)

- In `packages/cli/templates/base/packages/ui`, run `shadcn add tooltip dropdown-menu collapsible table avatar tabs scroll-area sheet`. Review each file for the repo's conventions (`data-icon` slots, `cn`, base-ui imports), the same way `button.tsx` and `accordion.tsx` were reviewed.
- Pin any new `@base-ui/react` version change through `pnpm deps:update`; the ui package already depends on it.
- Verify: `@repo/ui:typecheck` green in `.dev`, `pnpm lint` green in the tool repo, the landing page output unchanged (no block imports the new files).

### Phase 3: the shell (#123)

- Rewrite `src/components/app-shell.tsx` into the rail + nav panel + content panel layout on a canvas with an 8px gutter. Split into `rail.tsx` (areas with `Tooltip` and count `Badge`, footer with the theme toggle and an `Avatar` that opens a `DropdownMenu` holding the account name, email, and sign-out), `nav-panel.tsx` (title row with actions, `Collapsible` groups, rows with icon, label, and count), and `app-shell.tsx` as the composer.
- Replace `NAV_ITEMS` with `NAV_AREAS`: each area has an icon, a label, a `to`, and groups of items. The seed ships one area, "Admin", with one group listing Overview (`/`) and Users (`/users`). Every `to` stays typed against the generated route tree.
- Below `md` the nav panel hides behind a toggle in the content header and the rail stays. Touch targets hold 44px as today's shell does. No nav state is stored.
- Move the account block out of the nav panel and into the rail footer, matching the screenshots. `sign-out-button.tsx` becomes a menu item or is called from one.
- Verify in `.dev`: all routes render inside the shell, active state follows `aria-current`, not-found and access-denied still render inside the shell, keyboard focus order runs rail → nav → content.

### Phase 4: page primitives (#123)

- Add `src/components/page-layout.tsx` (content column plus optional `detail` node; below `md` the detail renders in a `Sheet`), `page-header.tsx`, `filter-chips.tsx`, `data-table.tsx`, `status-pill.tsx`, `attribute-list.tsx`, `detail-panel.tsx`. Each takes plain props and callbacks, imports only React and `@repo/ui` (and `@tanstack/react-table` inside `data-table.tsx` only), and carries an in-file comment naming its Intercom counterpart.
- `DataTable` wraps `@tanstack/react-table` (exact-pinned, added to the admin `package.json` via `pnpm deps:update`): a `columns` array with optional `sortable`, `rows`, `onRowClick`, `selectedId`, sticky header, row hover, `—` for empty cells, an `emptyState` slot. Sorting is client side. The sort indicator uses `--accent-sort`.
- `DetailPanel`: `Tabs` header, open-in-new and close actions, `ScrollArea` body of `Collapsible` groups each wrapping an `AttributeList`.
- Verify: `pnpm typecheck` green, every primitive rendered by a route in Phase 5.

### Phase 5: overview, users, login, docs (#123)

- Restyle `src/routes/index.tsx`: `PageLayout` and `PageHeader` "Overview", the health result as a `StatusPill` and an `AttributeList`. Keep the loader + Query wiring and the `DashboardError` fallback.
- Add `src/routes/users.tsx`: a `queryOptions` over `api.admin.users.$get()`, prefetched in the loader; `PageHeader` "Users" with the `total` count; `FilterChips` for All / Admins / Users filtering client-side by role; `DataTable` with name, email, role (`StatusPill`), verified, created; row click sets the selected user and `PageLayout` renders a `DetailPanel` with an `AttributeList` of that user's fields. The router plugin regenerates `routeTree.gen.ts`; commit the result, do not hand-edit it.
- Restyle `src/routes/login.tsx` as one centred panel on the canvas; logic unchanged.
- Update `skills/saasaloy-admin/SKILL.md`: the shell anatomy, how to add a rail area and a nav group, the primitives and their props, `/users` as the worked example in place of the "nothing renders it yet" note, the admin-scoped theme and the dark-by-default rule, and the Inter and react-table dependencies. Update `modules/README.md` if the admin row describes the old shell.
- Verify in `.dev`: anonymous redirect, sign-in, overview, users table sorts and filters, row click opens the panel (side panel at desktop, sheet below `md`), sign-out from the rail menu, all in both themes; `pnpm build` and `wrangler deploy --dry-run` green; `pnpm lint` and the CLI tests green in the tool repo.

## Non-goals

- No change to the shared theme, the landing page, or the base `DESIGN.md` token fingerprint.
- No user editing, search, command palette, notifications, or pagination beyond the api's first 100 users.
- No AI or "Copilot" panel content; the detail panel's second tab is left empty.
- No stored nav state and no server-driven layout preferences.
- No Saans or SaansMono; Inter is the substitute, and no mono font is added.
