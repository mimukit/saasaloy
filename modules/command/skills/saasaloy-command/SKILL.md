---
name: saasaloy-command
description: Runbook for the command module, the Cmd/Ctrl+K command palette, the G-then-letter navigation keys, the ? shortcut sheet and the key registry behind them in the admin and app SPAs. Use when adding a command or a keyboard shortcut to a screen, picking a key, reading a binding conflict error, changing the palette or the sheet, or debugging a key that does not fire.
---

# command: the command palette and the keyboard shortcuts

`command` is a **feature module** (`saasaloy:feature`). It depends on `shell`, which `add` resolves and installs first. It takes neither providers nor drivers: it wraps no external service.

A project gets one keyboard model for every signed-in SPA on the shell. Cmd+K (Ctrl+K off macOS) opens a palette of every command the current screen and the app declare. `G` then a letter moves between screens, single keys act on the page, and `?` opens a sheet that lists every binding. A screen declares its commands once, through `useCommands` from the shell, and the palette row, the key binding and the sheet line all come from that one declaration.

## What it installs

| File | Lands at |
| --- | --- |
| `files/ui/lib/command/registry.ts` | `packages/ui/src/lib/command/registry.ts`: the pure rules. It merges the registrations, parses shortcuts, finds conflicts, and builds the palette groups and the sheet sections |
| `files/ui/lib/command/engine.ts` | `packages/ui/src/lib/command/engine.ts`: the only file that imports `@tanstack/react-hotkeys` |
| `files/ui/lib/command/filter.ts` | `packages/ui/src/lib/command/filter.ts`: the palette filter on `@leeoniya/ufuzzy` |
| `files/ui/blocks/command/keycaps.tsx` | `packages/ui/src/blocks/command/keycaps.tsx`: a shortcut drawn as shell `Kbd` caps |
| `files/ui/blocks/command/command-palette.tsx` | `packages/ui/src/blocks/command/command-palette.tsx`: the palette |
| `files/ui/blocks/command/shortcut-help.tsx` | `packages/ui/src/blocks/command/shortcut-help.tsx`: the `?` sheet |
| `files/ui/containers/command/command-root.tsx` | `packages/ui/src/containers/command/command-root.tsx`: the provider, the two bindings that open the views, the header trigger, and `commandExtension()` |

It also adds two exact-pinned dependencies to `packages/ui/package.json`: `@tanstack/react-hotkeys` and `@leeoniya/ufuzzy`. Run `pnpm install` after `add`.

## Wire-up

You do nothing by hand. The `admin` and `app` descriptors each carry a `plugin-array` patch gated on `command`, so `saasaloy add command` writes this line into `apps/admin/src/components/shell-extensions.ts` and `apps/app/src/components/shell-extensions.ts`, with the import above it:

```ts
import { commandExtension } from "@repo/ui/containers/command/command-root";

export const shellExtensions = defineShellExtensions({
  extensions: [commandExtension()],
});
```

Install order does not matter. When `admin` or `app` lands after `command`, the backfill writes the patch in that run (ADR 0054). `ShellLayout` wraps the layout in the extension's provider and renders the header trigger at the right of the header, after the page path.

A new SPA on the shell gets the same model in two steps. Copy `src/components/shell-extensions.ts` from `admin`, pass the list to `ShellLayout` as `extensions`, and add `commandExtension()` to it. Then declare the app's own commands from a child of `ShellLayout`, as `AdminCommands` in `apps/admin/src/components/app-shell.tsx` does. A `useCommands` call in the component that renders `ShellLayout` runs above the provider and registers nothing.

## Add a command

Declare it where the state it acts on lives, with `useCommands` from `@repo/ui/lib/shell/commands`:

```tsx
import { useCommands } from "@repo/ui/lib/shell/commands";

useCommands(
  [
    {
      id: "admin.show-admins",
      title: "Show admins",
      group: "page",
      keywords: ["role", "filter"],
      when: () => roleFilter !== "admin",
      run: () => {
        setRoleFilter("admin");
      },
    },
  ],
  { scope: "route", label: "Users" }
);
```

The fields:

- `id` is `<module>.<verb>`: the module that declares it, a dot, then what it does in kebab case. `admin.go-to-users`, `admin.sign-out`, `shell.toggle-sidebar`, `command.open-palette`. The id is unique across the app. A repeated id is reported the way a conflict is: it throws in development, and in production it warns once and the first command keeps the id.
- `title` is the palette row and the sheet line. Start with a verb: "Go to Users", "Show admins", "Sign out".
- `group` is `page`, `navigation`, `actions` or `preferences`. The palette lists the groups in that order, and the page group takes the registration's `label` as its heading. Inside a group, the shell's commands come first, then this module's, then every other owner's in declaration order (`PALETTE_OWNER_ORDER` in `lib/command/registry.ts`, read from the id prefix).
- `keywords` are extra words the filter matches. The filter is fuzzy, so "usr" finds "Users" without a keyword.
- `icon` is a module-level lucide component, drawn at 16 px in the muted tone.
- `shortcut` is optional. Most commands are palette-only. See the key map below before you add one.
- `when` hides the row and makes the key pass through while it returns `false`. It is read when the palette opens and when the key is pressed, so it may close over fresh state.
- `active` marks the current choice of a set, such as the theme in use. The palette reads it when it renders and shows "Current" in place of the keycap.
- `run` receives `{ source: "palette" | "shortcut" }`. The palette closes before `run` is called.

