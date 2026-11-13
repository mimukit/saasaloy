# QA Plan: UI primitives and shell blocks (#311)

_Generated 2026-11-05 · against `2832b4bd` (clean) · covers the 14 web primitives and the web range picker, the shell date pickers, DataTable, PageHeader, PageBody aside, attention menu, brand mark pair, and the admin and app tab title and favicon_

## Summary
- The base `packages/ui` ships 14 form primitives and a range picker, and the shell module ships date pickers, new page block props, an attention menu and a light and dark brand mark.
- "Working" means each screen matches the approved mockup round 1 in `docs/plans/assets/0102-ui-mockup-r1/`, and the controls work with mouse and keyboard.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-311-add-missing-primitives-and-shell-blocks` at `2832b4bd`.
- The playground at `.dev/playground` is a disposable target. `pnpm play:reset` rebuilds it.
- Sign in to the admin as `superadmin@example.test` with the password `saasaloy-dev-password`.
- The QA demo pages are not in the repo. The agent saved them in `~/qakit/0104-qa-ui-primitives-and-shell-blocks-2026-11-05/fixtures/` on devaloy, with `install.sh` and `remove.sh`.
- The admin starts in the dark theme. Use the theme command in the user menu to change it.
- Screenshots: local to this run at `2832b4bd` and not committed. The names under each case match the labels in the gallery.
- Ports: web 3000, admin 3001, api 4000. Another thread can hold a port. Check before you start.

Check the ports:

```sh
ss -ltnp | grep -E ':(3000|3001|4000)\b' || echo "ports free"
```

Install the QA pages and start the servers (from the repo root, in three terminals):

```sh
~/qakit/0104-qa-ui-primitives-and-shell-blocks-2026-11-05/fixtures/install.sh
```

```sh
pnpm -C .dev/playground --filter @repo/api dev
```

```sh
pnpm -C .dev/playground --filter @repo/admin dev
```

```sh
cd .dev/playground/apps/web && ASTRO_DEV_BACKGROUND=1 pnpm exec astro dev
```

The attention menu shows rows only when its count request answers. In the browser, the count request `http://localhost:4000/qa/users-count` answers 404, so the bell shows the empty state. The agent mocked the request to `{ "count": 1284 }` for the screenshots.

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Playground with the QA pages | Admin list and form pages match the mockup | 🔴 Critical |
| TC-1.2 | 1: Playground with the QA pages | Shell date pickers look and feel right | 🔴 Critical |
| TC-1.3 | 1: Playground with the QA pages | Web primitives match the mockup | 🔴 Critical |
| TC-1.4 | 1: Playground with the QA pages | Attention menu and brand mark read well | 🟡 Normal |
| TC-1.5 | 1: Playground with the QA pages | Worst-case data stays readable | 🟡 Normal |
| TC-1.6 | 1: Playground with the QA pages | Overflow tooltip reads well | 🟢 Low |

## Scenario 1: Playground with the QA pages

**Setup.** The Environment steps above are the whole setup. Open the gallery `~/qakit/0104-qa-ui-primitives-and-shell-blocks-2026-11-05/index.html` beside the mockup folder `docs/plans/assets/0102-ui-mockup-r1/`.

- [ ] Setup complete

### TC-1.1: Admin list and form pages match the mockup  ·  🔴 Critical

**Goal.** The admin page blocks look like the approved mockup at desktop and phone widths, in both themes.

**Steps**

1. Compare the admin demo screenshots with the mockup images `list-*` and `form-*`.
   - [ ] The desktop page matches the mockup in light and in dark
     - header: title, "3 of 6", the Synced pill, "Updated 42s ago" with the refresh icon, the two actions on the right
     - table: the group rows "Due (3)" and "Paid (3)", the pinned Amount column with its left rule, the cut long title
     - aside: the card sits in a right column, at the top
     - form: the date field, the range fields with the calendar button and Clear, the date-time row, the password field
     - screenshots: `admin-demo-light-1440` · `admin-demo-dark-1440`
   - [ ] The phone page reads correctly in light and in dark
     - header: title and count on one line, the actions wrap below
     - rows show as cards with Owner, Status and Amount lines
     - the aside sits below the form
     - screenshots: `admin-demo-light-360` · `admin-demo-dark-360`
