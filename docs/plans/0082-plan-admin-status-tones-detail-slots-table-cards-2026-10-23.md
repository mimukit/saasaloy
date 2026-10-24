# Plan: admin status tones, detail panel slots, mobile table cards and live nav counts

Grilled: 2026-10-24

Issue: #217. Downstream: brainaloylabs/primeshopr#80.

## Context

The admin Payments page from #212 was built on the shared admin parts, and four of them could not draw what its approved round 1 mockup drew (plan 0073, Phase 2). The owner accepted the page as built (mockup round 2) and moved the shared work to #217:

- `StatusPill` (`modules/admin/files/ui/components/admin/status-pill.tsx`) has two tones, `open` and `neutral`. The mockup used green for successful, red for failed and amber for "Amount differs".
- `DetailPanel` (`ui/blocks/admin/detail-panel.tsx`) has no header status, banner or footer slot. `payments.tsx` puts its "Nothing here is verified" banner and its Confirm and Reject buttons in separate cards above and below the panel, and shows the status as the first attribute row.
- `DataTable` (`ui/blocks/admin/data-table.tsx`) has no card layout below `md`. At 360 px the payments table scrolls sideways, and the amount and the status are off screen.
- A nav row cannot carry a live count. `ShellSidebar` already renders a `count` from `NAV_AREAS` (`src/components/nav.ts`), but that list is a static `as const` array that a `nav-entry` patch writes at `add` time.

What the research found beyond the issue text:

- `admin.css` already has colour values for the tones: the `success`, `warning` and `destructive` pairs, light and dark. `Badge` (`ui/components/admin/badge.tsx`) tints them as `bg-success/8 text-success-foreground dark:bg-success/16`. No new colour value is needed.
- The tweakcn presets of plan 0071 (#196) break the `destructive` pair. None of the 36 presets sets `success`, `warning`, `info` or `status-open`, but all 36 set `destructive` and `destructive-foreground`. tweakcn uses `destructive-foreground` as the text on a solid red fill (white in 30 of 36 light blocks), and `admin.css` uses it as red text on a pale tint. Some presets also make `destructive` not red (Claude `oklch(0.19 0.002 106)`, neo-brutalism black). Checked on 2026-10-24 in the mockup with each preset scoped as `:root[data-preset]`: under Claude in light mode a `bad` pill is white text on a grey tint and cannot be read.
- Status is drawn two ways today. `users.tsx`, the overview health check, `billing.tsx`, `teams.tsx` and `api-key-workspace.tsx` use `Badge variant="success|warning|secondary|outline"`; `users.tsx` and `role-workspace.tsx` use `StatusPill`. primeshopr mixes both on one page (`apps/admin/src/routes/items.$number.tsx`, `quotes.index.tsx`, `users.tsx`), because the pill has no green, amber or red.
- primeshopr no longer carries its own `status-pill.tsx` or `page-layout.tsx`. The shell move (722f3d2, primeshopr#82) took saasaloy's copies into `packages/ui` unchanged. The pressure on #80 is now the workaround above, plus its ported `payments.tsx`, which repeats the two-tone comment and the separate banner and action cards.
- `modules/payment/files/admin/routes/payments.tsx` on `main` imports `@admin/components/data-table`, `detail-panel`, `filter-chips`, `page-header`, `page-layout` and `status-pill`. PR #204 moved those files to `@repo/ui/blocks/admin/`, `@repo/ui/containers/admin/` and `@repo/ui/components/admin/` on 2026-10-22, and the admin module no longer ships them under `apps/admin/src/components/`. So a project that adds `payment` today cannot build its admin app. `release:smoke` lints the scaffold but does not build or typecheck it (#220), which is why nothing caught it.

Goal: the shared admin parts carry status, record banners, pinned record actions, phone-width lists and queue counts, so no module page and no downstream project builds its own copy of them.

Target: after Phase 6, `payments.tsx` and the other module pages in this repo contain no status `Badge`, no banner or action card outside `DetailPanel`, and no sideways scroll at 360 px. primeshopr#80 ports the same pages with no project-local status or layout part; that is `measured after release`, in primeshopr.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Which part owns status colour | `StatusPill`. It gains `ok`, `warn` and `bad` beside `open` and `neutral`. Every status `Badge` on a module page moves to `StatusPill`. `Badge` stays for tags that are not a state: a flag type, "code default", a plan name, a count. Owner pick, 2026-10-23. |
| Tone colours | `admin.css` gains three pairs beside `status-open`: `--status-ok` and `--status-ok-foreground`, `--status-warn` and `--status-warn-foreground`, `--status-bad` and `--status-bad-foreground`, light and dark, with `@theme inline` mappings. Their values copy today's `success`, `warning` and `destructive` pairs, so the approved round 1 looks the same. `ok`, `warn` and `bad` use Badge's tint recipe on them (`/8` light, `/16` dark) with the `-foreground` text. `DESIGN.md` gains the three colour pairs and `status-pill-ok`, `-warn` and `-bad` component entries, and `status-pill.tsx` drops its "two tones and no more" text. Owner pick, 2026-10-24. |
| Tone colours under a theme preset | No tweakcn preset sets a `status-*` key, so `open`, `ok`, `warn` and `bad` keep their colours under any preset. A status colour carries a meaning and does not follow the brand theme. `neutral` reads `muted` and follows the preset. The wider `destructive-foreground` conflict for `Badge`, `Alert` and the error text is plan 0071's to settle (comment on #196, 2026-10-24). Owner pick, 2026-10-24. |
| Domain value to tone | Stays the caller's job, as `status-pill.tsx` says today. Each page keeps one `toneFor(status)` map beside its labels. |
| DetailPanel slots | Three new optional props. `status` renders a node after the title in the header. `banner` renders under the header, above the tabs, and does not scroll. `footer` renders under the scroll area, behind a hairline, and does not scroll. `actions` stays where it is, inside the scrolling body, for in-body controls such as a role select. Owner pick, 2026-10-23. |
| Banner content | The caller passes an `Alert` from `ui/components/admin/alert.tsx` (it has `warning`, `error`, `info` and `success` variants). `DetailPanel` adds only the placement and the gutter, not a second banner component. |
| DataTable cards below `md` | A column may set `card: "title" \| "trailing" \| "line" \| "hidden"`. With no hint, the first column is the title and every other column is a label and value line. `trailing` sits at the right of the title row, for an amount or a status. Owner pick, 2026-10-23. |
| Card markup | Below `md` the rows render as a `<ul>` of cards, and each card with `onRowClick` is one `<button>` with `aria-current` on the selected one. The table and the cards never mount together. Both `DataTable` and `PageLayout` read the breakpoint through the existing `useMediaQuery("md")` in `ui/lib/admin/use-media-query.ts`, which `sidebar.tsx` already uses, and `page-layout.tsx` drops its private `useIsDesktop` and `MD_QUERY`. |
| Sorting below `md` | The card list keeps the order the table's sort state gives. It shows no sort control in this plan. |
| Live nav count | A new `apps/admin/src/components/nav-counts.ts` exports `NAV_COUNTS`, a const array of `{ to, path }`. A module adds its entry with a `const-array` patch, which takes plain JSON, so no CLI change. `app-shell.tsx` fetches each `path` through the api origin with the session cookie, reads `{ count: number }`, and passes `counts` keyed by `to` to `ShellLayout`. The sidebar shows a live count over a static one. Owner pick, 2026-10-23. |
| Count freshness | One query per entry under the key `["nav-count", to]`, refetched on window focus and every 60 s. A page that changes the count invalidates its own key after a mutation. |
| Payment count route | `GET /admin/payment/review-count` returns `{ count }`, the number of `submitted` payments, from the existing `countPayments`. Behind `requireAdmin` like the other `/admin/payment` routes. |
| Test approach | No DOM runner exists (#203 owns that). Pure logic moves into JSX-free `.ts` files and gets `node --test` tests under `test:modules`: the card slot rule (`cardSlots(columns)`) and the count merge. Rendering is checked in a real browser with `playwright-cli` at 360 px and 1280 px, light and dark, and recorded in a `docs/qa/` plan. |
| UI house rules these screens follow | From `modules/admin/files/DESIGN.md`: import controls only from `@repo/ui/components/admin/*`; pad with `--page-gutter`; keep light and dark token pairs together; `accent-sort` is for the active sort column only; badges and pills use the `sm` radius; no colour, radius or type size that `admin.css` does not define. From `AGENTS.md`: a UI plan approves its mockup before any build. |
| Visual reference | Mockup round 1, approved by the owner on 2026-10-24. Throwaway build in `.dev/mockup-217/` (not committed), rendered in the planning thread. It shows the five tones in light and dark with `warn` next to the active sort header; the Payments queue with "Payments 3" in the nav, a `submitted` record with the header status, the warning `Alert` banner and the pinned Confirm and Reject footer, and a `successful` record with Record refund in the footer; Overview, Users, Billing, Teams, API keys, Roles and Flags after the change at 1280 px in both themes; and Payments cards, the detail sheet, Users, Billing, Teams, API keys and Roles at 360 px in both themes. The `status-*` token change after approval keeps every value, so it needs no new round. |
| The broken `payments.tsx` imports | Fixed in Phase 6 as part of the page rework, with no separate bug issue. `main` stays broken for `payment` until #217 merges. Owner pick, grill Q3, 2026-10-24. |
| `warn` text near the sort orange | Kept on today's `warning` values. Round 1 showed a `warn` pill beside the active sort header and was approved. Grill Q4, defaulted. |
| Header status on module pages | Every page whose record has a status passes it to `DetailPanel`'s `status` slot: Payments, Users (role), Billing, Teams and API keys. Roles shows none. The status attribute row goes away wherever the header shows the status. Grill Q5 and Q8, defaulted. |
| Status or tag | Pills: Verified and Pending (Users), health (Overview), invoice status and subscription state (Billing), Active (Teams), Enabled (API keys), Site closed (Flags). Badge tags stay: billing cycle, plan name, role `base`, flag type, code default, member role. As mocked in round 1. Grill Q6, defaulted. |
| Zero live count | A live count of 0 hides the badge. A static `count` in `NAV_AREAS` keeps the "zero renders" rule. The rule lives in the count-merge helper and its test. Owner pick, grill Q1, 2026-10-24. |
| Count polling | 60 s interval and on window focus, with TanStack's default of no polling in a hidden tab. Grill Q7, defaulted. |
| Status column with the panel docked | The table keeps its sideways scroll at 1280 px while the panel is open, as on `main` and in round 1. Grill Q9, defaulted. |
| Payments dialogs | Phase 6 moves the reject and refund dialogs and the page toast from native `<dialog>`, `<select>`, `<textarea>` and a local toast to `Dialog`, `Select`, `Textarea` and `toast` from `@repo/ui/components/admin/*`. Fields and validation stay. Owner pick, grill Q2, 2026-10-24. |
| Delivery | One issue (#217), one PR, one commit per phase. Opening that PR is the only outward action, and afkkit does it. Grill Q10, defaulted. |

## Approach

Change the four shared parts in the admin module, then move the module pages onto them, then move `payments.tsx` back to its round 1 layout. Each shared part keeps its current props working, so a module page that does not change still renders the same.

The plan reuses the colour values of `admin.css`'s `success`, `warning` and `destructive` pairs, under new `status-*` names, and Badge's tint recipe for the tones, `Alert` for the banner, `useMediaQuery` from `ui/lib/admin/use-media-query.ts` for the card switch, the sidebar's existing `count` rendering (`SidebarMenuBadge` in `shell-sidebar.tsx`), the `const-array` patch kind (`packages/cli/src/lib/patch/const-array.ts`) for count entries, and `countPayments` in `modules/payment/files/api/payment-store.ts` for the payment count.

Rejected, one line each: a `countQuery` field on the nav entry (needs the `nav-entry` patch to import a non-icon name); a count the page publishes when it loads (shows nothing until the page is visited); a `renderCard(row)` prop (a second layout per page that drifts from its columns); one pinned slot in place of `actions` (pins tall rbac and teams forms).

### Phase 1: mockup

Attended: settled. The owner approved mockup round 1 on 2026-10-24 (Visual reference row), so Phase 2 onward runs unattended.

- Build a throwaway mockup in `.dev/` on the real admin parts and `admin.css`, with fixture data and no api.
- Show the `StatusPill` tones `open`, `neutral`, `ok`, `warn` and `bad` side by side, light and dark.
- Show the Payments page as the test page: queue with the live nav count "Payments 3", a `submitted` record with the header status, the warning banner and the pinned Confirm and Reject footer, and a `successful` record with "Record refund" in the footer.
- Show the Payments list at 360 px as cards, and the detail sheet at 360 px.
- Show the other module pages that use these parts after the change: Users, Overview health, Billing, Teams, API keys and Roles, at 1280 px in both themes and at 360 px.
- Record the approved round and its date in Design decisions.

Done when: the owner approves a mockup round in the planning session, and the Visual reference row names that round and date.

### Phase 2: StatusPill tones (#217) (built 2026-10-24)

- Add the `status-ok`, `status-warn` and `status-bad` pairs to `:root`, `.dark` and `@theme inline` in `modules/admin/files/ui/styles/admin.css`, with today's `success`, `warning` and `destructive` values.
- Add `ok`, `warn` and `bad` to `StatusTone` and `TONE_CLASS` in `status-pill.tsx`, reading the `status-*` pairs, and rewrite its header comment.
- Add the three colour pairs and the three component entries to `modules/admin/files/DESIGN.md` and update its Colors paragraph.
- Move status `Badge`s to `StatusPill` in `modules/admin/files/src/routes/users.tsx`, `src/routes/index.tsx` (health), `modules/billing/files/admin/routes/billing.tsx` (or its `subscription` successor if #211 lands first), `modules/teams/files/admin/routes/teams.tsx` `modules/api-keys/files/admin/components/api-key-workspace.tsx` and the "Site closed" badge in `modules/feature-flags/files/ui/blocks/admin/feature-flags.tsx`. Leave tag Badges alone.

Done when: `grep -rn 'Badge variant="\(success\|warning\|error\)"' modules/*/files` finds no status use, `grep -n 'success\|warning\|destructive' status-pill.tsx` finds no token, `pnpm lint` and `pnpm test` pass, and a scaffold with those modules shows the pills in both themes with the same colours as round 1.

### Phase 3: DetailPanel slots (#217) (built 2026-10-24)

- Add `status`, `banner` and `footer` to `DetailPanel`, placed as Design decisions says, inside the docked column and the `md` sheet alike.
- Document the three props in `modules/admin/skills/saasaloy-admin/SKILL.md`.

Done when: a panel with all three slots keeps the banner and the footer in view while a long body scrolls, at 1280 px docked and at 360 px in the sheet, and a panel with none renders as it does on `main`.

### Phase 4: DataTable card layout (#217) (built 2026-10-24)

- Replace the private `useIsDesktop` in `page-layout.tsx` with `useMediaQuery("md")` from `ui/lib/admin/use-media-query.ts`, and use the same call in `data-table.tsx`.
- Put the card slot rule in a JSX-free `ui/blocks/admin/data-table-cards.ts` (`cardSlots(columns)`), with a `node --test` test beside it.
- Add the `card` hint to `DataTableColumn` and the card list below `md`, with the selected state, the empty state and the keyboard path the table has.

Done when: `pnpm test:modules` runs the new `cardSlots` test green, and at 360 px the Payments, Users, Billing, Teams, API keys and Roles lists show cards with no sideways scroll.

### Phase 5: live nav counts (#217) (built 2026-10-24)

- Add `apps/admin/src/components/nav-counts.ts` with an empty `NAV_COUNTS`, and register the file in the admin module.
- Add a `counts` prop to `ShellLayout` and `ShellSidebar`, and fetch the counts in `app-shell.tsx` as Design decisions says. Put the merge rule in a JSX-free helper with a `node --test` test.
- Add `GET /admin/payment/review-count` and the payment module's `const-array` patch for `{ to: "/payments", path: "/admin/payment/review-count" }`.

Done when: in a scaffold with `admin` and `payment`, the sidebar shows "Payments 1" after one payment is submitted, and the badge disappears after staff confirm it, with no reload. The count-merge test covers the zero rule.

### Phase 6: Payments page back to the round 1 layout (#217) (built 2026-10-24)

- Fix the `@admin/components/*` imports in `payments.tsx` to the `@repo/ui` paths.
- Map statuses to tones: `submitted` `open`, `successful` `ok`, `failed` `bad`, `pending` and `cancelled` `neutral`, and "Amount differs" `warn`.
- Move the status into the header slot, the unverified note into `banner` as a warning `Alert`, and Confirm, Reject and Record refund into `footer`. Drop the Status attribute row and the two cards.
- Move the reject and refund dialogs and the toast to the admin `Dialog`, `Select`, `Textarea` and `toast` parts, with the same fields and validation.
- Set `card` hints on the queue and settled columns, and invalidate `["nav-count", "/payments"]` after a review.
- Write the QA plan under `docs/qa/` with the browser checks at 360 px and 1280 px in both themes.

Done when: a scaffold with `admin` and `payment` passes `pnpm --filter @repo/admin typecheck` after `vite build`, and the Payments page matches the approved mockup round at 360 px and 1280 px in both themes.

## Open questions

None. Grill round 1 on 2026-10-24 settled the six questions from the draft (Q1, Q2, Q4, Q5, Q6, Q7) and the import fix (Q3).

## Non-goals

- A sort control on the card list.
- A DOM test runner (#203).
- The billing to subscription rename (#211). Phase 2 edits whichever module is on `main`.
- primeshopr's own port. primeshopr#80 takes this through `saasaloy update`.
- New colour values in `admin.css`. The three `status-*` pairs copy existing values.
- The `destructive-foreground` conflict outside `StatusPill` (`Badge error`, `Alert error`, the error text). Plan 0071 owns it.
