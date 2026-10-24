# Plan: polish the admin shell, and give each app its own theme in `@repo/ui`

Grilled: 2026-10-18

Updated: 2026-10-18, to add the admin primitive set (new Phase 4) and the two reference kits. A second grill the same day settled the questions they raised (Q1 to Q8 of that grill).

Tracked: Phase 1 in [#193](https://github.com/mimukit/saasaloy/issues/193), Phases 2 to 7 in [#192](https://github.com/mimukit/saasaloy/issues/192), a sub-issue of [#183](https://github.com/mimukit/saasaloy/issues/183)

Builds on: [`0047-plan-admin-intercom-shell-2026-09-07.md`](0047-plan-admin-intercom-shell-2026-09-07.md) (#123, built)

Blocks: Phase 3 of [`0068-plan-landing-page-template-2026-10-18.md`](0068-plan-landing-page-template-2026-10-18.md) (#191), which writes into the `web.css` that Phase 1 here creates

## Context

Plan 0047 gave `apps/admin` an Intercom-style shell: an icon rail, a nav panel, a content panel and an optional detail panel, on an admin-scoped dark theme with Inter. It works, and a team would still not ship it as-is. The owner names four gaps:

- **Module pages differ.** billing, feature-flags, api-keys, rbac and teams each add an admin route, and every one of them renders its own `<main className="mx-auto max-w-Nxl px-6 py-10">` and its own `h1`. None uses `PageLayout`, `PageHeader` or `DataTable`. They read as a second app inside the shell.
- **The shell chrome is plain.** Spacing, type, active states and the account menu in the rail and the nav panel look unfinished.
- **Lists and details are thin.** No list or detail view has an empty, a loading or an error state of its own. Table density, chips and the detail panel need a design pass.
- **Overview and sign-in are bare.** `/` shows one health check. `/login` is a plain form on a panel.

A second problem sits under the first. The two apps share one token file and one design document, and the admin primitives live outside the shared UI package:

- `packages/ui/src/styles/globals.css` holds the Tailwind setup and the web token values in one file. The root `DESIGN.md` describes those values, a fingerprint over `globals.css` detects drift, and a theme preset (#64) writes into it.
- `apps/admin/src/styles/admin.css` overrides every token for the admin app. The admin app has no `DESIGN.md`, only one paragraph in the root file's `## Apps` section.
- The admin page primitives live in `apps/admin/src/components/`, so a module page and the #185 gallery cannot reach them through `@repo/ui`.

A third problem sits under the design pass. The admin app has only the base template's shadcn `base-nova` primitives: button, card, input, sheet, tabs, table, tooltip, a dropdown menu and a few more. It has no dialog, select, combobox, toast, field, input group, checkbox, switch, skeleton or empty state, so every module page that needs one improvises it. The owner wants a dashboard-grade primitive set modelled on two kits, [coss ui](https://coss.com/ui) ([cosscom/ui](https://github.com/cosscom/ui)) and the purchased [shadcnuikit](https://shadcnuikit.com/admin-dashboard) dashboard, owned as source in this repo with no kit package as a dependency.

**Success:** a module page renders inside a shared page frame and looks like the core screens, and a later change to that frame or to a shared primitive needs no edit to any module file. Each app has its own theme file and its own `DESIGN.md`. `@repo/ui` holds the components for both apps under the owner's layer layout. The panel looks finished in light and dark themes, at mobile and desktop widths, with empty, loading and error states on every list and detail view, and with a place for the #141 organization picker. Every admin page and block builds on one admin primitive set in `@repo/ui`, and the admin app's `package.json` gains no UI kit dependency.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Relation to plan 0047 | This plan refines 0047. The content panel and the route-owned detail panel stay. The rail and nav panel stay unless the Phase 2 mockup picks the sidebar shell (see "Shell shape" below). `NAV_AREAS` typed against the route tree stays. Dark by default stays. 0047's non-goals (search, command palette, pagination, stored nav state) stay non-goals. Plan [0084](0084-plan-command-module-2026-10-24.md) (#264) lifts the command palette non-goal on 2026-10-24. |
| `@repo/ui` layer layout | Seven top-level folders, no `admin/` or `web/` at the root of `src/`: `assets` (images, SVGs, icons), `blocks` (compound components built from primitives), `components` (shadcn primitives, official and custom), `containers` (shells and layouts that hold blocks and components), `content` (copy, in one place for later i18n), `lib` (utilities), `styles` (CSS files with the token variables). A folder may hold `admin/`, `web/` or `shared/` children where a split helps. The existing names `content` and `lib` stay. |
| Meaning of `containers` | Changes from "binds a store and wires it into blocks" to "a shell or a layout that holds blocks and components on a page". `containers/README.md` and the base `AGENTS.md` say so. The no-IO rule for all of `@repo/ui` stays. |
| The `assets` layer (grilled Q12) | The docs list it now. The first real asset creates the folder and `assets.d.ts`. If the Phase 2 mockup puts a brand mark in the rail, that SVG is the first asset. No empty folder ships. |
| Order against #191 (grilled Q1) | The CSS split is Phase 1 here and lands as its own PR before #191 Phase 3. Plan 0068 Phase 3 writes its rhythm and type tokens into `web.css` and `apps/web/DESIGN.md`. That retarget was settled in this grill, so 0068 keeps its stamp. |
| Shared CSS layer (grilled Q2, Q10) | `globals.css` keeps its name, so `@repo/ui/globals.css` imports keep resolving. It holds only the Tailwind imports, `tw-animate-css`, `shadcn/tailwind.css`, the `dark` custom variant, the base layer and the `@source` lines. Its header comment names `web.css` and `admin.css` as the token files. |
| Theme files (grilled Q10) | `packages/ui/src/styles/web.css` and `packages/ui/src/styles/admin.css` each import `globals.css` and hold their own `:root`, `.dark`, `@theme inline` colour mapping and radius scale. The mapping repeats in both files on purpose. A prototype with shadcn 4.21.0 showed that a preset merges in place only when the target file holds the `@theme inline` block. With the mapping in `globals.css`, shadcn writes a second `@theme inline`, a second `@custom-variant dark` and a different radius formula into the target. With the target left at `globals.css`, the build passes and the old theme wins. |
| Preset target and fingerprint (grilled Q10) | `components.json`'s `tailwind.css` points at `src/styles/web.css`. `verify:preset` and the `saasaloy-design` fingerprint move to `web.css`. Each `DESIGN.md` fingerprints its own theme file. Only `web.css` ever takes a preset (grill 2, Q7). `admin.css` is hand-tuned and fingerprinted by `apps/admin/DESIGN.md`, and no preset, `@coss/style` included, writes to it. A second `components.json` for admin is rejected, because shadcn would then write into the base `components/`. |
| A `DESIGN.md` per app (grilled Q3) | `apps/web/DESIGN.md` for the web theme and `apps/admin/DESIGN.md` for the admin theme, which the admin module ships. The root has no design document. The base `AGENTS.md` says where each app's `DESIGN.md` lives, and the admin module's skill adds its line. |
| Existing projects (grilled Q11) | The normal update path, with no migration code. `web.css` arrives as a `create`. `globals.css` and `Layout.astro` are base-owned, so they go to the merge plan. The root `DESIGN.md` is a seed, so `update` leaves it in place. The base `AGENTS.md` and the release notes give the steps: move the `:root` and `.dark` blocks and the mapping into `web.css`, point the web import at `web.css`, then move `DESIGN.md` to `apps/web/`. The admin module drops `apps/admin/src/styles/admin.css` (a `delete`, or a `delete-drift` with a warning when edited) and creates `packages/ui/src/styles/admin.css`. |
| Admin primitives move to `@repo/ui` | In this plan. The admin module writes them, so a project without admin carries none of them. Files the admin module writes into `packages/ui/src/**` sit under the admin module's manifest record. The base's `ownedFiles` globs apply only to base entries, so a base update never claims them. |
| Primitive folders (grilled Q6) | `blocks/admin/` for `DataTable`, `DetailPanel`, `FilterChips`, `AttributeList`, `PageHeader` and the new `EmptyState`. `components/admin/` for `StatusPill`, because it reads `--status-open`, which only `admin.css` defines. `containers/admin/` for `PageLayout`, the page frame, the rail, the nav panel and the shell layout. `StatusPill` moves to `components/shared/` the day the web app needs a pill. |
| Router-bound code stays in the app | `@repo/ui` imports no router and no session. `nav.ts` (typed against the route tree), the route guard and the session stay in `apps/admin`. A shell container in `@repo/ui` takes the nav data, the current path and a link renderer as props, and `apps/admin` passes them in. |
| Page frame (grilled Q4) | `containers/admin/page-frame.tsx`, rendered by `__root.tsx` around `<Outlet />`. It owns the padding, the scroll area and the error boundary. A route renders `PageLayout` inside it, so the `/users` detail panel stays beside its list, as it does today. |
| Title row (grilled Q5) | The route renders the shared `PageHeader` inside the frame. A static title on the route cannot carry billing's live Refresh state or a live count. A change to `PageHeader` still reaches every page with no module edit, because the file lives in `@repo/ui`. |
| Loading, error and empty states (grilled Q13) | Router defaults in `apps/admin/src/main.tsx`: `defaultPendingComponent` renders a skeleton block in the frame, and `defaultErrorComponent` renders the admin `ErrorState` (`blocks/admin/error-state.tsx`) in the frame. An empty list is `DataTable`'s `emptyState` slot, filled with the shared `EmptyState` block. A route overrides only when it needs to. `/users` keeps `UsersError` as the worked example of an override. |
| Module page scope (grilled Q14) | Each module page drops its own `<main>` and `h1` and renders `PageHeader`. Lists of records move to `DataTable`, and a selected record opens in `DetailPanel`: billing invoices, api-keys keys, teams organizations, rbac roles. Editors stay bespoke inside a panel: the rbac permission grid, the teams create form, the flags toggle list. |
| Overview (grilled Q8) | `/` shows the api health, the user count and the newest five sign-ups, all from `GET /health` and `GET /admin/users`. No new api route. Module-contributed overview cards are a follow-up issue. |
| Mockup record (grilled Q7) | A throwaway HTML mockup rendered in the T3 thread, never committed. The picks are recorded as text under Phase 2. The #192 issue body links that plan section in place of a mockup link. This is the method plan 0068 used for #191. |
| Visual check (grilled Q9) | A manual QA plan under `docs/qa/` covers the seven admin pages and sign-in at 360 px and 1280 px in both themes. An automated `verify:a11y` run over a seeded admin app is a follow-up issue for after #178's seed data lands. |
| Runtime dependencies of the primitive set (added 2026-10-18) | The admin primitives depend only on what `@repo/ui` already ships: the headless `@base-ui/react`, plus `class-variance-authority`, `clsx`, `tailwind-merge` and `lucide-react`. No UI kit package (`@coss/*`, shadcnuikit, `radix-ui`) and no single-purpose widget library (cmdk, sonner, vaul, react-day-picker, recharts, embla, input-otp) enters any `package.json`. Base UI is kept because a menu, a dialog, a select and a combobox each need a focus trap, floating positioning and keyboard handling, and writing those is several thousand lines plus an a11y test burden. |
| Sources and licences (added 2026-10-18, grill 2 Q1, Q8) | coss ui is the code source. Copy and adapt only from `apps/ui/registry/default/**` in cosscom/ui, which is MIT. Never copy from its `packages/ui/src/**`, which carries `AGPL-3.0-or-later`. The only attribution is `packages/ui/src/components/admin/NOTICE.md`, which holds the MIT text and `Copyright (c) 2025 coss.com`, as the MIT licence requires of every copy. It carries no repo URL and no commit SHA, and no ported file carries an origin comment. shadcnuikit is a visual and layout reference only, permanently, whatever its purchase terms allow: no file, class string or CSS block is copied from it. Its repo has no licence file and grants no redistribution, saasaloy is public, and `saasaloy add` copies templates into every user's project. Its primitives are also Radix (`radix-nova`), so they would need a rewrite against Base UI anyway. |
| Copied once (grill 2, Q6) | The ports are a one-time copy. Nothing links the repo to coss after Phase 4: no sync script, no registry entry, no recorded source version. A later change to a component or a new component is a hand edit in `components/admin/`, and the edit keeps `NOTICE.md` in place. |
| Component count (grill 2, Q2) | All 37 components in Phase 4 step 2 ship, including any that no page renders yet. A complete set up front means a module page never has to improvise a missing control. The sidebar port is the only conditional one. |
| Import guard (grill 2, Q3) | A `no-restricted-imports` override in the base template's `oxlint.config.mjs` covers `apps/admin/**` and `packages/ui/src/{blocks,containers,components}/admin/**`. It bans `@repo/ui/components/*` except `@repo/ui/components/admin/*`, so `pnpm lint` fails on a base primitive under an admin path. The globs match nothing in a project without admin. A name prefix such as `AdminButton` is rejected, because it breaks the coss names. |
| Base blocks in the admin app (grill 2, Q4) | The admin module writes `blocks/admin/theme-toggle.tsx` and `blocks/admin/error-state.tsx` on the admin set. They reuse `content/errors` and `lib/theme`, so the copy and the theme logic stay in one place. The base `ThemeToggle` and `ErrorState` stay unchanged for the web app. `admin.css` drops its base `@source "../components/*.tsx"` line. |
| Base UI 1.9.0 (grill 2, Q5) | Settled by fact. 1.9.0 (2026-10-09) has no breaking changes. Its behaviour changes are a native `disabled` attribute on Accordion and Collapsible triggers and no `role="presentation"` on the Scroll Area viewport. The base primitives style with `aria-disabled:`, and no file or test queries `role="presentation"`. |
| Location of the primitive set (added 2026-10-18) | `packages/ui/src/components/admin/`, written by the admin module through the `@ui` alias. A project without the admin app carries none of it. The base `components/` keeps the shadcn `base-nova` primitives for the web app, so `shadcn add` keeps working there and the landing page (#191) is untouched. A name such as `button.tsx` exists twice on purpose. The admin set imports nothing from the base `components/`. |
| Shell shape (added 2026-10-18) | Open until Phase 2. The mockup shows both the current rail plus nav panel and a sidebar shell in the shadcnuikit pattern: an inset sidebar with grouped nav, an icon-collapsed mode, a mobile sheet and a sticky top header with the user menu. The owner picks one. Either way the shell stays router-free in `containers/admin/`. |

## Approach

Restructure first with no visual change, then apply the design on the new structure. The restructure moves files and splits CSS, and its acceptance is "nothing looks different". The design pass then edits each file only once, in its final home. The admin primitive set lands between the two: after the blocks move, so each block changes its imports once, and before the module pages move, so each module page is rewritten once, onto the final primitives.

**Reuses:** the shell, the page primitives and the `/users` worked example from 0047; `NAV_AREAS`, `navCount` and `areaFor` in `nav.ts`; the `nav-entry` patch kind (`packages/cli/src/lib/patch/nav-entry.ts`) that the five modules already use; the `package-json-dependency` patch kind for `@tanstack/react-table`; the `ErrorState` block and `errors` content for error states; `@repo/ui/lib/theme` for the theme toggle; the `@source` line pattern in `admin.css`; `scripts/verify-preset.ts` and the `saasaloy-design` fingerprint flow; the update actions in `packages/cli/src/lib/updater.ts` (`create`, merge plan for owned files, `delete`/`delete-drift`) and the base ownership split in `_saasaloy-base.json` (ADR 0032); the throwaway HTML mockup method from plan 0068; the `@ui` alias that the admin module already uses to write `admin.css`; the `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge` and `lucide-react` pins in `packages/cli/templates/base/packages/ui/package.json`; the `cn` helper in `@repo/ui/lib/utils`; the `./components/*` export, which already resolves `components/admin/<name>`. From coss ui: the component sources in `apps/ui/registry/default/ui/` and their `data-slot` names, the `info`, `success` and `warning` token pairs, the highlight edge (a `before:` pseudo-element with a 1px alpha shadow), the alpha borders and inputs, and the control heights (`h-9 sm:h-8` buttons, `h-8.5 sm:h-7.5` inputs). From shadcnuikit, as reference only: the inset sidebar layout, the header's user and notification menus, the users table pattern (sorting, column visibility, row selection), the settings sub-nav layout, the empty-state pages and the sign-in variants.

**Rejected:** the zero-dependency primitive set (our own focus trap, positioning and menus is several thousand lines and an a11y test burden); copying shadcnuikit files (no redistribution grant, and Radix-based); copying from coss's AGPL `packages/ui`; replacing the base `components/` with coss ports for both apps (it changes the landing page and breaks drop-in `shadcn add`); installing coss through `shadcn add @coss/<name>` (it writes into the base `components/` and pulls the registry's current version on every run); an origin comment or a commit SHA on the ports (the owner wants no link to coss; `NOTICE.md` alone meets the MIT condition); a name prefix such as `AdminButton` (it breaks the coss names); a separate `packages/admin-ui` workspace (the owner wants one UI package for both apps); `admin/` and `web/` folders at the root of `packages/ui/src` (the owner wants the seven layers at the root); migrating each module page onto `PageLayout` by hand with no shared frame (the next layout change would need five module edits again); the colour mapping kept in `globals.css` (a preset then duplicates blocks or silently keeps the old theme); migration code in `saasaloy update` for one release.

### Phase 1: split the styles and the design documents (#193) (built 2026-10-18)

1. Reduce `packages/ui/src/styles/globals.css` to the shared layer: the Tailwind imports, `tw-animate-css`, `shadcn/tailwind.css`, the `dark` custom variant, the base layer and the `@source` lines. Add a header comment that names `web.css` and `admin.css`. As built, the `dark` custom variant sits in each theme file instead of `globals.css`: shadcn 4.21.0 does not read through `@import`, so `pnpm verify:preset` found a second `@custom-variant dark` appended to `web.css` with the variant in `globals.css`.
2. Move the web `:root`, `.dark`, `@theme inline` mapping and radius scale into `packages/ui/src/styles/web.css`, which imports `globals.css`. Add a `./styles/*` export to `packages/ui/package.json`. Point `apps/web` at `web.css`.
3. Point `components.json`'s `tailwind.css` at `src/styles/web.css`. Move the fingerprint in `verify-preset.ts` and in the `saasaloy-design` skill to `web.css`. Check `MUST_SURVIVE` against `globals.css` and the token blocks against `web.css`.
4. Move the admin module's `apps/admin/src/styles/admin.css` to `packages/ui/src/styles/admin.css`. Give it its own `@theme inline` mapping, fix its `@source` paths, and point `apps/admin/src/main.tsx` at it.
5. Move the root `DESIGN.md` to `apps/web/DESIGN.md`, and update `seedFiles` in `_saasaloy-base.json`. Add `web.css` to the base's owned files. Replace the `## Apps` paragraph with the per-app rule, and add a line to the base `AGENTS.md` that says where each app's `DESIGN.md` lives.
6. Write the existing-project steps into the base `AGENTS.md` and the release notes. If the updater allows a per-file intent line, give `globals.css` one that names the split.

Done when: a fresh playground with admin builds both apps; a screenshot of web `/` and admin `/users` matches the pre-split build in both themes; `pnpm verify:preset` passes and leaves one `@theme inline` and one `@custom-variant dark` across `globals.css` and `web.css`; `pnpm deps:verify` and `pnpm lint` pass; and a `saasaloy update` on a playground made before the split creates `web.css` and lists `globals.css` in the merge plan.

### Phase 2: mockup (#192) (built 2026-10-18)

1. Build a throwaway HTML mockup on the current admin tokens and Inter, with the controls drawn in the coss ui style: the highlight edge, alpha borders, the coss control heights and focus rings. Show each screen in light and dark themes at a mobile and a desktop width.
2. Cover these screens: the shell in two labelled variants, the current rail plus nav panel and an inset sidebar with icon collapse and a sticky top header in the shadcnuikit pattern, each with its content header and account menu; a list view (`/users`), a detail view (the users detail panel), a form (the teams create form), the overview at `/` with health, user count and newest sign-ups, and sign-in.
3. Show the empty, loading and error state of one list and one detail view.
4. Show two labelled placements for the #141 organization picker, and say whether the rail carries a brand mark.
5. Show one strip of the primitive set on its own: buttons in every variant, an input group, a select, a menu, a dialog, a toast, a checkbox, a switch, badges and a skeleton. Show the dark palette twice, once with the measured Intercom ramp in `admin.css` and once with coss-style alpha borders over it.
6. Render it in the T3 thread and do not commit it. Record the owner's pick for each screen under this phase, as text. Edit the #192 issue body to link this section.

Done when: the owner has picked a design for each screen, a shell shape, a palette treatment, a picker placement and a yes or no on the brand mark, and the picks are recorded under this phase.

#### Phase 2 picks (2026-10-18)

The owner reviewed the mockup in the T3 thread on 2026-10-18 and picked:

- **Shell shape:** Shell B. An inset sidebar holds the brand mark and product name, the organization picker, the grouped nav and the user menu at its foot. The sidebar collapses to a 56 px icon strip with a tooltip on each icon, and below `md` it opens as a sheet from a menu button. The content panel has a sticky header with the collapse toggle, the page path and the theme toggle (moved into the account menu on 2026-10-22, see below). The rail and the nav panel go. Phase 4 ports the coss sidebar.
- **Palette treatment:** palette B. Borders and inputs are alpha over the canvas: white at 8 % and 10 % in dark, black at 8 % and 11 % in light. Each surface carries a 1 px highlight edge: an inset top line of white at 6 % in dark and a bottom line of black at 4 % in light. The measured neutral ramp stays for the canvas, the panel and the hover tone.
- **Organization picker:** P1, at the top of the sidebar under the brand row and above the nav groups. Until #141 it renders an empty slot.
- **Brand mark:** yes. A mark at the top of the sidebar, in the collapsed strip, in the mobile header and on the sign-in card.
- **Screens:** the list, the detail panel, the teams create dialog, the overview, sign-in, the empty, loading and error states, and the primitive strip all pass as drawn. Controls are 32 px buttons and 30 px inputs with an 8 px radius and a 2 px focus ring. A detail panel opens as a bottom sheet below `md`. Menus, dialogs and toasts take the raised hover tone.

After PR #204 opened, the owner moved the theme control on 2026-10-22. It is a "Theme" submenu in the account menu, with Light, Dark and System as radio items and a check on the current choice, and the header keeps only the sidebar toggle and the page path. The owner compared seven layouts in an HTML mock and picked the submenu because custom themes will be added later and each one becomes one more item in it. It brings back System as a choice in the admin app; the web app's toggle stays two-state. The owner asked for this change directly, so it took no new mockup round beyond that comparison.

### Phase 3: move the admin components into `@repo/ui` (#192) (built 2026-10-18)

1. Move `DataTable`, `DetailPanel`, `FilterChips`, `AttributeList` and `PageHeader` to `packages/ui/src/blocks/admin/`, `StatusPill` to `packages/ui/src/components/admin/`, and `PageLayout` to `packages/ui/src/containers/admin/`. The admin module's descriptor writes them.
2. Split the shell. The rail, nav panel and shell layout move to `containers/admin/` as router-free components that take nav data, the current path and a link renderer. `apps/admin/src/components/app-shell.tsx` keeps the router and session wiring and passes them in.
3. Add `@tanstack/react-table` to `packages/ui/package.json` through a `package-json-dependency` patch from the admin module, and remove it from the admin app.
4. Update every import in the admin routes and in the module pages that use the moved files.
5. Rewrite `containers/README.md` and the UI layer section of the base `AGENTS.md` for the seven-layer layout, `assets` included.

Done when: `pnpm typecheck` passes in a playground with all five admin-contributing modules, `/users` looks unchanged, `rg "@admin/components/(data-table|detail-panel|page-layout|page-header|status-pill)"` finds nothing, and a `saasaloy update` dry run lists the moved files under the admin record.

As built: the rail and the nav panel moved router-free into `containers/admin/` with structural nav types in `shell-nav.tsx`, and `AppShell` kept the router and the session. Phase 6 then replaced both with the sidebar shell in the same run, so `/users` looked unchanged only between the two phases, checked by diff rather than by eye. The users query moved to `src/lib/users-query.ts` because the overview reads it too.

### Phase 4: the admin primitive set (#192)

1. Bump `@base-ui/react` from 1.8.0 to 1.9.0 in the base `packages/ui/package.json` with `pnpm deps:update`, because the coss sources target 1.9.0. Run `pnpm deps:verify`.
2. Port these coss ui components from `apps/ui/registry/default/ui/` into `packages/ui/src/components/admin/`, one file each, written by the admin module through `@ui/components/admin/<name>.tsx`: alert, alert-dialog, avatar, badge, breadcrumb, button, card (with `CardFrame`), checkbox, collapsible, combobox, dialog, empty, field, fieldset, form, group, input, input-group, kbd, label, menu, meter, popover, radio-group, scroll-area, select, separator, sheet, skeleton, spinner, switch, table, tabs, textarea, toast, toggle-group, tooltip. Add the sidebar port only if Phase 2 picked the sidebar shell. Rewrite each import to `@repo/ui/components/admin/*` and `@repo/ui/lib/utils`, keep coss's names and `data-slot` values, and drop anything Next-specific.
3. Add `packages/ui/src/components/admin/NOTICE.md` with the MIT text and `Copyright (c) 2025 coss.com`, written by the admin module. Add no repo URL, no commit SHA and no origin comment in any ported file.
4. Add the coss tokens the set reads and `admin.css` lacks: `--info`, `--success`, `--warning` and their `-foreground` pairs, `--destructive-foreground`, and the `animate-skeleton` keyframes, each in `:root`, `.dark` and the `@theme inline` mapping. Keep the measured values for the existing tokens until Phase 6.
5. Add `blocks/admin/theme-toggle.tsx` and `blocks/admin/error-state.tsx` on the admin set, reusing `content/errors` and `lib/theme`. Point the admin app's `main.tsx`, `__root.tsx` and the rail at them.
6. Repoint the moved blocks and containers (`DataTable`, `DetailPanel`, `FilterChips`, `AttributeList`, `PageHeader`, `PageLayout`, the rail, the nav panel, the shell) and the admin routes from the base primitives to the admin set. Replace `DropdownMenu*` with `Menu*` and `asChild` with `render` where coss names differ. Mount the toast provider in `__root.tsx`.
7. Replace the `@source "../components/*.tsx"` line in `admin.css` with `@source "../components/admin/**/*.tsx"`.
8. Add the `no-restricted-imports` override to the base template's `oxlint.config.mjs` for `apps/admin/**` and `packages/ui/src/{blocks,containers,components}/admin/**`. It bans `@repo/ui/components/*` and allows `@repo/ui/components/admin/*`. Add a lint fixture that imports the base button from an admin path and expects the rule to fire.
9. Add a render test for the dialog, the select, the menu and the toast that opens each one with the keyboard and checks the focus moves into it and back.

Done when: `pnpm typecheck`, `pnpm lint` and the new render tests pass in a playground with all five admin-contributing modules; `pnpm lint` fails when an admin route imports `@repo/ui/components/button`; `components/admin/` holds the 37 ports, `StatusPill` and `NOTICE.md`, and `rg -i "coss" packages/ui/src/components/admin --glob '!NOTICE.md'` finds nothing; `git diff` on `apps/admin/package.json` and `packages/ui/package.json` adds no dependency beyond the Base UI bump; and a playground without the admin module has no `packages/ui/src/components/admin/` folder.

As built: 39 ports, not 37. `toggle` came in because `toggle-group` imports it, and `sidebar` because Phase 2 picked Shell B. Two coss helpers landed in `lib/admin/`: `segmented-control.ts`, which `tabs` reads, and `use-media-query.ts`, rewritten onto Tailwind's own breakpoints so `max-md` agrees with every `md:` class. The ports were changed where this repo's lint rules or the plan required it: the sidebar no longer writes its open state to a cookie (stored nav state is a non-goal), its skeleton has a fixed width instead of `Math.random`, the table row hover and selected tones use the `accent` token, and a card's action stacks under its title below `sm`. The owner chose on 2026-10-18 to replace the automated keyboard render tests with browser checks and the QA plan, because the repo's `node --test` has no JSX transform and no DOM; #203 tracks a DOM test runner. The import guard also bans the base `error-state` and `theme-toggle` blocks, which have admin twins. `packages/ui/package.json` gained an `./assets/*` export for the brand mark.

### Phase 5: the page frame, the states and the module pages (#192)

1. Add `containers/admin/page-frame.tsx` with the padding, the scroll area and the error boundary. Render it in `__root.tsx` around `<Outlet />`.
2. Add the `EmptyState` block on the admin `empty` primitive and a skeleton block on the admin `skeleton` primitive. Set `defaultPendingComponent` and `defaultErrorComponent` in `apps/admin/src/main.tsx`.
3. Edit the billing, flags, api-keys, roles and teams pages: drop their own `<main>` and `h1`, and render `PageHeader`. Move billing invoices, api-keys keys, teams organizations and rbac roles onto `DataTable`, with `DetailPanel` for a selected record. Keep the permission grid, the create form and the flags toggle list as bespoke editors inside a panel.
4. Build every control on these pages from the admin primitive set: `field`, `input`, `select` and `checkbox` in forms, `switch` in the flags list, `dialog` for a create flow, `alert-dialog` for a destructive confirm such as revoking a key, and a toast for each save result. A module page imports nothing from the base `components/`.
5. Fill each `DataTable`'s `emptyState` with `EmptyState`.
6. Add a test that renders a module page inside the frame.

Done when: each of the five module pages shows the frame and `PageHeader` in the playground; `pnpm lint` passes with the import guard on every module page; a change to the frame's padding in one file changes all seven pages with no module file in the diff; and each list shows its empty state with no rows, the skeleton while its loader runs, and the admin `ErrorState` when the api answers 500.

As built: the frame has no error boundary of its own. TanStack Router wraps each route in a boundary that catches render failures as well as loader throws, and `defaultErrorComponent` (`src/components/route-error.tsx`) renders inside the frame. `PageBody` joined `containers/admin/` as the padded body under a header. Mutation results moved from inline error text to toasts on every module page; field-level errors stayed inline. The teams workspace now opens in the detail panel of the active organization, the rbac page puts roles and members in two tabs, and a flag's on/off became a switch. The api-keys list was broken before this plan: `@better-auth/api-key` 1.7.7 answers `{ apiKeys, total }`, and the page now reads `apiKeys`. The frame render test moved to #203 with the keyboard tests.

### Phase 6: apply the design (#192)

1. Refine the admin tokens in `admin.css` to the Phase 2 picks, in both themes, including the palette treatment (measured ramp or coss-style alpha borders).
2. Build the picked shell. For the rail plus nav panel, restyle the rail, the nav panel, the content header and the account menu. For the sidebar shell, replace the rail and nav panel in `containers/admin/` with the sidebar, the sticky header and the user menu, still router-free and still fed by `NAV_AREAS`. Add the brand mark if Phase 2 picked one, as the first file in `packages/ui/src/assets/` with `assets.d.ts`.
3. Restyle `DataTable`, `FilterChips`, `DetailPanel`, `EmptyState` and the skeleton.
4. Rebuild the overview at `/` with health, the user count and the newest five sign-ups, and rebuild the sign-in screen, to the Phase 2 picks.
5. Add the organization picker slot at the picked place, empty until #141 fills it.

Done when: in the playground, all seven pages and sign-in render in light and dark at 360 px and 1280 px with no horizontal overflow; the overview shows the user count and five sign-ups from a seeded database; and the picker slot renders in the shell.

As built: palette B keeps the measured canvas, panel and hover tones and swaps the hairline and input borders for alpha values; the sidebar takes the canvas tone. The brand mark is `assets/brand-mark.svg`, drawn through a CSS mask by `blocks/admin/brand-mark.tsx` so one file follows both themes. The picker slot is an empty `data-slot="organization-picker"` element at the top of the sidebar. A browser pass on 2026-10-18 found no page-level horizontal overflow on any of the seven pages at 360 px, after the card fix above.

### Phase 7: the design documents, the skills and the QA plan (#192) (built 2026-10-18)

1. Write `apps/admin/DESIGN.md` from the final `admin.css` values, with its fingerprint over `packages/ui/src/styles/admin.css`. The admin module ships it.
2. Lint `apps/web/DESIGN.md` and `apps/admin/DESIGN.md` with the official linter.
3. Update the `saasaloy-design` skill for two documents and two theme files.
4. Update the `saasaloy-admin` skill: the frame, the router defaults, the moved components and their import paths, the admin primitive set and its inventory, the coss naming (`Menu*`, `*Popup`, `render`), the rule that an admin page imports no base primitive, and how a module page uses them. Say that a change or a new component is a hand edit in `components/admin/`, that nothing syncs from coss, and that `NOTICE.md` stays in place. Name the import guard and what it bans.
5. Update the `create-module` skill's admin page guidance, so a new module page uses the frame, `PageHeader` and the admin primitive set.
6. Write the manual QA plan under `docs/qa/` with the next serial. Include a keyboard pass over the dialog, the select, the combobox, the menu and the toast in both themes.
7. File two follow-up issues: module-contributed overview cards, and `verify:a11y` over a seeded admin app after #178.

Done when: both `DESIGN.md` files pass the official linter, a fresh playground's `AGENTS.md` names both design documents and the `@repo/ui` import paths for the admin primitives, the QA plan exists, and the two follow-up issues are filed.

As built: `apps/admin/DESIGN.md` is an admin module scaffold file, not a base seed, so `saasaloy update` lists an edited copy in the merge plan. The follow-ups are #201 (module overview cards), #202 (an automated a11y check over a seeded admin app) and #203 (a DOM test runner for the admin primitives and the frame). The manual QA plan is `docs/qa/0060-qa-admin-shell-polish-2026-10-18.md`.

## Open questions

None. The first grill on 2026-10-18 settled the original questions, and the second grill the same day settled the seven that the primitive set added.

## Non-goals

- The landing page and the web app's blocks. That is #191, apart from the `web.css` split it now builds on.
- The organization picker's behaviour and its api route. #141 builds it. This plan leaves its slot.
- Module-contributed overview cards. A follow-up issue.
- An automated visual or a11y gate for the admin app. A follow-up issue after #178.
- Migration code in `saasaloy update`. Existing projects move through the merge plan and the written steps.
- Search, a command palette, pagination, and stored nav state, as in plan 0047. Plan [0084](0084-plan-command-module-2026-10-24.md) (#264) lifts the command palette non-goal on 2026-10-24.
- A runtime theme switcher between presets, or a theme editor.
- Translations. The `content` layer only keeps copy in one place for later i18n.
- The dev-only UI gallery route. That is #185, which this plan makes easier by putting the admin primitives in `@repo/ui`.
- Porting the base `components/` or the web app to the coss style. The web app keeps shadcn `base-nova`.
- Components that need a widget library: calendar and date pickers, charts, a carousel, a rich-text editor, drag and drop, an OTP field, resizable panels and a command menu. A later plan adds one when a page needs it, and settles its dependency then.
- The shadcnuikit theme customizer, its seven presets and its font switcher.
- Any coss component beyond the 37 in Phase 4, such as autocomplete, number-field, drawer, preview-card, context-menu or toolbar. A later hand edit adds one.
- Any link to the coss repo after the copy: a sync script, a registry entry or a recorded source version.
