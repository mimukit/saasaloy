# Plan: Sequence hints and shortcut discovery in the shell sidebar

Grilled: 2026-10-31

## Context

A person on a signed-in SPA cannot see the `G`-then-letter keys without opening the `?` sheet first. The `command` module binds them, and the admin and app `nav.ts` files already give each row a `shortcut` (`"G U"`, `"G H"`). Both apps pass `NAV_AREAS` to the shell, so both show the hints with no app change. The sidebar draws none of the keys today.

primeshopr built the fix locally on branch `hotfix-admin-marathon-qa-polish`, commit `23a113c` ("feat(ui): show key hints in the shell sidebar"). Its four `command` files and `lib/shell/commands.ts` are byte-identical to this repo's module copies at `main`, so the diff ports cleanly. Its `shell-sidebar.tsx` differs from ours only in the brand row, which is primeshopr's own change and stays out. primeshopr pins the same `@tanstack/react-hotkeys` 0.16.0, which exports `useHotkeyRegistrations`, `matchedStepCount` and `resetSequenceProgress`. primeshopr drops its local copy once `saasaloy update` ships this.

Goal: a person learns the navigation keys from the sidebar itself, and a person who already knows them sees nothing new.

Target: no number fits, because this is a discovery feature with no baseline. What shows it worked: (1) `pnpm test:modules` passes with the new `pendingShortcuts` and `sidebarHints` tests, (2) in a scaffold with `admin` and `command`, pressing `G` and waiting shows the next keys within 300 ms plus one frame, and typing `G U` fast shows none, (3) a scaffold with `admin` and without `command` builds, typechecks and shows no keys.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the key data crosses the module line | A `ShortcutHintsContext` plus `useShortcutHints()` in `lib/shell/commands.ts`, beside `CommandRegistryContext`. `useShortcutHints()` returns `null` with no `command` module mounted. This follows ADR 0056: the contract and the seam live in `shell`, the engine lives in `command`. The shell never imports `lib/command/*`. |
| The contract shape | `ShortcutHints { keycaps(shortcut), pending: PendingShortcut[], sheetKeycaps, openShortcuts() }` and `PendingShortcut { shortcut, title, rest }`, as in the reference. `keycaps` keeps platform formatting inside `command`. |
| How a row names its key | `ShellNavItem.shortcut?: string`, the same string as the row's command `shortcut`. The sidebar matches a pending hint to a row by that string. No id link, because the nav row has no command id. |
| Where the sequence state comes from | The engine's own state: `useHotkeyRegistrations()` from `@tanstack/react-hotkeys`, filtered to `kind === "sequence"` and `matchedStepCount > 0`, keyed by `options.meta.name` (the engine sets it to the binding id). A new `usePendingSequences()` in `engine.ts` returns those ids. No second key listener. |
| When the hints show | After `HINT_DELAY_MS = 300` with the same pending set. The timer compares the waited set with the current one, so a new set waits again and an ended set hides at once. |
| When the hints close | On completion, a wrong key or Escape (the engine resets progress), the timeout, a `pointerdown` in capture phase, or a window `blur`. The last two call `getHotkeyManager().resetSequenceProgress()`, so the next letter typed does not jump to a screen. The reset clears progress only, so the click that caused it still lands. |
| Sequence timeout | `SEQUENCE_TIMEOUT_MS` goes from 1000 to 2500, so the hints stay long enough to read. Set by the owner's requirements; a click or a blur ends a sequence sooner. |
| Where each hint draws | A row the sequence reaches shows its remaining keys in place of its count badge, in the primary colour. In the collapsed sidebar the key sits on the icon corner at 75 % scale. A reached command with no row goes in an "Also" panel at the left edge of the sidebar footer, over the page. |
| Mobile | Below `md` the sidebar is a `Sheet`, so the next-key badges and the "Also" panel do not render while `isMobile`. The tooltip already hides there. The account menu item stays on mobile. This is the one change from the reference. |
| Tooltip | A row with a shortcut always has a tooltip, in the open sidebar too, with the label and the keycaps. A row with no shortcut keeps today's label-only tooltip, which shows only when collapsed. |
| Account menu | A "Keyboard shortcuts" item with `KeyboardIcon`, between the Theme submenu and the separator. It shows the sheet key from `sheetKeycaps` and calls `openShortcuts()`. It is absent with no `command` module. |
| Pure rules and tests | `pendingShortcuts(bound, ids, platform)` in `lib/command/registry.ts`, tested with a new `describe` block in the existing `registry.test.ts`. `sidebarHints(rowShortcuts, pending)` in a new `lib/shell/shortcut-hints.ts`, tested in a new `shortcut-hints.test.ts` beside it. Both run under `pnpm test:modules` (node test runner through `scripts/ts-resolve-hook.ts`). Test files stay out of `files[]`, like every other module test. The 300 ms timer hook gets no unit test, because `test:modules` runs no React tests; QA covers it. |
| UI house rules | The new keycaps use the shell `Kbd` and `KbdGroup` primitives and the existing `bg-popover` and `border-border` tokens. No new token and no new colour. |
| Approved look | The primeshopr reference at `23a113c`, approved by the owner on 2026-10-31 from their own use of it in the primeshopr admin, in place of a screenshot round. The mobile rule above is the only change. |
| Updating `command` without `shell` | The new `command-root.tsx` imports `ShortcutHintsContext`, so `saasaloy update command` against an old `shell` fails the typecheck. The `saasaloy-command` skill and the release notes say to run `saasaloy update` with no name, or to update `shell` with `command`. If #298 has merged when this builds, also add `modules/command/update-notes/0001-shortcut-hints-need-shell.md`. The general CLI fix is #301. |

