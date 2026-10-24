# Research: a Cmd/Ctrl+K command palette and a central keyboard shortcut manager

The question: which libraries and which shape should a Saasaloy `command` module use for a Linear-style command bar (Cmd/Ctrl+K, search, run an action) and for one shortcut registry that binds, displays and lets a user rebind every shortcut across the signed-in apps.

## Decision (locked by the owner, 2026-10-24)

- Palette: the coss `Command` port on Base UI `Autocomplete`.
- Shortcut engine: `@tanstack/react-hotkeys`.

## Recommendation

**Palette:** port the coss ui `Command` component into the shell set. It is built on Base UI `Autocomplete` plus `Dialog`, which `@repo/ui` already ships at 1.9.0, so the palette adds no runtime dependency. Choose `cmdk` only if the project drops the plan 0069 rule that keeps `cmdk` and Radix packages out of every `package.json`.

**Shortcut engine:** use `@tanstack/react-hotkeys`, exact-pinned, behind a Saasaloy-owned command registry. It is the only candidate that ships every part of a "manager and assigner": sequences (`G` then `U`), scopes, conflict detection, shortcuts declared up front for a cheat sheet and a settings screen, a recorder for user rebinding, and per-platform display (⌘ vs Ctrl). Choose `tinykeys` 4.0.1 instead if the owner will not take a beta dependency. It covers sequences, `$mod` and input filtering in about 1 KB, and the registry then writes scopes, conflicts, rebinding and formatting itself (an estimated 300 to 500 lines plus tests).

**Shape:** one registry is the source of truth. A command is `{ id, title, group, keywords, icon, shortcut?, when?, run(ctx) }`. The palette lists commands, the shortcut engine binds the same commands, the `?` help sheet lists them, and the settings page rebinds them. Nothing registers a shortcut that is not a command. This is the Linear model, where every action reachable by a key is also in the command menu.

## Options compared

### Palette

| Option | Version (npm, 2026-10-24) | Runtime deps | Fits the Base UI shell | Fit |
|--------|---------------------------|--------------|------------------------|-----|
| coss `Command` (port) | registry copy, MIT | none new: `@base-ui/react` 1.9.0 already in `@repo/ui` | yes, same source as the other shell primitives | **pick** |
| Base UI `Autocomplete` by hand | 1.9.0 | none new | yes | the same thing as the coss port, with more work |
| `cmdk` | 1.1.1, last publish 2025-08-27 | `@radix-ui/react-dialog`, `-primitive`, `-id`, `-compose-refs` | no, it brings Radix and its own dialog | rejected by plan 0069 |
| `kbar` | 1.0.0, 2026-08-10 | `@radix-ui/react-portal`, `fuse.js`, `@tanstack/react-virtual` | no, Radix portal, own styling | rejected; it also carries its own shortcut engine, which would duplicate the registry |

### Shortcut engine

| Option | Version (npm, 2026-10-24) | Sequences | Scopes | Conflicts | Rebind / recorder | Platform display | Stability | Fit |
|--------|---------------------------|-----------|--------|-----------|-------------------|------------------|-----------|-----|
| `@tanstack/react-hotkeys` | 0.16.0 (core `@tanstack/hotkeys` 0.17.0) | yes | yes, nested and exclusive | yes | yes, `HotkeyRecorder`, `defineAppHotkeys` | yes | beta, 40 releases since 2026-02-10 | **pick** |
| `tinykeys` | 4.0.1, 2026-09 | yes (`g i`, 1000 ms) | no | no | no | parse only | stable, zero deps | fallback |
| `react-hotkeys-hook` | 5.3.3, 2026-06 | yes (`sequenceTimeoutMs`) | yes (`HotkeysProvider`) | unverified | `useRecordHotkeys` (unverified) | unverified | stable, 3.5k stars | runner-up |
| `hotkeys-js` | 4.0.8 | unverified | yes (own scope API) | no | no | no | stable | not React-shaped |
| `@github/hotkey` | 3.1.4 | yes | no | no | no | no | stable | binds via `data-hotkey` attributes, not a registry |
| `mousetrap` | 1.6.5 | yes | no | no | no | no | no release since 2020 | stale |
| hand-rolled (`sidebar.tsx` style) | n/a | write it | write it | write it | write it | write it | n/a | the whole job, no help |

## Evidence (primary sources)

