# 0056: The UI contract and seam live in `shell`, the engine in `command`

Admin and the customer app were mouse-only. The one keyboard shortcut, Cmd/Ctrl+B for the sidebar, was a raw `keydown` listener in `sidebar.tsx` that nothing else knew about. Plan `docs/plans/0084-plan-command-module-2026-10-24.md` adds a Cmd/Ctrl+K palette, `G` then a letter for navigation, and a `?` sheet, all fed by one command list. Every admin route, every app screen and every later module has to declare what it can do, and the palette is an optional module. The question this record settles is where the contract a screen codes against lives, where the code that binds keys and draws the palette lives, and how that code gets into an app without the app or the shell naming it. Settled on 2026-10-24 in the grill of plan 0084 (questions 1, 5, 10 and 11) and built in issue [#264](https://github.com/mimukit/saasaloy/issues/264).

## Status

accepted

## The decision

- **The contract lives in `shell`.** `@repo/ui/lib/shell/commands.ts` holds the `Command`, `CommandGroup` and `CommandScope` types, `CommandRegistryContext`, `useCommands(commands, { scope, label? })` and `useCommandProvider()`. It imports nothing beyond React and holds state and no IO, so the `@repo/ui` no-IO rule holds. This is the backend split applied to UI: a vendor-blind contract that callers code against, plus one module that does the work.
- **The seam lives in `shell`.** `@repo/ui/lib/shell/extensions.ts` exports `defineShellExtensions` and the `ShellExtension` type `{ id, Provider, header? }`. `ShellLayout` takes an `extensions` prop, wraps the layout in each `Provider` in array order (the first is the outermost), and renders each `header` in the header's right slot. Each app keeps its own list in `src/components/shell-extensions.ts`, which ships with `extensions: []`.
- **The engine lives in `command`.** `modules/command` depends on `shell`. Its `command-root.tsx` provides `CommandRegistryContext`, collects every registration, binds the shortcuts, and renders the palette, the `?` sheet and the header trigger. `registry.ts` is pure (merge, `when` and scope filter, group order, conflict check) and runs under `node:test`. `engine.ts` is the only file that imports `@tanstack/react-hotkeys`.
- **The module enters through a factory.** `command` exports `commandExtension()`, because the `plugin-array` codemod in `packages/cli/src/lib/patch/ts-module.ts` appends a bare `factory()` call. The admin and app descriptors each carry the `plugin-array` patch that appends it to `shellExtensions`, gated `when: { installed: ["command"] }`, so the backfill of [ADR 0054](0054-adr-when-gates-optional-entries-and-feature-modules-own-their-journeys-2026-10-23.md) writes it whichever of the two modules lands second. `command` names no app.

## Considered Options

- The contract inside the `command` module. Rejected: every admin route that declares a command would import a module that may be absent.
- Commands as `const-array` patch data. Rejected: that patch kind holds JSON only, so no `run` function can live there.
- An admin-only seam (grill Q1b). Rejected: the next SPA would rewrite it, and `modules/app` landed the same day.
- The engine folded into `shell` (grill Q1c). Rejected: it breaks the locked `shell` module and puts the TanStack binding library into every shell project, palette or not.
- `G` letters derived from nav labels. Rejected: "Users" and "Usage" collide the day a second module lands, so the letter is declared on the `NAV_AREAS` item.

## Consequences

- `shell` gains no package dependency. Its descriptor adds files (`commands.ts`, `extensions.ts`, the coss `command.tsx` port) and no `package-json-dependency` patch. `@tanstack/react-hotkeys` 0.16.0 and `@leeoniya/ufuzzy` 1.0.19 arrive only with `command`.
- `useCommands` does nothing without a provider. A screen declares its commands whether or not the palette is installed, and an app without `command` renders and behaves as before. The sidebar keeps its raw Cmd/Ctrl+B listener only while `useCommandProvider()` is false, so the key works in both cases and never fires twice.
- Only `engine.ts` imports `@tanstack/react-hotkeys`. The library is beta, so a swap to `tinykeys` or another engine edits that one file and no command.
- Each app's descriptor carries the gated `plugin-array` patch, so a new SPA on the shell copies `shell-extensions.ts` and adds the same patch to its own descriptor. Removing `command` takes the patch back out through the `when.installed` rule.
- The `shellExtensions` list must keep its `extensions` property while it is empty, or the patch has nothing to append into. Two entries with one `id` throw at module load.
- A shortcut exists only on a command, so the palette and the `?` sheet cannot miss a binding. A conflict throws in development with both command ids and warns once in production, and the `node:test` registry check is the gate.
- `semverDelta` in `scripts/update-deps.ts` now reads a `0.y` to `0.z` bump as major, so `pnpm deps:update` never pre-checks a bump of the beta engine.