2. Open `http://localhost:3001/demo`. Click "Updated 42s ago".
   - [ ] The line changes to "Updated just now" with no layout jump

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Shell date pickers look and feel right  ·  🔴 Critical

**Goal.** The three shell pickers match the mockup, and a person can use them with the keyboard only.

**Steps**

1. Compare the calendar screenshots with the mockup images `open-range-calendar-light-1440` and `open-datetime-calendar-light-1440`.
   - [ ] Each open calendar matches the mockup
     - the month and year selects, the arrows, the weekday row that starts on Sunday for `en-US`
     - today has a dot, the selected day has a filled square, the next month's days are muted
     - screenshots: `calendar-date-light-1440` · `calendar-range-light-1440` · `calendar-datetime-light-1440`
2. On `http://localhost:3001/demo`, press Tab until the "Open calendar" button of "Due date" has focus. Press Enter.
3. Press the arrow keys, Page Down and Home. Press Enter on a day. Then type `13 Nov 2026` in the field and press Tab.
   - [ ] The keyboard movement and the typing feel direct, and the focus ring is always visible

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: Web primitives match the mockup  ·  🔴 Critical

**Goal.** The 14 web primitives and the range picker look like the approved web gallery mockup, in both themes.

**Steps**

1. Compare the web gallery screenshots with the mockup images `web-*` and `open-web-combobox-light-1440`.
   - [ ] The gallery matches the mockup in light and in dark, at 1440 and at 360
     - Select shows "Team plan", not `team`
     - the number field, the OTP slots, the checkbox, switch and radio states, the textarea, the skeleton bars
     - screenshots: `web-gallery-light-1440` · `web-gallery-dark-1440` · `web-gallery-light-360` · `web-gallery-dark-360`
   - [ ] Each open state looks right
     - the Select list, the Combobox list filtered to "Japan", the Dialog with its overlay, the warning toast, the range calendar
     - screenshots: `web-select-light-1440` · `web-combobox-light-1440` · `web-dialog-light-1440` · `web-toast-light-1440` · `web-range-light-1440`
2. Open `http://localhost:3000/qa-demo`. Open and close the dialog, the popover, the select and the combobox. Click "Show toast".
   - [ ] The open and close motion feels smooth, with no flash and no jump

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: Attention menu and brand mark read well  ·  🟡 Normal

**Goal.** The attention menu and the brand mark pair look right in both themes.

**Steps**

1. Compare the attention screenshots with the mockup image `open-attention-light-1440`.
   - [ ] The open menu matches the mockup
     - the "Needs attention" heading, the Users row with its count, the bell badge
     - screenshots: `attention-light-1440` · `attention-dark-1440`
2. Look at the sidebar header in the admin demo screenshots, and compare it with the mockup images `brand-*`.
   - [ ] The brand mark reads clearly on both sidebar backgrounds
     - screenshots: `admin-demo-light-1440` · `admin-demo-dark-1440`
3. Look at the browser tab of `http://localhost:3001/demo`.
   - [ ] The tab icon is the brand mark and stays clear at tab size

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.5: Worst-case data stays readable  ·  🟡 Normal

**Goal.** Long, mixed-script and extreme values do not make the page blocks unusable.

**Steps**

1. Look at the worst-case screenshots.
   - [ ] The page is usable at 1440 and at 360
     - at 360 the long title shows as "Senior Pr…": decide if the count and the badge may take that much room
     - the header shows `1284` with no thousands separator (see Automated verification)
     - the long German word cuts with an ellipsis, `<script>` shows as text, `-42.5` and `12,345,678.9` fit
     - screenshots: `admin-worst-light-1440` · `admin-worst-light-360`
