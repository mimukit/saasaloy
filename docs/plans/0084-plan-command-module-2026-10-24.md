# Plan: the `command` module, a Cmd/Ctrl+K command palette and one keyboard shortcut registry

Grilled: 2026-10-24

## Context

The two signed-in SPAs, admin (`modules/admin`) and the customer app (`modules/app`, `apps/app`), are mouse-only today. Every screen change is a sidebar click, and the one keyboard shortcut, Cmd/Ctrl+B for the sidebar, is a raw `keydown` listener in `modules/shell/files/ui/components/shell/sidebar.tsx` (lines 30 and 126 to 141) that nothing else knows about. A backoffice user works the same few screens all day, and Linear and Intercom show the shape that fixes this: one command menu on Cmd/Ctrl+K, `G` then a letter to move between screens, single keys that act on the selected record, and `?` for the list of every shortcut.

The goal is that a user can do every task in either app without the mouse, and that every module added later inherits the same keyboard model instead of writing its own listener.

Target: every `NAV_AREAS` row and every action admin and app ship has a command; a test asserts zero conflicts between default bindings; a QA run does each task in both apps with no mouse. This plan lifts the "command palette" non-goal of plans 0047 and 0069.

Research input: `docs/research/0006-research-command-palette-and-shortcuts-2026-10-24.md`.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Module name | `command` (owner, 2026-10-24). The unit the registry holds is a command; the palette, the bindings and the `?` sheet are views of one command list. |
| Palette primitive | The coss `Command` component, ported once from the MIT registry (`apps/ui/registry/default/**`), built on Base UI `Autocomplete` and `Dialog` from `@base-ui/react` 1.9.0 (owner, 2026-10-24). No `cmdk`, no Radix, as plan 0069 requires. |
| Shortcut engine | `@tanstack/react-hotkeys`, exact-pinned (0.16.0 at research time) (owner, 2026-10-24). It is beta, so only one file, `lib/command/engine.ts`, imports it. A swap to `tinykeys` touches that file and nothing else. |
| 0.x bumps (grill Q2) | `semverDelta` in `scripts/update-deps.ts` reports a `0.y → 0.z` change as `major`, repo-wide, so `pnpm deps:update` never pre-checks a 0.x minor bump and `--allow-major` is needed to cross one. A case in `scripts/update-deps.test.ts` covers it. Semver makes no stability promise below 1.0. |
| Apps in scope (grill Q16) | Admin and the customer app. Both are TanStack Router SPAs on the shell, and each wires the same core through its own three files. The core in `@repo/ui` imports no router and no session. The Astro web app is out. This reopened the first answer "Admin only", which rested on the false fact that admin was the only signed-in SPA; `modules/app` landed in PR #262/#263 the same day. |
| Record search | Not in this plan. The palette lists commands only (owner, 2026-10-24). |
| User rebinding | Not in this plan. Bindings are fixed defaults in code (owner, 2026-10-24). The registry keeps every binding in one declared table, so a later rebinding phase adds a store and a settings page without a change to any command. |
| Where the contract lives (grill Q5) | In `shell`: `@ui/lib/shell/commands.ts` holds the `Command` type, a React context and `useCommands(commands, { scope })`. With no provider mounted, `useCommands` does nothing. Any app or module declares commands through it and needs no dependency on `command`. Zero new dependencies in `shell`. It holds state and no IO, so the `@repo/ui` no-IO rule holds. |
| Where the engine lives | In `command`: the provider that collects every `useCommands` call, binds the shortcuts through the engine, and renders the palette and the `?` sheet. It depends on `shell`. |
| Where the primitive lives (grill Q4) | In `shell`, as `@ui/components/shell/command.tsx` next to the other coss ports, covered by the existing `NOTICE.md`. Plan 0069 Q2 ships the full primitive set, and the admin lint guard already allows `@repo/ui/components/shell/*`. |
| Mount seam (grill Q1) | `shell` exports `defineShellExtensions` and the `ShellExtension` type, and `ShellLayout` takes an `extensions` prop. Each app holds its own list: admin ships `src/components/shell-extensions.ts` with `export const shellExtensions = defineShellExtensions({ extensions: [] })`. `command` exports the factory `commandExtension()`, because the `plugin-array` codemod appends a bare `factory()` call (`packages/cli/src/lib/patch/ts-module.ts`). A new SPA copies one file. |
| Extension shape (grill Q10, Q11) | `{ id, Provider, header? }`. `Provider` wraps the layout, and `header` renders in the header's right slot. Array order applies, and the first entry is the outermost. If the Phase 1 mockup moves the trigger into the sidebar, `header` becomes `sidebarFooter`. |
| Who writes the patch | Each app's own descriptor (admin and app) carries the `plugin-array` patch, gated `when: { installed: ["command"] }`. Backfill (ADR 0054) writes it whichever module lands second. `command` stays app-agnostic and names no app. |
| One command, one shape | `{ id, title, group, keywords?, icon?, shortcut?, when?, run(ctx) }`. `id` is `<module>.<verb>`, for example `admin.go-to-users`. A shortcut exists only on a command, so the palette and the `?` sheet can never miss one. |
| Sidebar shortcut | The sidebar declares `shell.toggle-sidebar` (Mod+B) through `useCommands`. It keeps its raw listener only when no command provider is mounted, so Cmd/Ctrl+B works with or without the module and never fires twice. |
| Default key map | Mod+K opens and closes the palette. `?` opens the shortcut sheet. `G` then a letter goes to a nav row, declared as an optional `shortcut` on the `NAV_AREAS` item and never derived from the label. Mod+B toggles the sidebar. Sign out, theme and filter commands are palette-only. Single keys and sequences never fire inside a text field (the engine default). |
| Reserved key table (grill Q3, Q12) | `C` create, `E` edit, `Mod+Backspace` delete (always behind the alert dialog), `/` filter or search on the page, and `G` then a letter for navigation. A module uses a reserved key only for its meaning, or it picks an unreserved key. The table lives in `saasaloy-command` SKILL.md, and `saasaloy-shell` SKILL.md links to it. |
| Logical keys (grill Q7) | Every binding is logical: it follows the typed character, so `?` works on every keyboard layout. |
| Mod+K context (grill Q6) | Mod+K works inside a text field. It does nothing while a dialog or an alert dialog is open: the open dialog takes an exclusive scope. |
| Data-table keys (grill Q9) | `J`/`K` move the row highlight, Enter opens the detail panel, and Esc closes it, all in a `data-table` scope while the table is mounted. No row multi-select. |
| Conflicts (grill Q8) | A conflict is the same chord, or a sequence prefix of another binding, in overlapping scopes. In dev, a conflict throws with both command ids. In production, it warns once and keeps the first binding. The static `node:test` check is the gate. |
| Palette layout | Groups in this order: the current page's commands, Navigation, Actions, Preferences. Each row shows its shortcut with the shell `Kbd`. The footer shows ↑↓, Enter and Esc. Flat list, no nested pages. |
| Tests | Pure registry logic (conflict check, `when` filter, group order, sequence parsing) sits in `.ts` files and runs on `node:test` under `pnpm test:modules`, the runner `modules/admin/files/src/lib/initials.test.ts` uses. Behaviour in the browser is a QA plan under `docs/qa/` made with `qakit`. |
| Keyboard e2e (grill Q15) | A follow-up issue, blocked on #187's seeded admin and customer data. It is not in this plan: #265. |
| Outward actions (grill Q14) | Approved: commit and push this plan to `main`, then file one GitHub issue per phase with `issuekit`, plus the Q15 follow-up issue. |
| UI house rules | Admin follows `modules/admin/files/DESIGN.md`; the customer app has no `DESIGN.md` and takes the web brand tokens (`brand.css`), so the mockup shows the palette in both skins. From the admin file: the dialog takes the `popover` tone and the `2xl` radius; every control shows the 2 px `ring` focus ring; popups fade and scale in; no colour, radius, shadow or type size that `admin.css` does not define; admin code uses shell primitives only (lint-enforced). Both themes and 360 px and 1280 px are first-class. |
| Visual reference (grill Q13) | None yet. Phase 1 makes the mockup in its own attended session after this plan merges. The owner approves it before any build. |

