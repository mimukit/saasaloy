# Plan: UI primitives and shell blocks (#311)

Grilled: 2026-11-04

## Context

PrimeShopr built 17 primitives and several shell features by hand across 314 agent sessions (source: `docs/plans/0096-plan-primeshopr-findings-issues-2026-11-04.md`, "Issue 6"). Each one is work the next Saasaloy project repeats, and each `shadcn add` run hit the same three CLI faults. The reference implementation is `/home/dev/projects/primeshopr` at `21139b8`: `packages/ui/src/components/`, `packages/ui/src/components/shell/`, `packages/ui/src/blocks/shell/`, `packages/ui/src/lib/shell/`, and the in-house date pickers from PrimeShopr issue #163 (PR #165).

The research found that the gap sits in two places, not one:

- The `shell` module (`modules/shell/files/ui/components/shell/`) already ships dialog, popover, select, skeleton, textarea, checkbox, radio group, switch, combobox, input group and toast for the admin and app shells. The base template's web `packages/ui/src/components/` ships none of them.
- The shell lacks the calendar and date pickers, `OverflowTooltip`, `PasswordInput`, and the PrimeShopr changes to `PageHeader`, `DataTable`, `BrandMark` and `ShellLayout`.

Goal: a new project builds a form page, a list page and a date filter from shipped source, with no `shadcn add` and no hand port from PrimeShopr.

