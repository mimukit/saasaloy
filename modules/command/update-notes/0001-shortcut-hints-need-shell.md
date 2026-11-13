---
title: The command module's key hints need the matching shell
when:
  installed:
    - command
---

## What update does

`command` now puts the sidebar's key hints in `ShortcutHintsContext`, which the `shell` module's `packages/ui/src/lib/shell/commands.ts` exports. The sidebar shows a row's shortcut in its tooltip, shows the next key of a `G` sequence after a short pause, and adds a "Keyboard shortcuts" item to the account menu. The gap allowed between the two keys of a sequence goes from 1000 ms to 2500 ms.

An update that moves `command` and not `shell` leaves `packages/ui/src/containers/command/command-root.tsx` importing a name the old `commands.ts` does not export.

## What the merge plan gets

- `packages/ui/src/lib/shell/commands.ts`, `packages/ui/src/containers/shell/shell-sidebar.tsx` and `packages/ui/src/containers/shell/shell-nav.tsx`, if you edited them.
- `packages/ui/src/containers/command/command-root.tsx`, `packages/ui/src/lib/command/engine.ts` and `packages/ui/src/lib/command/registry.ts`, if you edited them.

## What you do

1. Commit your work first, so the update's changes are the only change in the tree.
2. Update every installed module in one run, so `shell` and `command` move together:

   ```sh
   saasaloy update
   ```

   If you ran `saasaloy update command` alone, run `saasaloy update shell` next.

3. If a nav row in `apps/<app>/src/components/nav.ts` has no `shortcut`, its command has no key either, and the sidebar shows no hint for it. Nothing else changes in your code.

## Verify

```sh
grep -n "ShortcutHintsContext" packages/ui/src/lib/shell/commands.ts
pnpm typecheck
```

The `grep` prints the export, and `pnpm typecheck` passes.