- Plan 0069 bans `cmdk` and every Radix or UI kit package from any `package.json`, and keeps Base UI → `docs/plans/0069-plan-admin-shell-polish-2026-10-18.md` line 56 (2026-10-18).
- Plans 0047 and 0069 list the command palette as a non-goal → `docs/plans/0047-plan-admin-intercom-shell-2026-09-07.md` line 81, `docs/plans/0069-...` lines 36 and 186. The new plan must state that it lifts this non-goal.
- The shell already ships `combobox.tsx`, `dialog.tsx`, `kbd.tsx` and a hand-written Cmd/Ctrl+B listener in `sidebar.tsx` → `modules/shell/registry-item.json`, `modules/shell/files/ui/components/shell/sidebar.tsx` lines 30 and 126 to 141.
- coss `Command` is "an alias for `Autocomplete.Root`", built with Dialog and Autocomplete, with `CommandDialog`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandShortcut`, `CommandFooter` and a Cmd+K example → https://coss.com/ui/docs/components/command (fetched 2026-10-24).
- Base UI `Autocomplete` supports `inline` with `open`, `autoHighlight: 'always'` for "the list ... rendered inline within a dialog", groups, a custom `filter` or `useFilter()`, a fuzzy example, and external virtualization with `@tanstack/react-virtual` → https://base-ui.com/react/components/autocomplete (fetched 2026-10-24, `@base-ui/react` 1.9.0).
- `cmdk` 1.1.1 depends on four `@radix-ui/*` packages; `kbar` 1.0.0 depends on `@radix-ui/react-portal` and `fuse.js` → `npm view` (2026-10-24).
- TanStack Hotkeys features: sequences with timeout, `Mod` mapping, scopes (nested take precedence, exclusive suspend others), `HotkeyManager` conflict detection, `defineAppHotkeys` "for cheat sheets and settings, even on routes that haven't loaded", user rebind and unbind with app-chosen storage, `HotkeyRecorder` with conflict checks, display formatting, devtools, inputs ignored for single-key shortcuts by default, "currently in beta", "API is still subject to change" → https://tanstack.com/hotkeys/latest/docs/overview (fetched 2026-10-24).
- `@tanstack/react-hotkeys`: 40 versions from 0.0.1 (2026-02-10) to 0.16.0 (2026-10-19); deps `@tanstack/hotkeys` and `@tanstack/react-store`; MIT → `npm view` (2026-10-24). Repo 749 stars, 2 open issues → https://github.com/TanStack/hotkeys (2026-10-24).
- `tinykeys`: sequences (`g i`, 1000 ms default), `$mod`, default ignore of `input`, `textarea`, `select`, `contenteditable`, `parseKeybinding`, no React hook, no scopes, about 1 KB, 4.1k stars → https://github.com/jamiebuilds/tinykeys (2026-10-24), version 4.0.1 from npm.
- `react-hotkeys-hook`: `useHotkeys`, scopes through `HotkeysProvider` and `useHotkeysContext`, `enableOnFormTags`, `sequenceTimeoutMs`, `description`, 3.5k stars, 22 open issues → https://github.com/JohannesKlauss/react-hotkeys-hook (2026-10-24), version 5.3.3 from npm.
- Linear's model: `G` then `I` (Inbox), `G` then `M` (My Issues), `G` then `A`, `B`, `X` for team views, `J`/`K` through lists, and actions that "show up in the command menu" → https://linear.app/docs/inbox, https://linear.app/docs/my-issues, https://linear.app/docs/default-views (2026-10-24).

## Provisional comparison (from recall, not verified)

- Chrome and Firefox on Windows and Linux use Ctrl+K to focus the browser search bar; a page listener with `preventDefault` takes it back while the page has focus (as of June 2026).
- Intercom's inbox uses the same pattern as Linear: Cmd+K opens the command bar, single keys act on the open conversation, `?` opens the shortcut list (as of June 2026).

## Proposed module shape (input for the plan)

- **Module `command`**, `dependsOn: ["shell"]`. It wraps no external service, so it takes neither providers nor drivers, like `config`.
- **Files under `@ui`:** `components/shell/command.tsx` (the coss port, with its `NOTICE.md` entry), `lib/command/registry.ts` (`defineCommands`, types, conflict check), `blocks/command/command-palette.tsx`, `blocks/command/shortcut-help.tsx` (the `?` sheet), `blocks/command/shortcut-settings.tsx` (rebind table with the recorder), `containers/command/command-provider.tsx` (mounts the engine and the palette once in the shell layout).
- **Static commands** come from each module through a `plugin-array` patch into `defineCommands({ commands: [] })` in the app's `src/commands.ts`, the same way config sections register. `saasaloy add` refuses two modules with one command id.
- **Navigation commands** derive from `NAV_AREAS`, so each nav row gets "Go to Users" and an optional `G` then `U` with no extra entry. `to` stays typed against the route tree.
- **Contextual commands** (act on the selected row or the open record, such as "Ban user" on `/users`) register from the route with a `useCommands([...], { scope })` hook. They show in the palette and bind only while that route or panel is mounted.
- **The sidebar's Cmd/Ctrl+B** moves into the registry as the command `shell.toggle-sidebar`, so the `?` sheet lists it and a user can rebind it.
- **User overrides** are user data, not `config` and not `env`. Phase one stores them in `localStorage`. A server-side store waits for a user preferences table.
- **Default key set**, Linear-style: Cmd/Ctrl+K palette, `?` help sheet, `G` then a letter for each nav area, `J`/`K` and Enter in data tables, `C` for "create" on a page that has one, Esc closes. Single-letter keys never fire inside a text field.

## Open questions

- **Beta churn.** TanStack Hotkeys published 40 versions in 8 months. The registry must import it in one file only, so a swap to `tinykeys` touches that file and nothing else. The plan states this boundary.
- **Dependency rule.** Plan 0069 names widget libraries; a key engine is not a widget, but it is a new runtime dependency in `@repo/ui`. The owner confirms that `@tanstack/react-hotkeys` is allowed, or picks `tinykeys`.
- **Fuzzy search quality.** Base UI's default filter may rank "usr" badly against "Users". The fuzzy example in the Base UI docs may be enough. If not, `@leeoniya/ufuzzy` 1.0.19 (MIT, zero deps) is the candidate. Settle it in the mockup phase with 40 sample commands.
- **Async results.** Linear's palette also searches records (issues, users). Phase one lists commands only. Record search needs an api endpoint per module and a debounce; the plan decides whether it is in scope.
- **Server-side overrides.** A per-user store needs a table (plural snake_case, for example `user_preferences`) owned by `auth` or by `command`. Out of phase one.
- **Mockup first.** This is UI, so phase one of the plan is a mockup of the palette, the `?` sheet and the settings table, approved before any build.