Target: every primitive and shell feature in the plan's phases exists in a `.dev/playground` scaffold with `admin` and `app`, typechecks, and renders as the approved mockup round 1 shows. No number fits this work better, because the outcome is presence and look, not speed. The check is the scaffold build plus a screenshot comparison in the last phase.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where web primitives land | The base template's `packages/ui/src/components/`, the folder `components.json` already targets. They come from PrimeShopr's `packages/ui/src/components/`, which used the shadcn `base-nova` style on `@base-ui/react` 1.9.0, the same pin the base already has. `sonner` 2.0.8 and `input-otp` 1.5.0 join the base `packages/ui/package.json`, exact-pinned. Asked, Q6. |
| `@source` lines for web primitives | None in `globals.css`. Its rule lists only components a block or the landing page renders, and no base block renders the new ones. An app that renders one adds its own `@source` line. This keeps the issue clear of #306, which edits the same list. |
| Shared date logic | `lib/calendar.ts`, `lib/date-picker.ts` and `lib/date-field.ts` go in the base template's `packages/ui/src/lib/`, pure and React-free on `Date` and `Intl`, with the copy in `content/date-picker.ts`. The web `components/calendar.tsx` and `components/date-picker.tsx` and the shell `components/shell/calendar.tsx` and `components/shell/date-picker.tsx` import them. The shell module needs the base, so the import always resolves. No `react-day-picker`. |
| Test approach | Shell pure modules (`lib/shell/*.ts`) get `node:test` files with `node:assert/strict` beside the source, run by `pnpm test:modules`; descriptors do not ship them. The base `packages/ui/src/lib/` date modules get no test file in the template, because every template file ships to projects. Their tests live in this repo only, at `packages/cli/test/base-ui/*.test.ts`, on Vitest (PrimeShopr's files, ported), run by a `base-ui` project in `packages/cli/vitest.tooling.config.ts` through `pnpm test:tooling`. Asked, Q19, 2026-11-04. |
| Render tests | None in this issue. #203 owns the DOM runner and the keyboard tests, and a comment on #203 adds the new primitives and date pickers to its list. Asked, Q11. |
| #293 | Folded in. The PageHeader port carries the `basis-48` title block and the wrapping actions row, and the PR closes #293. Defaulted, Q1. |
| PR shape | One PR, one commit per phase. Defaulted, Q2. |
| Palette record search | Split from #311 into a new issue that depends on #300 (PR #302), because both edit `lib/shell/commands.ts`, `command-root.tsx` and `command-palette.tsx`. The new issue takes the old Phase 7 scope: `CommandSearch`, `CommandSearchRow`, `match`, `listed`, `section`, and "detection suggests, Enter runs". Asked, Q7. |
| Calendar locale and week start | The calendars take the locale from `config.app.locale`, not a hard-coded `en-GB`, and the first weekday from `Intl.Locale` week info for that locale, with Monday where the runtime gives none. A `weekStartsOn` prop overrides it. PrimeShopr's fixed Saturday start does not ship. Asked, Q20, 2026-11-04. |
| PageHeader count words | `PageHeader` takes an optional `countLabel?: (count: number, total: number) => string`. Without it the header reads "3 of 6" as ported. Asked, Q21, 2026-11-04. |
| CLI version | The CLI goes from 0.8.0 to 0.9.0 in this PR, because the new base update note carries `version: 0.9.0` and the note test refuses a note above the running CLI. `update.test.ts` lists the new base note id. Asked, Q22, 2026-11-04. |
| Decorative brand mark | `BrandMark` takes `decorative?: boolean`. The auth card and the sidebar header pass it, because the product name sits next to the icon as text, so a screen reader would read the name twice. Found in the build, 2026-11-04. |
| Title and favicon load | The admin and app `brandHtml()` plugins load `@repo/config` with Vite's `runnerImport` in `configResolved`, not with a static import in `vite.config.ts`. The static import made `vite dev` print a `configLoader: native` warning for every extensionless import in the config package. Found in the build, 2026-11-05. |
| `ShellLayout` | Additive only. It gains an `attention?: ReactNode` slot, rendered last in the header after the extension headers. `area`, `currentPath` and the automatic page path stay. Asked, Q8. |
| Attention menu | `blocks/shell/attention-menu.tsx` and the pure `lib/shell/attention.ts` (`attentionRows`) from PrimeShopr. The admin `app-shell.tsx` builds its rows from its existing `NAV_COUNTS` and live counts, with each row's label from its nav row. Defaulted, Q12. |
| PageBody aside | `PageBody` takes `aside?: ReactNode`. With it, the body is a grid at `lg` (`minmax(0,1fr)` and a `20rem` column, `gap-6`), the aside is sticky at the top, and below `lg` the aside stacks under the main column. Without it, `PageBody` renders as today. Asked, Q9. |
| Brand mark | `BrandMark` takes `variant: "icon" \| "full"`, default `icon`. `icon` renders `assets/shell/brand-mark-light.svg` and `brand-mark-dark.svg` as two `<img>` with `dark:hidden` and `hidden dark:block`. `full` renders the icon plus `siteName` (`config.app.name`) as text. The old one-colour mask file goes. The skill explains how to swap in a real wordmark pair. Asked, Q10. |
| Admin tab title and favicon | The admin `index.html` takes its title (`<name> Admin`) and its favicon (the light icon) from `@repo/config` and the brand files at build time, not from a hard-coded "Admin". |
| `PageLayout` motion | PrimeShopr's drawer animation, `detailResize` and `resize-handle.tsx` stay out. Defaulted, Q3. |
| `shadcn add` faults | Phase 2 reproduces each fault in `.dev/playground`. If an alias in `components.json` causes the `cn` guess, the fix goes there. Otherwise `packages/ui/AGENTS.md` documents the fault and its fix. The `button.tsx` overwrite prompt and `sonner`'s `next-themes` need get documented. Defaulted, Q4. |
| Warning token | `brand.css` gains `--warning` and `--warning-foreground` in `:root` and `.dark`, with the `shell.css` values, and `--color-warning*` in its `@theme inline`. Defaulted, Q13. |
| Shell update note | `modules/shell/update-notes/0002-<slug>.md` lists the new files and the additive props. Defaulted, Q14. |
| Template agent rules | The base `AGENTS.md` and `packages/ui/AGENTS.md` replace "No UI kit as a dependency" with: before you copy a kit component, compare it with the source this project already owns, and recommend one to the owner. Defaulted, Q15. They add: a field with more than 7 options uses a combobox, not a select. |
| UI changes with no mockup | A closed list: copy text, a token value, spacing or alignment inside one existing component, an icon swap, a fix that makes a screen match its approved mockup. A change that adds a screen, a section or a component, or changes a layout, needs a mockup. Asked, Q16. |
| Mockup and QA images in a project | A gitignored `.artifacts/` folder at the project root, with `.artifacts/mockups/` and `.artifacts/qa/`. The PR links the published copies. The base `.gitignore` gains `.artifacts/`. Asked, Q17. This rule is for projects; this repo keeps its own mockups in `docs/plans/assets/`. |
| Outward actions | Approved: file the palette record search issue (`needs-planning`, depends on #300), comment on #203 with the new primitives and date pickers, and add a settled-decisions section with the plan link to #311's body. Asked, Q18. |
| UI house rules | From `packages/cli/templates/base/AGENTS.md` and `packages/ui/AGENTS.md`: tokens only, no raw colours; light and dark both; every screen checked at 1440 and 360; a block takes its words as props; the signed-in apps import only the `shell` set. New for this issue: the combobox rule above. |
| Mockup approved | Approved by the owner on 2026-11-04, round 1. Screenshots: `docs/plans/assets/0102-ui-mockup-r1/` (20 images: admin list, form and brand in light and dark at 1440 and 360; the web gallery in light and dark at 1440 and 360; the open range calendar, date-time calendar, attention menu and web combobox). The mockup used `main` at `0e87d34e` plus PrimeShopr `21139b8` files copied into `.dev/playground`. The web Select must show the item label, not the raw value, in the build. A change after this approval starts round 2. |

## Approach

Port, do not redesign. Each file comes from PrimeShopr at `21139b8`, with PrimeShopr names, copy and assets taken out, its imports on `@repo/ui/...` subpaths, and its comments rewritten to cite Saasaloy docs, not PrimeShopr plans. The new parts (the PageBody aside, the brand mark variants, the `attention` slot) take the shape the approved mockup shows.

Rejected alternatives, one line each:

- A new opt-in `ui-forms` module for the web primitives: a second owner of `components/` for no CSS saving.
- Build the palette record search here: it edits the same files as the open PR #302.

### Phase 1: mockup (built 2026-11-04)

Attended: the owner approves the screenshots and the round. Done in the planning session on 2026-11-04, round 1.

- A throwaway gallery in `.dev/playground`: admin routes `/mockup/list`, `/mockup/form`, `/mockup/brand` behind a bypass of the login gate, and a web page `/mockup`.
- Screenshots in `docs/plans/assets/0102-ui-mockup-r1/`.

Done when: the owner approves a round, and the plan carries a row that names its folder and date.

### Phase 2: web primitives, theme and the `shadcn add` faults (built 2026-11-04)

- Port to the base `packages/ui/src/components/`: dialog, popover, select, skeleton, sonner, textarea, checkbox, radio-group, switch, combobox, input-group, input-otp, password-field, number-field.
- Add `sonner` 2.0.8 and `input-otp` 1.5.0 to the base `packages/ui/package.json`. Port the `sonner.tsx` that reads the theme from the `.dark` class, so it needs no `next-themes`.
- Every `cn` import reads `@repo/ui/lib/utils`.
- Make the Select trigger show the item label.
- Add the warning token to `brand.css`.
- Reproduce the three `shadcn add` faults in `.dev/playground` and fix or document each.

Done when: `pnpm deps:check` passes, and `pnpm --filter @repo/ui typecheck` passes in a fresh `.dev/playground`.

Build note (2026-11-05): `pnpm deps:check` exits 1 on 123 outdated pins that `main` also has. The two new pins, `sonner` 2.0.8 and `input-otp` 1.5.0, are current. The playground typecheck passes.

### Phase 3: calendar and date pickers (built 2026-11-04)

- Port `lib/calendar.ts`, `lib/date-picker.ts`, `lib/date-field.ts`, `content/date-picker.ts`, and the calendar and date-picker tests to `packages/cli/test/base-ui/` (Vitest), and the lib files to the base `packages/ui/src/`.
- Port the web `components/calendar.tsx` and `components/date-picker.tsx` (range).
- Port the shell `components/shell/calendar.tsx` and `components/shell/date-picker.tsx` (date, range and date-time), and add both to the shell descriptor's `files[]`.

Done when: `pnpm test:tooling` passes with the ported `base-ui` tests, and the admin form in `.dev/playground` shows all three shell pickers as the mockup does.

### Phase 4: shell primitives and DataTable (built 2026-11-04)

- Port `components/shell/overflow-tooltip.tsx` and `components/shell/password-input.tsx`.
- Port `lib/shell/group-rows.ts` and its test.
- Add `grow`, `pin: "end"`, `groupBy` and `initialSort` to `blocks/shell/data-table.tsx`, with the card view below `md` working for each.
- Add every new file to the shell descriptor's `files[]`.

Done when: `pnpm test:modules` passes with the `group-rows` test, and an admin list in `.dev/playground` matches `list-*-1440.png` and `list-*-360.png`.

### Phase 5: PageHeader, attention menu and PageBody aside (built 2026-11-04)

- Port `lib/shell/updated-at.ts` and its test, and the PageHeader `total`, `badges`, `status` and `updated` props, with the #293 layout fix.
- Port `lib/shell/attention.ts` and its test and `blocks/shell/attention-menu.tsx`. Add the `attention` slot to `ShellLayout`.
- Wire the admin `app-shell.tsx` attention rows from `NAV_COUNTS`.
- Add the `aside` prop to `PageBody`.

Done when: `pnpm test:modules` passes with the `updated-at` and `attention` tests, a page with header actions shows its `h1` at 375 px, and the admin form matches `form-*-1440.png` and `form-*-360.png`.

### Phase 6: brand mark (built 2026-11-04)

- Replace `assets/shell/brand-mark.svg` with the light and dark pair, and give `BrandMark` the two variants.
- Update `assets.d.ts`, the shell descriptor's `files[]`, and every current `BrandMark` caller.
- Take the admin tab title and favicon from `@repo/config` and the light icon.

Done when: the admin in `.dev/playground` shows `<name> Admin` in the tab, the favicon request answers 200, and both variants switch files with the theme as `brand-*.png` shows.

### Phase 7: agent docs, skills, issues and gate (built 2026-11-04)

- Base `AGENTS.md` and `packages/ui/AGENTS.md`: the kit rule, the combobox rule, the `.artifacts/` rule, and the no-mockup list. The base `.gitignore` gains `.artifacts/`.
- `packages/ui/AGENTS.md`: the `shadcn add` faults from Phase 2.
- Update the `saasaloy-shell` skill, and add the shell update note.
- File the palette record search issue, comment on #203, and update #311's body.

Done when: `pnpm lint` and `pnpm test` exit 0, and a fresh `.dev/playground` with `admin` and `app` passes `pnpm typecheck` and `pnpm build`.

## Open questions

None. Every decision is settled.

## Non-goals

- Palette record search (its own issue, after #300).
- A DOM test runner and render tests (#203).
- Sequence hints and sidebar shortcuts (#300).
- `PageLayout` drawer motion, `detailResize` and the resize handle.
- PrimeShopr's product components: address book, attachment picker, step timeline, product image, and the like.
- The web `globals.css` `@source` list (#306).
- A breaking change to `ShellLayout`.