2. Open `http://localhost:3001/demo-worst` in a desktop browser that has CJK fonts.
   - [ ] The Chinese, Vietnamese and Arabic names render correctly, and the Arabic name reads right to left

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.6: Overflow tooltip reads well  ·  🟢 Low

**Goal.** The tooltip for a cut title is easy to read and sits in the right place.

**Steps**

1. Look at the tooltip screenshot.
   - [ ] The tooltip shows the full title under the cell, with a readable width
     - screenshots: `tooltip-light-1100`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above. Stop the three servers with Ctrl+C first.

```sh
~/qakit/0104-qa-ui-primitives-and-shell-blocks-2026-11-05/fixtures/remove.sh
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm lint
```

```sh
pnpm test
```

```sh
pnpm -C .dev/playground turbo run typecheck --concurrency=2
```

```sh
pnpm -C .dev/playground turbo run build --concurrency=2
```

```sh
pnpm deps:check
```

- ✅ `pnpm lint` at `2832b4bd` → exit 0: oxlint type-aware and plain, Stylelint, and Prettier all pass
- ✅ `pnpm test` at `2832b4bd` → exit 0: turbo 2 of 2 tasks, modules 1027 pass, base 91 pass, tooling 295 pass, scripts 533 pass
- ✅ playground `typecheck` at `2832b4bd` → 11 of 11 tasks pass
- ✅ playground `build` at `2832b4bd` → 4 of 4 tasks pass; `apps/admin/dist/index.html` has `<title>Saasaloy Admin</title>` and `apps/app/dist/index.html` has `<title>Saasaloy</title>`, each with a hashed `brand-mark-light` favicon
- ✅ admin dev server → starts with no `configLoader: native` warning, title `Saasaloy Admin`, favicon answers 200 (checked on port 3101 at the pre-commit tree, which has the same files)
- ❌ `pnpm deps:check` → exit 1: 123 outdated pins that `main` also has. The two new pins, `sonner` 2.0.8 and `input-otp` 1.5.0, are current. Not caused by this branch.

### Browser checks
_Driven with Playwright 1.63 (Chromium 1252) against `http://localhost:3001` and `http://localhost:3000` at `2832b4bd`, on the playground with the QA pages. 21 screenshots, local to this run and not committed. The count request `/qa/users-count` was mocked to `{ "count": 1284 }`._

