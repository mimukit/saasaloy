# Plan: polish the admin shell, and give each app its own theme in `@repo/ui`

Grilled: 2026-10-18

Tracked: Phase 1 in [#193](https://github.com/mimukit/saasaloy/issues/193), Phases 2 to 6 in [#192](https://github.com/mimukit/saasaloy/issues/192), a sub-issue of [#183](https://github.com/mimukit/saasaloy/issues/183)

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

**Success:** a module page renders inside a shared page frame and looks like the core screens, and a later change to that frame or to a shared primitive needs no edit to any module file. Each app has its own theme file and its own `DESIGN.md`. `@repo/ui` holds the components for both apps under the owner's layer layout. The panel looks finished in light and dark themes, at mobile and desktop widths, with empty, loading and error states on every list and detail view, and with a place for the #141 organization picker.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Relation to plan 0047 | This plan refines 0047. The rail, nav panel, content panel and route-owned detail panel stay. `NAV_AREAS` typed against the route tree stays. Dark by default stays. 0047's non-goals (search, command palette, pagination, stored nav state) stay non-goals. |
| `@repo/ui` layer layout | Seven top-level folders, no `admin/` or `web/` at the root of `src/`: `assets` (images, SVGs, icons), `blocks` (compound components built from primitives), `components` (shadcn primitives, official and custom), `containers` (shells and layouts that hold blocks and components), `content` (copy, in one place for later i18n), `lib` (utilities), `styles` (CSS files with the token variables). A folder may hold `admin/`, `web/` or `shared/` children where a split helps. The existing names `content` and `lib` stay. |
| Meaning of `containers` | Changes from "binds a store and wires it into blocks" to "a shell or a layout that holds blocks and components on a page". `containers/README.md` and the base `AGENTS.md` say so. The no-IO rule for all of `@repo/ui` stays. |
| The `assets` layer (grilled Q12) | The docs list it now. The first real asset creates the folder and `assets.d.ts`. If the Phase 2 mockup puts a brand mark in the rail, that SVG is the first asset. No empty folder ships. |
| Order against #191 (grilled Q1) | The CSS split is Phase 1 here and lands as its own PR before #191 Phase 3. Plan 0068 Phase 3 writes its rhythm and type tokens into `web.css` and `apps/web/DESIGN.md`. That retarget was settled in this grill, so 0068 keeps its stamp. |
| Shared CSS layer (grilled Q2, Q10) | `globals.css` keeps its name, so `@repo/ui/globals.css` imports keep resolving. It holds only the Tailwind imports, `tw-animate-css`, `shadcn/tailwind.css`, the `dark` custom variant, the base layer and the `@source` lines. Its header comment names `web.css` and `admin.css` as the token files. |
| Theme files (grilled Q10) | `packages/ui/src/styles/web.css` and `packages/ui/src/styles/admin.css` each import `globals.css` and hold their own `:root`, `.dark`, `@theme inline` colour mapping and radius scale. The mapping repeats in both files on purpose. A prototype with shadcn 4.21.0 showed that a preset merges in place only when the target file holds the `@theme inline` block. With the mapping in `globals.css`, shadcn writes a second `@theme inline`, a second `@custom-variant dark` and a different radius formula into the target. With the target left at `globals.css`, the build passes and the old theme wins. |
| Preset target and fingerprint (grilled Q10) | `components.json`'s `tailwind.css` points at `src/styles/web.css`. `verify:preset` and the `saasaloy-design` fingerprint move to `web.css`. Each `DESIGN.md` fingerprints its own theme file. |
| A `DESIGN.md` per app (grilled Q3) | `apps/web/DESIGN.md` for the web theme and `apps/admin/DESIGN.md` for the admin theme, which the admin module ships. The root has no design document. The base `AGENTS.md` says where each app's `DESIGN.md` lives, and the admin module's skill adds its line. |
| Existing projects (grilled Q11) | The normal update path, with no migration code. `web.css` arrives as a `create`. `globals.css` and `Layout.astro` are base-owned, so they go to the merge plan. The root `DESIGN.md` is a seed, so `update` leaves it in place. The base `AGENTS.md` and the release notes give the steps: move the `:root` and `.dark` blocks and the mapping into `web.css`, point the web import at `web.css`, then move `DESIGN.md` to `apps/web/`. The admin module drops `apps/admin/src/styles/admin.css` (a `delete`, or a `delete-drift` with a warning when edited) and creates `packages/ui/src/styles/admin.css`. |
| Admin primitives move to `@repo/ui` | In this plan. The admin module writes them, so a project without admin carries none of them. Files the admin module writes into `packages/ui/src/**` sit under the admin module's manifest record. The base's `ownedFiles` globs apply only to base entries, so a base update never claims them. |
| Primitive folders (grilled Q6) | `blocks/admin/` for `DataTable`, `DetailPanel`, `FilterChips`, `AttributeList`, `PageHeader` and the new `EmptyState`. `components/admin/` for `StatusPill`, because it reads `--status-open`, which only `admin.css` defines. `containers/admin/` for `PageLayout`, the page frame, the rail, the nav panel and the shell layout. `StatusPill` moves to `components/shared/` the day the web app needs a pill. |
| Router-bound code stays in the app | `@repo/ui` imports no router and no session. `nav.ts` (typed against the route tree), the route guard and the session stay in `apps/admin`. A shell container in `@repo/ui` takes the nav data, the current path and a link renderer as props, and `apps/admin` passes them in. |
| Page frame (grilled Q4) | `containers/admin/page-frame.tsx`, rendered by `__root.tsx` around `<Outlet />`. It owns the padding, the scroll area and the error boundary. A route renders `PageLayout` inside it, so the `/users` detail panel stays beside its list, as it does today. |
| Title row (grilled Q5) | The route renders the shared `PageHeader` inside the frame. A static title on the route cannot carry billing's live Refresh state or a live count. A change to `PageHeader` still reaches every page with no module edit, because the file lives in `@repo/ui`. |
| Loading, error and empty states (grilled Q13) | Router defaults in `apps/admin/src/main.tsx`: `defaultPendingComponent` renders a skeleton block in the frame, and `defaultErrorComponent` renders `ErrorState` in the frame. An empty list is `DataTable`'s `emptyState` slot, filled with the shared `EmptyState` block. A route overrides only when it needs to. `/users` keeps `UsersError` as the worked example of an override. |
| Module page scope (grilled Q14) | Each module page drops its own `<main>` and `h1` and renders `PageHeader`. Lists of records move to `DataTable`, and a selected record opens in `DetailPanel`: billing invoices, api-keys keys, teams organizations, rbac roles. Editors stay bespoke inside a panel: the rbac permission grid, the teams create form, the flags toggle list. |
| Overview (grilled Q8) | `/` shows the api health, the user count and the newest five sign-ups, all from `GET /health` and `GET /admin/users`. No new api route. Module-contributed overview cards are a follow-up issue. |
| Mockup record (grilled Q7) | A throwaway HTML mockup rendered in the T3 thread, never committed. The picks are recorded as text under Phase 2. The #192 issue body links that plan section in place of a mockup link. This is the method plan 0068 used for #191. |
| Visual check (grilled Q9) | A manual QA plan under `docs/qa/` covers the seven admin pages and sign-in at 360 px and 1280 px in both themes. An automated `verify:a11y` run over a seeded admin app is a follow-up issue for after #178's seed data lands. |

## Approach

Restructure first with no visual change, then apply the design on the new structure. The restructure moves files and splits CSS, and its acceptance is "nothing looks different". The design pass then edits each file only once, in its final home.

**Reuses:** the shell, the page primitives and the `/users` worked example from 0047; `NAV_AREAS`, `navCount` and `areaFor` in `nav.ts`; the `nav-entry` patch kind (`packages/cli/src/lib/patch/nav-entry.ts`) that the five modules already use; the `package-json-dependency` patch kind for `@tanstack/react-table`; the `ErrorState` block and `errors` content for error states; `@repo/ui/lib/theme` for the theme toggle; the `@source` line pattern in `admin.css`; `scripts/verify-preset.ts` and the `saasaloy-design` fingerprint flow; the update actions in `packages/cli/src/lib/updater.ts` (`create`, merge plan for owned files, `delete`/`delete-drift`) and the base ownership split in `_saasaloy-base.json` (ADR 0032); the throwaway HTML mockup method from plan 0068.

**Rejected:** a separate `packages/admin-ui` workspace (the owner wants one UI package for both apps); `admin/` and `web/` folders at the root of `packages/ui/src` (the owner wants the seven layers at the root); migrating each module page onto `PageLayout` by hand with no shared frame (the next layout change would need five module edits again); the colour mapping kept in `globals.css` (a preset then duplicates blocks or silently keeps the old theme); migration code in `saasaloy update` for one release.

### Phase 1: split the styles and the design documents (#193) (built 2026-10-18)

1. Reduce `packages/ui/src/styles/globals.css` to the shared layer: the Tailwind imports, `tw-animate-css`, `shadcn/tailwind.css`, the `dark` custom variant, the base layer and the `@source` lines. Add a header comment that names `web.css` and `admin.css`. As built, the `dark` custom variant sits in each theme file instead of `globals.css`: shadcn 4.21.0 does not read through `@import`, so `pnpm verify:preset` found a second `@custom-variant dark` appended to `web.css` with the variant in `globals.css`.
2. Move the web `:root`, `.dark`, `@theme inline` mapping and radius scale into `packages/ui/src/styles/web.css`, which imports `globals.css`. Add a `./styles/*` export to `packages/ui/package.json`. Point `apps/web` at `web.css`.
3. Point `components.json`'s `tailwind.css` at `src/styles/web.css`. Move the fingerprint in `verify-preset.ts` and in the `saasaloy-design` skill to `web.css`. Check `MUST_SURVIVE` against `globals.css` and the token blocks against `web.css`.
4. Move the admin module's `apps/admin/src/styles/admin.css` to `packages/ui/src/styles/admin.css`. Give it its own `@theme inline` mapping, fix its `@source` paths, and point `apps/admin/src/main.tsx` at it.
5. Move the root `DESIGN.md` to `apps/web/DESIGN.md`, and update `seedFiles` in `_saasaloy-base.json`. Add `web.css` to the base's owned files. Replace the `## Apps` paragraph with the per-app rule, and add a line to the base `AGENTS.md` that says where each app's `DESIGN.md` lives.
6. Write the existing-project steps into the base `AGENTS.md` and the release notes. If the updater allows a per-file intent line, give `globals.css` one that names the split.

Done when: a fresh playground with admin builds both apps; a screenshot of web `/` and admin `/users` matches the pre-split build in both themes; `pnpm verify:preset` passes and leaves one `@theme inline` and one `@custom-variant dark` across `globals.css` and `web.css`; `pnpm deps:verify` and `pnpm lint` pass; and a `saasaloy update` on a playground made before the split creates `web.css` and lists `globals.css` in the merge plan.

### Phase 2: mockup (#192)

1. Build a throwaway HTML mockup on the current admin tokens and Inter. Show each screen in light and dark themes at a mobile and a desktop width.
2. Cover these screens: the shell (rail, nav panel, content header, account menu), a list view (`/users`), a detail view (the users detail panel), a form (the teams create form), the overview at `/` with health, user count and newest sign-ups, and sign-in.
3. Show the empty, loading and error state of one list and one detail view.
4. Show two labelled placements for the #141 organization picker, and say whether the rail carries a brand mark.
5. Render it in the T3 thread and do not commit it. Record the owner's pick for each screen under this phase, as text. Edit the #192 issue body to link this section.

Done when: the owner has picked a design for each screen, a picker placement and a yes or no on the brand mark, and the picks are recorded under this phase.

### Phase 3: move the admin primitives into `@repo/ui` (#192)

1. Move `DataTable`, `DetailPanel`, `FilterChips`, `AttributeList` and `PageHeader` to `packages/ui/src/blocks/admin/`, `StatusPill` to `packages/ui/src/components/admin/`, and `PageLayout` to `packages/ui/src/containers/admin/`. The admin module's descriptor writes them.
2. Split the shell. The rail, nav panel and shell layout move to `containers/admin/` as router-free components that take nav data, the current path and a link renderer. `apps/admin/src/components/app-shell.tsx` keeps the router and session wiring and passes them in.
3. Add `@tanstack/react-table` to `packages/ui/package.json` through a `package-json-dependency` patch from the admin module, and remove it from the admin app.
4. Update every import in the admin routes and in the module pages that use the moved files.
5. Rewrite `containers/README.md` and the UI layer section of the base `AGENTS.md` for the seven-layer layout, `assets` included.

Done when: `pnpm typecheck` passes in a playground with all five admin-contributing modules, `/users` looks unchanged, `rg "@admin/components/(data-table|detail-panel|page-layout|page-header|status-pill)"` finds nothing, and a `saasaloy update` dry run lists the moved files under the admin record.

### Phase 4: the page frame, the states and the module pages (#192)

1. Add `containers/admin/page-frame.tsx` with the padding, the scroll area and the error boundary. Render it in `__root.tsx` around `<Outlet />`.
2. Add the `EmptyState` block and a skeleton block. Set `defaultPendingComponent` and `defaultErrorComponent` in `apps/admin/src/main.tsx`.
3. Edit the billing, flags, api-keys, roles and teams pages: drop their own `<main>` and `h1`, and render `PageHeader`. Move billing invoices, api-keys keys, teams organizations and rbac roles onto `DataTable`, with `DetailPanel` for a selected record. Keep the permission grid, the create form and the flags toggle list as bespoke editors inside a panel.
4. Fill each `DataTable`'s `emptyState` with `EmptyState`.
5. Add a test that renders a module page inside the frame.

Done when: each of the five module pages shows the frame and `PageHeader` in the playground; a change to the frame's padding in one file changes all seven pages with no module file in the diff; and each list shows its empty state with no rows, the skeleton while its loader runs, and `ErrorState` when the api answers 500.

### Phase 5: apply the design (#192)

1. Refine the admin tokens in `admin.css` to the Phase 2 picks, in both themes.
2. Restyle the rail, the nav panel, the content header and the account menu. Add the brand mark if Phase 2 picked one, as the first file in `packages/ui/src/assets/` with `assets.d.ts`.
3. Restyle `DataTable`, `FilterChips`, `DetailPanel`, `EmptyState` and the skeleton.
4. Rebuild the overview at `/` with health, the user count and the newest five sign-ups, and rebuild the sign-in screen, to the Phase 2 picks.
5. Add the organization picker slot at the picked place, empty until #141 fills it.

Done when: in the playground, all seven pages and sign-in render in light and dark at 360 px and 1280 px with no horizontal overflow; the overview shows the user count and five sign-ups from a seeded database; and the picker slot renders in the shell.

### Phase 6: the design documents, the skills and the QA plan (#192)

1. Write `apps/admin/DESIGN.md` from the final `admin.css` values, with its fingerprint over `packages/ui/src/styles/admin.css`. The admin module ships it.
2. Lint `apps/web/DESIGN.md` and `apps/admin/DESIGN.md` with the official linter.
3. Update the `saasaloy-design` skill for two documents and two theme files.
4. Update the `saasaloy-admin` skill: the frame, the router defaults, the moved primitives and their import paths, and how a module page uses them.
5. Update the `create-module` skill's admin page guidance, so a new module page uses the frame, `PageHeader` and the shared primitives.
6. Write the manual QA plan under `docs/qa/` with the next serial.
7. File two follow-up issues: module-contributed overview cards, and `verify:a11y` over a seeded admin app after #178.

Done when: both `DESIGN.md` files pass the official linter, a fresh playground's `AGENTS.md` names both design documents and the `@repo/ui` import paths for the admin primitives, the QA plan exists, and the two follow-up issues are filed.

## Open questions

None. The grill on 2026-10-18 settled every open question.

## Non-goals

- The landing page and the web app's blocks. That is #191, apart from the `web.css` split it now builds on.
- The organization picker's behaviour and its api route. #141 builds it. This plan leaves its slot.
- Module-contributed overview cards. A follow-up issue.
- An automated visual or a11y gate for the admin app. A follow-up issue after #178.
- Migration code in `saasaloy update`. Existing projects move through the merge plan and the written steps.
- Search, a command palette, pagination, and stored nav state, as in plan 0047.
- A runtime theme switcher between presets, or a theme editor.
- Translations. The `content` layer only keeps copy in one place for later i18n.
- The dev-only UI gallery route. That is #185, which this plan makes easier by putting the admin primitives in `@repo/ui`.