## Approach

The contract goes in `shell` and the engine goes in `command`. This is the same split the backend uses: a vendor-blind contract that callers code against, plus one module that does the work. A route declares "on this page, `Show admins` exists" without knowing whether a palette is installed. The module then gives every declared command a palette row, a binding and a `?` sheet entry.

It reuses:

- the coss port method and `NOTICE.md` from plan 0069;
- the shell `Kbd`, `KbdGroup` and `Dialog`;
- `@base-ui/react` already in `@repo/ui`;
- `NAV_AREAS`, typed against the route tree;
- the `plugin-array` patch kind and `when.installed` gating with backfill (ADR 0054);
- the `node:test` runner.

Rejected, one line each:

- A `command` module with the contract inside it. Then every admin route that declares a command imports a module that may be absent.
- Commands as `const-array` patch data. That kind holds JSON only, so no `run` function can live there.
- Deriving `G` letters from labels. "Users" and "Usage" collide the day a second module lands.
- An admin-only seam (grill Q1b). The next SPA would rewrite it.
- The engine folded into `shell` (grill Q1c). It breaks the locked module and puts TanStack into every shell project.

### Phase 1: mockup (#264)

Attended: the owner approves the mockup screenshots and the round they settle on, in a session after this plan merges.

- Build a throwaway HTML mockup in the T3 thread, never committed, with the admin tokens from `admin.css`. This is the method plans 0068 and 0069 used.
- Show these states: the trigger with its ⌘K/Ctrl K hint, the palette open with all four groups and shortcut keycaps, a filtered list, the empty result, and the `?` sheet with its groups.
- Show both themes at 1280 px and 360 px, in the admin skin and in the customer app's web-brand skin.
- Test the Base UI default filter with 40 sample commands, including "usr" against "Users". If the ranking fails, the picks name `@leeoniya/ufuzzy` 1.0.19.
- Record the picks as text under this phase, including the trigger location (header or sidebar footer).