- ✅ admin /demo @light-1440 · tab title → Saasaloy Admin
- ✅ admin /demo @light-1440 · favicon request → 200 for brand-mark-light.svg
- ✅ admin /demo @light-1440 · header count → "3 of 6" shows
- ✅ admin /demo @light-1440 · updated line → Updated 42s ago
- ✅ admin /demo @light-1440 · group headers and initial sort → Due (3): Annual audit 3,000, Office chairs 640, Laptop repair 210; Paid (3): Quarterly 1,200, Monthly hosting 90, Courier 35 (checked again with a `table tbody tr` locator, because the table has one `tbody` per group)
- ✅ admin /demo @light-1440 · pinned Amount column → position: sticky
- ✅ admin /demo @light-1440 · aside beside the table → aside x=1104, table right=1063
- ✅ admin /demo @light-1440 · brand mark in light → 1 visible brand img, alt=""
- ✅ admin /demo @light-1440 · overflow tooltip on the cut title → tooltip shows the full title at 1100 px
- ✅ admin /demo @light-1440 · no tooltip on a short title → 0 tooltip
- ✅ admin /demo @light-1440 · refresh resets the updated line → Updated just now
- ✅ admin /demo @light-1440 · password show and hide → type=text, button now "Hide password"
- ✅ admin /demo @light-1440 · typed date parses on blur → "12 Nov 2026" → 2026-11-12
- ✅ admin /demo @light-1440 · month-first text parses → "11/13/2026" → 2026-11-13
- ✅ admin /demo @light-1440 · impossible date shows an error → aria-invalid=true, stored value stays 2026-11-13
- ✅ admin /demo @light-1440 · calendar week start and keyboard → first weekday "Sun" (en-US), ArrowRight+Enter → 2026-11-05
- ✅ admin /demo @light-1440 · Escape closes and returns focus → grid closed, focus on "Open calendar"
- ✅ admin /demo @light-1440 · range calendar opens → 1 month grid(s)
- ✅ admin /demo @light-1440 · date-time PM → 09:30 + PM → 2026-11-04T21:30
- ✅ admin /demo @light-1440 · date-time calendar opens → 1 grid
- ✅ admin /demo @light-1440 · range Clear → from="", to=""
- ✅ admin /demo @light-1440 · attention badge → bell label "Needs attention: 1284"
- ✅ admin /demo @light-1440 · attention menu row → Users 1284
- ✅ admin /demo @light-1440 · attention keyboard and link → /users
- ✅ admin /demo @light-1440 · console errors → none
- ✅ admin /demo @light-360 · h1 visible → x=17, width=61
- ✅ admin /demo @light-360 · no horizontal overflow → 0px
- ✅ admin /demo @light-360 · aside stacks below the table → aside y=1488, first row y=230
- ✅ admin /demo @light-360 · cards below md → 0 <table> elements; rows render as cards
- ✅ admin /demo @light-360 · console errors → none
- ✅ admin /demo @dark-1440 · brand mark in dark → 1 visible brand img (the dark file)
- ✅ admin /demo @dark-1440 · attention badge → bell label "Needs attention: 1284"
- ✅ admin /demo @dark-1440 · attention menu row → Users 1284
- ✅ admin /demo @dark-1440 · console errors → none
- ✅ admin /demo @dark-360 · h1 visible → x=17, width=61
- ✅ admin /demo @dark-360 · no horizontal overflow → 0px
- ✅ admin /demo @dark-360 · aside stacks below the table → aside y=1488, first row y=230
- ✅ admin /demo @dark-360 · cards below md → 0 <table> elements; rows render as cards
- ✅ admin /demo @dark-360 · console errors → none
- ✅ admin /demo-worst @light-1440 · no undefined, null or NaN on screen → none
- ✅ admin /demo-worst @light-1440 · no horizontal overflow → 0px
- ✅ admin /demo-worst @light-1440 · script text renders literally → literal text
- ✅ admin /demo-worst @light-1440 · empty table state → "No invoices yet." shows
- ✅ admin /demo-worst @light-1440 · count with no filter → reads "1284"
- ✅ admin /demo-worst @light-1440 · count 0 of 6 → "0 of 6"
- ✅ admin /demo-worst @light-1440 · future updated time → Updated just now
- ✅ admin /demo-worst @light-1440 · long h1 stays inside the viewport → right edge 755 of 1440
- ✅ admin /demo-worst @light-1440 · RTL owner keeps dir=auto → dir=auto
- ✅ admin /demo-worst @light-1440 · console errors → none
- ✅ admin /demo-worst @light-360 · no undefined, null or NaN on screen → none
- ✅ admin /demo-worst @light-360 · no horizontal overflow → 0px
- ✅ admin /demo-worst @light-360 · script text renders literally → literal text
- ✅ admin /demo-worst @light-360 · empty table state → "No invoices yet." shows
- ✅ admin /demo-worst @light-360 · count with no filter → reads "1284"
- ✅ admin /demo-worst @light-360 · count 0 of 6 → "0 of 6"
- ✅ admin /demo-worst @light-360 · future updated time → Updated just now
- ✅ admin /demo-worst @light-360 · long h1 stays inside the viewport → right edge 106 of 360
- ✅ admin /demo-worst @light-360 · RTL owner keeps dir=auto → dir=auto
- ✅ admin /demo-worst @light-360 · console errors → none
- ✅ web /qa-demo @light-1440 · select trigger shows the label → "Team plan"
- ✅ web /qa-demo @light-1440 · select opens → 3 options
- ✅ web /qa-demo @light-1440 · combobox filters by typed text → options [Japan], picked "Japan"
- ✅ web /qa-demo @light-1440 · dialog focus and Escape → focus inside=true, closed=true, focus back on trigger=true
- ✅ web /qa-demo @light-1440 · popover opens → title shows
- ✅ web /qa-demo @light-1440 · toast shows → warning toast shows
- ✅ web /qa-demo @light-1440 · number field step → 3 + 1 → 4
- ✅ web /qa-demo @light-1440 · password field toggle → type=text
- ✅ web /qa-demo @light-1440 · otp takes six digits → "123456"
- ✅ web /qa-demo @light-1440 · switch toggles with Space → aria-checked=false
- ✅ web /qa-demo @light-1440 · radio arrow keys → Yearly aria-checked=true
- ✅ web /qa-demo @light-1440 · range picker opens → 1 grid(s)
- ✅ web /qa-demo @light-1440 · toast follows the theme → data-sonner-theme=light
- ✅ web /qa-demo @light-1440 · console errors → none
- ✅ web /qa-demo @light-360 · no horizontal overflow → 0px
- ✅ web /qa-demo @light-360 · toast follows the theme → skipped at 360
- ✅ web /qa-demo @light-360 · console errors → none
- ✅ web /qa-demo @dark-1440 · toast follows the theme → data-sonner-theme=dark
- ✅ web /qa-demo @dark-1440 · console errors → none
- ✅ web /qa-demo @dark-360 · no horizontal overflow → 0px
- ✅ web /qa-demo @dark-360 · toast follows the theme → skipped at 360
- ✅ web /qa-demo @dark-360 · console errors → none