A navigation command per nav row comes from `NAV_AREAS`: give the item a `shortcut` in `src/components/nav.ts` and `commands.ts` turns it into "Go to …" with that key. Never derive the letter from the label.

## Scopes

The `scope` says how long a registration lives. The palette lists `global` and `route` commands. The `data-table` keys are bindings only, and the sheet lists them under Data table.

| Scope | What it holds | Lives while |
|---|---|---|
| `global` | the app's own commands: navigation, theme, sign out, the sidebar, and this module's two | the shell is mounted |
| `route` | the current page's commands, first in the palette under `label` | the page is mounted |
| `data-table` | `J`, `K`, `Enter` and `Escape` from `DataTable` | a `DataTable` is mounted |

Every mounted scope overlaps the others: a page's table, the page and the shell are on screen together. So a key may appear once among every registration that is mounted at the same time.

## Default key map

| Key | Command | Where |
|---|---|---|
| `Mod+K` | open and close the palette (`command.open-palette`) | everywhere, also inside a text field |
| `?` | open the shortcut sheet (`command.show-shortcuts`) | everywhere outside a text field; `?` typed into an empty palette search does the same |
| `Mod+B` | toggle the sidebar (`shell.toggle-sidebar`) | everywhere |
| `G` then a letter | go to a nav row: `G O` Overview and `G U` Users in admin, `G H` Home in app | outside a text field |
| `J` / `K` | next / previous table row | while a `DataTable` is mounted |
| `Enter` | open the highlighted row | while a row is highlighted |
| `Escape` | drop the row highlight, and close the detail panel when the page passes `onDismiss` to `DataTable` | while a row is highlighted or selected |

`Mod` is Cmd on macOS and Ctrl elsewhere, and the keycaps follow the platform: `⌘ K` on a Mac, `Ctrl K` on Windows and Linux. Every key is logical, so it follows the typed character: `?` works on every keyboard layout. A single key or a sequence never fires inside a text field. A chord that holds Mod, Ctrl or Alt does. While a dialog or an alert dialog is open, every binding is off, Mod+K included. While the palette or the sheet is open, only Mod+K and `?` act, to switch or close them. Sign out, the theme choices and the page filters are palette-only.

## Reserved keys

These keys carry one meaning in every app. Use a reserved key only for that meaning, or pick a key that is not in this table.

| Key | Meaning |
|---|---|
| `C` | create a record of the page's kind, usually by opening the create dialog |
| `E` | edit the selected record |
| `Mod+Backspace` | delete the selected record, always behind the shell `AlertDialog` confirm |
| `/` | focus the page's filter or search field |
| `G` then a letter | go to a screen; the letter is set on the `NAV_AREAS` row |

`J`, `K`, `Enter` and `Escape` belong to the data table while one is mounted, so a page with a table cannot bind them. They act only while no control outside the table holds the focus.

## Conflicts

Two bindings conflict when they are the same chord or sequence, or when one is a prefix of the other (`G` against `G U`), in overlapping scopes. `Ctrl` counts as `Mod` in this check, because Mod is Control on Windows and Linux, so `Ctrl+B` conflicts with `Mod+B`. A command whose `when` is false still owns its key. In development a conflict throws, and the error names both command ids, the first of which keeps the key. In production it warns once in the console, the first-declared binding keeps the key, and the second command stays in the palette with no key.

In your project the development-mode throw is the check: open the app with `pnpm dev` after you add a key, and a conflict stops the page with both command ids. The saasaloy repo guards the shipped defaults with its own tests, which run the app's commands, this module's two keys, `Mod+B` and the four table keys through `findConflicts`; those tests stay in the saasaloy repo and never reach a project.

## The palette and the sheet

The palette follows the approved mockup in plan 0084, Phase 1: 576 px wide, 12vh from the top (8 px below 640 px), a 48 px search row, a list capped at `min(480px, 60vh)`, 34 px rows and a 40 px footer of key hints. Matched letters are semibold and underlined. Keycaps inside both popups take a 1 px `input` hairline with no fill. The sheet groups the bindings under General, one heading per page that binds keys, Navigation, and Data table, in two columns from 640 px.

The trigger sits in the header: a 240 px "Search commands…" field with the palette's keycaps from 640 px up, and a 32 px search icon button below.

## Swapping the engine

`@tanstack/react-hotkeys` is pre-1.0, so `engine.ts` is the only file that imports it, and `pnpm deps:update` treats a `0.y` to `0.z` bump as a major you opt into. To move to another key library, rewrite `engine.ts` against the same `EngineBinding` shape and change the dependency patch in this module's descriptor. Nothing else changes.

## What `remove` leaves behind

`saasaloy remove command` deletes the files above and takes `commandExtension()` and its import back out of each app's `shell-extensions.ts`. It leaves the two dependencies in `packages/ui/package.json` with a warning; delete them by hand and run `pnpm install`. The commands each screen declares stay, and do nothing with no provider mounted. `Mod+B` falls back to the sidebar's own listener.

## Next

Run `saasaloy-app` to register commands for the customer screens.