## Approach

Port `23a113c` into the module sources, minus primeshopr's brand-row change, plus the mobile gate. The shell side ships first, because it works alone: with no `command` module, `useShortcutHints()` returns `null` and the sidebar draws exactly what it draws today. The `command` side then fills the context.

Reuse:

- `CommandRegistryContext` in `modules/shell/files/ui/lib/shell/commands.ts` is the pattern for the new context.
- `chordKeycaps`, `formatKeycaps` and `parseShortcut` in `modules/command/files/ui/lib/command/registry.ts` and `engine.ts` draw every keycap. The new builder calls `chordKeycaps`.
- `shortcutsSteps` and the `overlay` state in `command-root.tsx` already open the `?` sheet. `openShortcuts` sets the same state.
- `Kbd`, `KbdGroup`, `MenuShortcut` and the `SidebarMenuButton` `tooltip` prop already exist in `modules/shell/files/ui/components/shell/`. `useSidebar().isMobile` already drives the tooltip's mobile rule.
- `navShortcut(item)` in both apps' `nav.ts` already reads the field the sidebar now reads.

Rejected: shell imports the hints from `command` directly (breaks the requirement that the shell works alone, and ADR 0056). A second `keydown` listener in the shell to track the sequence (two sources of truth that drift, for example on Escape).

### Phase 1: the shell contract and the sidebar (#300)

- `modules/shell/files/ui/lib/shell/commands.ts`: add `PendingShortcut`, `ShortcutHints`, `ShortcutHintsContext` and `useShortcutHints()`.
- `modules/shell/files/ui/containers/shell/shell-nav.tsx`: add `ShellNavItem.shortcut?: string` with its doc comment.
- New `modules/shell/files/ui/lib/shell/shortcut-hints.ts` with `sidebarHints()`, and its test beside it.
- `modules/shell/files/ui/containers/shell/shell-sidebar.tsx`: add `StepKeys`, the shortcut tooltip, the next-key badge, the "Also" panel in the footer, and the account menu item. Gate the badge and the panel on `!isMobile`. Keep our brand row as it is.
- `modules/shell/registry-item.json`: add the `files[]` entry for `lib/shell/shortcut-hints.ts`.

Done when: `pnpm test:modules` passes with the two `sidebarHints` cases, and a `.dev` scaffold with `admin` and without `command` builds and typechecks, and its sidebar shows no keycaps and no menu item.

### Phase 2: the command engine and provider (#300)

- `modules/command/files/ui/lib/command/engine.ts`: raise `SEQUENCE_TIMEOUT_MS` to 2500 and add `usePendingSequences()` with the `pointerdown` and `blur` reset.
- `modules/command/files/ui/lib/command/registry.ts`: add `pendingShortcuts()`.
- `modules/command/files/ui/lib/command/registry.test.ts`: add a `pendingShortcuts` block with the three reference cases.
- `modules/command/files/ui/containers/command/command-root.tsx`: add `HINT_DELAY_MS`, `usePendingHints()`, and wrap `children` in `ShortcutHintsContext`.

Done when: `pnpm test:modules` passes with the `pendingShortcuts` cases, and in a `.dev` scaffold with `admin` and `command`:

- pressing `G` and waiting shows `O` and `U` on the Overview and Users rows, in the open and the collapsed sidebar;
- typing `G U` fast navigates with no hint;
- Escape, a click and switching windows each close the hints;
- a click on a row while the hints show still navigates to that row;
- on the Users list, `Escape` while the hints show closes them, and `Escape` with no sequence still clears the row highlight;
- at a width below `md`, `G` and a pause shows no badge and no panel;
- the menu item opens the `?` sheet.

### Phase 3: skills and the full gate (#300)

- `modules/shell/skills/saasaloy-shell/SKILL.md`: document `ShellNavItem.shortcut`, `useShortcutHints()` and its `null` case, the tooltip, the next-key badge, the "Also" panel, the mobile rule, the menu item, and `shortcut-hints.ts` in the file table.
- `modules/command/skills/saasaloy-command/SKILL.md`: document the 2500 ms timeout, the 300 ms hint delay, the close events, `usePendingSequences()`, `pendingShortcuts()`, and that the provider fills `ShortcutHintsContext`. Say that a nav row's `shortcut` must equal its command's, or its hint lands in the "Also" panel. Say that this version needs the matching `shell`, so update both together.
- If #298 has merged, add the `command` update note named in Design decisions.
- Run `pnpm lint`, `pnpm test`, and a typecheck of a full `.dev` scaffold with `admin`, `app` and `command`.

Done when: `pnpm lint` and `pnpm test` exit 0, the scaffold typechecks, and the app SPA's Home row shows `H` after `G` and a pause.

## Open questions

None. Every question from the draft is settled above or is a non-goal.

## Non-goals

- primeshopr's brand-row change and its unlabelled nav group (`dda5fe6`).
- The `ShortcutTooltip` header component from `1eed3ea`.
- Resolving primeshopr's own merge plan when it runs `saasaloy update`.
- Hints for chords (`Mod+K`) or single keys (`?`). Only multi-step sequences show hints.
- Hints on mobile, and an "Also" panel inside the mobile sheet.
- The CLI change that moves a module's `dependsOn` with it on update (#301).
- Any change to the palette, the `?` sheet, or the conflict rules.
- Changes in primeshopr itself.