Worst-case data (values set in the `/demo-worst` page props, not by request mocks, because the blocks take their data as props):

- ❌ 🟡 admin /demo-worst · PageHeader `count` = 1284 @ 1440 and 360 → the header reads `1284`; expected `1,284`; fix: format `count` and `total` with `Intl.NumberFormat(config.app.locale)` in `page-header.tsx`. The raw `{count}` is already on `main`; this branch keeps it and adds the raw "X of Y" default.
- ✅ admin /demo-worst · bell badge for 1284 @ 360 → shows `99+`
- ✅ admin /demo-worst · Amount = 12345678.9, 1000000, 0, -42.5 @ 360 → `12,345,678.9`, `1,000,000`, `0`, `-42.5`, no overflow

Checks the agent first recorded as failures, then traced to its own script:

- the weekday locator matched the table header "Title"; scoped to the calendar grid, the row reads Sun to Sat
- the refresh control is the "Updated 42s ago" button (title "Refresh"), not a button named "Refresh"
- Base UI renders the tooltip popup with no `role="tooltip"`; the popup is the `tooltip-viewport` element
- the React warning about `<p>` inside `<p>` came from the demo page's `<p>` empty state; `DataTable` wraps `emptyState` in a `<p>` on `main` too

## Not covered / needs human judgment
- CJK glyphs: devaloy has no CJK fonts, so the screenshots show boxes. TC-1.5 step 2 covers it in a real browser.
- Real attention counts: no installed module adds a `NAV_COUNTS` entry yet, so the bell shows the empty state on a fresh admin. The agent mocked one count.
- The app (`apps/app`) pages: only the title and favicon changed there. The build check covers them.
- Screen reader output: the agent checked accessible names and roles, not the spoken output of VoiceOver or NVDA.
- Browsers other than Chromium, and touch devices.
- Performance with large tables: the demo has 6 rows. A large `groupBy` table is not measured.
- Render and keyboard tests in the suite: #203 owns them. The issue comment lists these components.
- Data layer: this change has no migration, schema or query, so there is no database check.
- Concurrency: the components hold local state only. Double clicks on refresh were not tested.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