Done when: this phase carries an "Approved YYYY-MM-DD, round N" line, the list of picks, and the filter verdict.

Approved 2026-10-24, round 1. The owner approved the 43 screenshots of round 1 in the T3 thread for #264.

Picks:

- Trigger location: the header's right slot, so the extension field stays `header`. From 640 px up it is a 240 px field that reads "Search commands…" with the Mod+K keycaps; below 640 px it is a 32 px icon button with no keycaps. The sidebar footer was the rejected option: it already holds the account row, and on a phone the sidebar is a closed sheet.
- Palette: the shell `Dialog` popup at 576 px wide, placed 12 vh from the top (8 px from the top below 640 px, never bottom-stuck), with the 48 px search row, a list capped at `min(480px, 60vh)`, and a 40 px footer that shows ↑ ↓ Move, ↵ Run, Esc Close and ? All shortcuts. Below 640 px the footer drops Esc and ? and the search row drops its Esc keycap.
- Groups in this order: the current page's commands under the page's title (for example "Users"), then Navigation, Actions and Preferences. A page that declares no command shows no page group. Rows are 34 px with a 16 px muted icon; the highlighted row takes the `accent` tone.
- Keycaps inside a popup (the palette and the `?` sheet) take a 1 px inset `input` hairline and a transparent fill. The shell `Kbd` fill is `muted`, and on admin dark `muted` equals `popover`, so a filled keycap vanishes there. No new token.
- Matched characters in a filtered row render semibold and underlined in the `muted-foreground` tone. The active theme row shows "Current" in place of a keycap.
- Empty result: "No commands match “<query>”", then "Try a page name, such as “users”, or press ? for every shortcut."
- The `?` sheet: a dialog titled "Keyboard shortcuts" with General, Navigation and, while a table is mounted, Data table sections. Two columns from 640 px, one below. A sequence reads `G` then `U`, with "then" in the caption size.
- Keycaps follow the platform: ⌘ on macOS, Ctrl elsewhere.

Filter verdict: use `@leeoniya/ufuzzy` 1.0.19, exact-pinned, with `{ intraIns: 1 }`. The Base UI 1.9.0 default is a collator `contains` match that keeps list order. On the 40 sample commands it returned nothing for "usr", "go u", "tog side" and "refnd"; uFuzzy matched all four and returned the same sets for "users", "inv", "dark", "theme", "api" and "subs". Within each group, rows follow uFuzzy's rank; the group order above stays fixed. The `command` descriptor adds the dependency next to `@tanstack/react-hotkeys`.

### Phase 2: the contract and the seam in `shell` (#264)

- Add `modules/shell/files/ui/lib/shell/commands.ts`: the `Command` and `CommandScope` types, `CommandRegistryContext`, `useCommands(commands, { scope })`, and `useCommandProvider()`, which reports whether a provider is mounted. No dependency.
- Add `defineShellExtensions` and the `ShellExtension` type. Give `ShellLayout` an `extensions` prop that wraps the layout in each `Provider` in array order and renders each `header` in the header's right slot.
- Port the coss `Command` primitive into `modules/shell/files/ui/components/shell/command.tsx` and list it in the shell descriptor.
- Change `sidebar.tsx` to declare `shell.toggle-sidebar` through `useCommands`. It keeps its raw listener only when `useCommandProvider()` is false.
- Change the data-table block to declare `J`, `K`, Enter and Esc in a `data-table` scope while it is mounted.
- Update `modules/shell/skills/saasaloy-shell/SKILL.md` to say how a screen declares commands, with a link to the reserved key table.

Done when: `pnpm typecheck`, `pnpm lint` and `pnpm test` pass, and a scaffolded admin app in `.dev` with no `command` module behaves exactly as before. Cmd/Ctrl+B still toggles the sidebar.

### Phase 3: admin and app declare their commands and their seams (#264)

Each step below applies to `modules/admin/files/src/` and to `modules/app/files/src/`, unless it names one app.

- Add an optional `shortcut` to `NAV_AREAS` items in each `components/nav.ts`: in admin, `G O` for Overview and `G U` for Users; in app, `G H` for Home.
- Add `components/shell-extensions.ts` with `export const shellExtensions = defineShellExtensions({ extensions: [] })`. `app-shell.tsx` passes it to `ShellLayout`. With the list empty, the output does not change.
- Add `commands.ts`. It turns every `NAV_AREAS` row into a "Go to …" command and adds sign out and the three theme choices. `app-shell.tsx` declares them through `useCommands`.
- Admin only: `routes/users.tsx` declares its filter commands ("Show admins", "Show all users") in the route scope.
- Add a `node:test` file in each app that walks its `NAV_AREAS` and asserts that every row has a command and that no two shortcuts are equal.

Done when: both new tests pass under `pnpm test:modules`, and admin and app without `command` installed still render and behave as before.

### Phase 4: the `command` module (#264)

- In `scripts/update-deps.ts`, make `semverDelta` report a `0.y → 0.z` change as `major`, with a case in `scripts/update-deps.test.ts`. Ship it as its own commit.
- Scaffold `modules/command/` with the `create-module` skill. Set `dependsOn: ["shell"]` and a `package-json-dependency` patch for `@tanstack/react-hotkeys` into `packages/ui/package.json`.
- `@ui/lib/command/registry.ts`, pure: merge the declared commands, filter by `when` and active scope, order the groups, and detect conflicts as the conflict row defines them.
- `@ui/lib/command/engine.ts`: the only file that imports `@tanstack/react-hotkeys`. It binds the registry's shortcuts as logical keys, maps `Mod`, takes the exclusive scope while a dialog is open, and formats keycaps per platform.
- `@ui/blocks/command/command-palette.tsx` and `@ui/blocks/command/shortcut-help.tsx`, built on the shell `Command`, `Dialog` and `Kbd`, to the Phase 1 mockup.
- `@ui/containers/command/command-root.tsx`: the provider for `CommandRegistryContext`. It binds Mod+K and `?` and renders the two blocks. `commandExtension()` returns `{ id: "command", Provider, header }`.
- In the admin and app descriptors, add the `plugin-array` patch, gated `when: { installed: ["command"] }`, that appends `commandExtension()` to `shellExtensions`.
- Write `modules/command/skills/saasaloy-command/SKILL.md`: how to add a command, the id rule, the scopes, the default key map, and the reserved key table.
- Add `node:test` tests beside `registry.ts` for conflicts, sequence prefixes, `when`, scope and group order.

Done when: in `.dev`, `saasaloy add command` into a project with admin and app writes both patches and the dependency. In admin, Mod+K opens the palette, `G U` opens Users, and `?` lists every binding. In app, Mod+K opens the palette and `G H` opens Home. The registry tests and the new `update-deps` case pass, and `pnpm deps:check` is clean.

### Phase 5: proof and records (#264)

- Run `qakit` for a QA plan under `docs/qa/` that does every task in admin and app with no mouse, in both themes, at 360 px and 1280 px.
- Add the terms command, shortcut, scope and shell extension to `CONTEXT.md`.
- Write an ADR for "UI contract and seam in `shell`, engine in `command`".
- Note the lifted non-goal in plans 0047 and 0069.

Done when: the QA plan's agent-run checks all pass with no mouse step, the conflict test reports zero conflicts, and every `NAV_AREAS` row and every action in both apps appears in the `?` sheet. That is the Context target.

## Open questions

None. The grill on 2026-10-24 settled every decision. The filter verdict and the trigger location are Phase 1 outputs, not open decisions.

## Non-goals

- Record search in the palette (users, payments, any API-backed result).
- User rebinding, a shortcut settings page, and any stored override, local or server-side.
- A palette in the Astro web app.
- Nested palette pages ("Theme…" opening a sub-list) and recent commands.
- A keyboard e2e test. It is the follow-up issue #265, blocked on #187.
- Any change to `admin.css` tokens or to `DESIGN.md` beyond what the approved mockup requires.
