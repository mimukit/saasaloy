# QA Plan: waitlist module restyled against `@repo/ui`

_Generated 2026-08-06 · covers `origin/main` `bda2b89` → `ced3e37` on branch `issue-44-restyle-the-waitlist-module-against-repo-ui` (issue #44)_

## Summary
- The waitlist module's two web files are restyled to look like they belong to the base landing page: `WaitlistForm.tsx` now composes `Button` / `Input` / `Label` from `@repo/ui` subpaths, and `waitlist.astro` reuses the cta block's panel material (`rounded-2xl bg-muted ring-1 ring-foreground/10`) in a two-column layout.
- "Working" means the section reads as part of the block set in **light and dark**, and every behavior is byte-identical to before: four `status` states, the `http://localhost:4000` API fallback, `type="email" required`, disabled-while-submitting, `role="status"` success / `role="alert"` error, the `for="waitlist-email"` association (now visually hidden), and `client:load` hydration.

**This is a styling-only change.** No API, schema, applier, or descriptor file was touched — the diff is 2 files, +70/−21. So the plan front-loads the visual and layout cases and keeps the behavioral ones as regression, mapped to the prior plan (`docs/qa/qa-waitlist-module-2026-07-24.md`). **That prior doc's ports are stale** (it says api `:5173`, web `:4321`); the shipped template pins **web `:3000`** and **api `:4000`**. Use the ports in this document.

## Preconditions

- Branch `issue-44-restyle-the-waitlist-module-against-repo-ui` checked out.
- A playground with the waitlist module applied. One already exists at `.dev/playground` from this session's gate run (scaffolded, installed, built, typechecked green). To rebuild from scratch instead — **destructive, wipes the existing playground**:

```sh
pnpm run play:reset
```

```sh
cd .dev/playground && ./saasaloy add waitlist --yes
```

```sh
pnpm -C .dev/playground install
```

- The D1 table for the row-landing cases (TC-5, TC-6). The module ships no pre-generated SQL:

```sh
pnpm -C .dev/playground --filter @repo/db db:generate && pnpm -C .dev/playground --filter @repo/db db:migrate:local
```

- Two dev servers, separate terminals — **api on `:4000`, web on `:3000`** (both ports are pinned; `astro.config.mjs` uses `strictPort`):

```sh
pnpm -C .dev/playground --filter @repo/api dev
```

```sh
pnpm -C .dev/playground --filter web dev
```

- A **real browser** with devtools. Several cases need the OS/browser dark-mode toggle — `Layout.astro` sets `.dark` pre-paint from `prefers-color-scheme`, so switch the **system** theme (or devtools → Rendering → *Emulate prefers-color-scheme*), not an in-page control. There is none.
- No auth, no tokens, no feature flags. The endpoint is unauthenticated.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

Every case below needs a human — a browser, a live api Worker, or visual/UX judgment. The checks a machine could settle were run by the agent and are recorded under [Automated verification](#automated-verification-by-ai-agent).

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Section reads as part of the block set — light mode | 🔴 Critical |
| TC-2 | Section reads as part of the block set — dark mode | 🔴 Critical |
| TC-3 | Two-column layout collapses cleanly across breakpoints | 🔴 Critical |
| TC-4 | Panel gutter matches the blocks above it (no nested container) | 🔴 Critical |
| TC-5 | Happy path: submit → success panel replaces the form in place | 🔴 Critical |
| TC-6 | Submitting state: disabled controls, no layout jump, no double-submit | 🟡 Normal |
| TC-7 | api unreachable → error text is legible in both themes | 🟡 Normal |
| TC-8 | Native email validation still blocks submit | 🟡 Normal |
| TC-9 | Keyboard-only submit + visible focus rings | 🟡 Normal |
| TC-10 | Screen reader: hidden label, success and error announcements | 🟢 Low |
| TC-11 | Long email / narrow viewport doesn't break the row | 🟢 Low |
| TC-12 | A second dropped section still co-exists and sorts | 🟢 Low |

## Test cases

### TC-1 — Section reads as part of the block set — light mode  ·  🔴 Critical
_Old plan's TC-1, retargeted at cohesion rather than mere presence._

**Steps**
1. Ensure the system theme is **light**.
2. Open `http://localhost:3000/`.
3. Scroll to the bottom of the page. The order is hero → features → pricing → faq → **cta** → **waitlist**.
4. Compare the waitlist panel side by side with the cta panel immediately above it.

**Expected**
- The waitlist panel uses the same material as cta: rounded corners of the same radius, the same muted fill, the same hairline ring.
- It does **not** read as a second centred cta — the heading and copy sit left, the form sits right, on a wide viewport.
- Heading weight and size match the cta heading; the body copy is muted the same amount.
- Nothing renders in a raw/unstyled state (no default-blue link colour, no browser-default input chrome, no Times New Roman).
- The React island has hydrated: the input accepts typing and the button is clickable.
- The browser console is clean — no unresolved `@repo/ui/components/*` import, no hydration mismatch warning.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — Section reads as part of the block set — dark mode  ·  🔴 Critical
**Steps**
1. Switch the system theme to **dark** (or devtools → Rendering → *Emulate prefers-color-scheme: dark*).
2. Hard-reload `http://localhost:3000/` so the pre-paint `.dark` script runs on a fresh load.
3. Inspect the waitlist panel, the input, the button, and (after TC-7) the error text.

**Expected**
- The panel is a dark muted surface, not a light panel punched into a dark page — it tracks the cta panel above it exactly.
- The heading is legible against the panel; the body copy stays a step lower in contrast without becoming unreadable.
- The input's border and background are visible against the panel — the field doesn't disappear into it.
- The button keeps its primary fill and readable label.
- No flash of a light panel on load (the theme is set before paint).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — Two-column layout collapses cleanly across breakpoints  ·  🔴 Critical
**Steps**
1. With `/` open, resize the window (or use devtools device toolbar) through these widths: **1440px**, **1024px**, **900px**, **640px**, **375px**.
2. At each width, look at the waitlist panel.

**Expected**
- **≥1024px** — two columns: copy left, form right, vertically centred against each other.
- **<1024px** — one column: copy stacked above the form, still inside one panel.
- **≥640px** — the input and button sit on one row, the button to the right of the input, tops and bottoms aligned (both are 36px tall).
- **<640px** — the input and button stack, the button full-width under the input.
- No horizontal scrollbar appears at any width, including 375px.
- The panel's inner padding loosens on wider viewports rather than the copy hugging the edge.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — Panel gutter matches the blocks above it (no nested container)  ·  🔴 Critical
_This is the specific way the restyle could go wrong: `index.astro`'s section glob already wraps every dropped section in `mx-auto w-full max-w-6xl px-6`, so a section that re-adds them nests a second container and visibly narrows._

**Steps**
1. On `/` at a wide viewport (≥1280px), sight-line the **left edge** of the waitlist panel against the left edge of the cta panel directly above it.
2. Do the same on the right edge.
3. Optionally confirm with devtools: select the waitlist `<section>` and read its computed width against the cta `<section>`'s inner panel.

**Expected**
- Both panels start and end at the same x-positions — the waitlist panel is not inset relative to cta.
- The waitlist panel is not narrower than the page's other content.
- The vertical rhythm between cta and waitlist matches the spacing between the other sections (no double gap, no collision).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — Happy path: submit → success panel replaces the form in place  ·  🔴 Critical
_Old plan's TC-2 + TC-6 success half. Needs a live api Worker._

**Steps**
1. With both servers up, enter `alice@example.com` in the waitlist input and click **Join the waitlist**.
2. Watch the Network tab.
3. Confirm the row landed:

```sh
cd .dev/playground/apps/api && node_modules/.bin/wrangler d1 execute DB --local --config wrangler.jsonc --persist-to .wrangler/state --command "SELECT id, email, created_at FROM waitlist;"
```

**Expected**
- The Network tab shows `POST http://localhost:4000/waitlist` → `200` with `{"ok":true}`.
- The whole form is **replaced in place** by the confirmation "You're on the list — we'll be in touch." — the message lands where the input was, no toast, no lingering enabled form.
- The confirmation renders as a bordered card on the page background (it sits inside the muted panel, so it reads as a distinct surface, not as flat text).
- The panel does not visibly jump in height or reflow the sections below it.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — Submitting state: disabled controls, no layout jump, no double-submit  ·  🟡 Normal
_Old plan's TC-6. The restyle is the reason this needs a re-run: `disabled` now drives real styling on both primitives._

**Steps**
1. Reload `/`. In devtools → Network, set throttling to **Slow 3G** so the in-flight state is visible.
2. Enter `bob@example.com` and submit.
3. During the request, try to click the button again and try to type in the input.

**Expected**
- The button label flips to "Joining…" while in flight.
- Both the input and the button visibly read as disabled (dimmed, cursor not allowed) — not merely inert-but-identical.
- The button does not change width enough to shove the input around — the row stays stable through the label swap.
- A second click does nothing; only one `POST /waitlist` appears in the Network tab.
- Typing in the input during the request has no effect.
- On response the form is replaced by the success message (TC-5).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-7 — api unreachable → error text is legible in both themes  ·  🟡 Normal
_Old plan's TC-5, extended with the new `text-destructive` styling._

**Steps**
1. Stop the api dev server (Ctrl-C in its terminal).
2. Reload `/`, enter `carol@example.com`, and submit.
3. Read the error message. Then switch the system theme and hard-reload, and repeat.

**Expected**
- The message "Something went wrong — try again." appears **below** the input row, inside the panel.
- It is rendered in the destructive/red token, clearly distinct from the muted body copy.
- It is legible against the muted panel in **both** light and dark — not a dark red on a dark panel.
- The form is still there and re-enabled — no permanent "Joining…" hang.
- The section layout does not shift more than the one added line of text.
- Restart the api server before continuing.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-8 — Native email validation still blocks submit  ·  🟡 Normal
_Old plan's TC-4. `Input` from `@repo/ui` must not have swallowed `type="email"` / `required`._

**Steps**
1. Reload `/`. Leave the input **empty** and click **Join the waitlist**.
2. Then type `not-an-email` (no `@`) and click submit.
3. Watch the Network tab throughout.
4. Separately, confirm the server still rejects a malformed value that bypasses the browser:

```sh
curl -i -X POST http://localhost:4000/waitlist -H 'Content-Type: application/json' -d '{"email":"not-an-email"}'
```

**Expected**
- Empty submit: the browser's native "Please fill out this field" bubble appears, anchored to the input; **no** request fires.
- `not-an-email`: the browser's native "please enter an email address" bubble appears; **no** request fires.
- The validation bubble points at the input and is not clipped by the panel.
- The `curl` returns **`400`**, not `200` — the zod `z.email()` validator still guards the route.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-9 — Keyboard-only submit + visible focus rings  ·  🟡 Normal
_Old plan's TC-8, first half. The `@repo/ui` primitives ship `focus-visible` ring styling the raw elements never had — this is new surface._

**Steps**
1. Reload `/`. Click once on the page background, then press **Tab** repeatedly until focus reaches the waitlist input.
2. Type an email, press **Tab** to the button, press **Enter**.
3. Repeat in dark mode.

**Expected**
- Focus order is input → button; nothing invisible traps focus in between.
- The focused input shows a clear ring/border change — visible against the muted panel, in both themes.
- The focused button shows a clear ring — and the ring is not clipped or hidden by the panel edge.
- **Enter** on the focused button submits the form; the flow behaves exactly as TC-5.
- Pressing **Enter** while focus is in the input also submits (native form behavior).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-10 — Screen reader: hidden label, success and error announcements  ·  🟢 Low
_Old plan's TC-8, second half. The label is now `sr-only` — visually hidden but still present and associated. This case exists to prove "hidden" didn't become "gone"._

**Steps**
1. Start a screen reader (VoiceOver on macOS, NVDA on Windows).
2. Navigate to the waitlist input and listen to how it is announced.
3. Submit a valid email; listen when the success message replaces the form.
4. Stop the api server, submit again; listen when the error appears.
5. Also click directly on where the label *would* be — it should not create a dead click target or a stray gap.

**Expected**
- The input is announced as "Email" — the `sr-only` label is still read even though nothing is drawn.
- The label occupies no visible space and does not add a gap above the input.
- The success message is announced politely (`role="status"`).
- The error message is announced assertively (`role="alert"`).
- The button is announced with its current label, and as disabled while submitting.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-11 — Long email / narrow viewport doesn't break the row  ·  🟢 Low
**Steps**
1. At **375px** width, type a long address such as `a-very-long-address-for-testing@some-quite-long-domain.example.com`.
2. Then repeat at **768px** and **1440px**.

**Expected**
- The text scrolls within the input; the input does not grow past the panel or push the button off-screen.
- No horizontal page scrollbar appears at any width.
- The button stays fully visible and clickable at every width.
- The heading and body copy wrap sensibly — no single word overflowing the panel.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-12 — A second dropped section still co-exists and sorts  ·  🟢 Low
_Old plan's TC-7. Confirms the restyled section is still an ordinary glob citizen._

**Steps**
1. Create `.dev/playground/apps/web/src/sections/aaa-test.astro` containing a minimal `<section><h2>Test</h2></section>`.
2. Reload `/`.
3. Delete the throwaway file afterward.

**Expected**
- Both sections render; `aaa-test` appears **before** the waitlist section (sorted filename order).
- No edit to `index.astro` was needed.
- The waitlist panel's own spacing is unchanged by the neighbour.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks

The four from the prior plan, re-scoped to what a styling change could plausibly disturb:

- [ ] `./saasaloy add waitlist --yes` still resolves `api → database → waitlist` and applies 21 files (agent-confirmed this session — see below; re-tick only if you re-scaffold).
- [ ] `GET http://localhost:4000/health` still answers after the waitlist route is mounted:

```sh
curl -i http://localhost:4000/health
```

- [ ] Base `index.astro` still renders hero + Terms/Privacy nav with **no** sections present (check on a `play:reset` project before adding waitlist).
- [ ] The cross-origin `POST` from web `:3000` to api `:4000` still passes preflight in a real browser (Network tab shows an `OPTIONS` that succeeds before the `POST`):

```sh
curl -i -X OPTIONS http://localhost:4000/waitlist -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'
```

## Automated verification (by AI agent)

_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

**Gate results carried forward from this session** (run minutes before this plan; the only commit after them, `ced3e37`, changes a comment block only, so they were not re-run):

```sh
pnpm test && pnpm build && pnpm typecheck && pnpm deps:verify
```

```sh
cd .dev/playground && ./saasaloy add waitlist --yes && pnpm -C .dev/playground install && pnpm -C .dev/playground build && pnpm -C .dev/playground typecheck
```

- ✅ `pnpm test` → 9 files / 82 tests passed.
- ✅ `pnpm build` → `packages/cli/dist/index.js`, 48.67 KB.
- ✅ `pnpm typecheck` → clean.
- ✅ `pnpm deps:verify` → green end to end; `verify-css` sentinel found in the built `_astro/Layout.*.css`.
- ✅ Playground loop → `add waitlist --yes` applied 21 files; install, build (3 pages), and typecheck (3 tasks) all green.

**Checks run against the existing build artifacts for this plan** (`.dev/playground/apps/web/dist/`, built 2026-08-06 20:54 — nothing rebuilt or rescaffolded):

```sh
diff modules/waitlist/files/web/sections/waitlist.astro .dev/playground/apps/web/src/sections/waitlist.astro
```

```sh
git show 98aaeb3:modules/waitlist/files/web/components/WaitlistForm.tsx > /tmp/wf.tsx && diff /tmp/wf.tsx .dev/playground/apps/web/src/components/WaitlistForm.tsx
```

```sh
grep -oE '<section id="[a-z-]+"' .dev/playground/apps/web/dist/index.html
```

```sh
grep -oE '<(label|input|button)[^>]*(waitlist-email|Join the waitlist)[^>]*' .dev/playground/apps/web/dist/index.html
```

```sh
grep -nE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|(bg|text|border|ring)-(red|blue|green|slate|gray|zinc|neutral|stone|indigo|violet|emerald|amber)-[0-9]' modules/waitlist/files/web/components/WaitlistForm.tsx modules/waitlist/files/web/sections/waitlist.astro
```

```sh
grep -oF -e 'ring-foreground\/10' -e 'lg\:grid-cols-2' -e 'sm\:px-10' -e 'sm\:flex-row' -e 'lg\:items-center' -e 'lg\:gap-12' -e 'sr-only' -e 'text-balance' -e 'text-pretty' .dev/playground/apps/web/dist/_astro/Layout.CyVp-WHp.css
```

- ✅ **Artifacts are valid for this branch.** `waitlist.astro` in the playground is byte-identical to the module source at `HEAD`. `WaitlistForm.tsx` matches `98aaeb3` exactly; its only delta to `ced3e37` is the reworded comment block, which emits nothing — so the built HTML/CSS is the artifact of the code under test.
- ✅ **Section renders and is ordered last.** Built `index.html` contains `<section id="waitlist" class="scroll-mt-20 py-20">`, immediately after `<section id="cta">` — confirming the two-column rationale (two centred muted panels back to back would have stuttered).
- ✅ **No nested container.** The waitlist section markup contains no `mx-auto`, no `max-w-6xl`; it sits inside `index.astro`'s `<div class="mx-auto w-full max-w-6xl px-6 pb-20">`. The `px-6` inside the section is the panel's own padding, not a second gutter. TC-4 is the visual confirmation of this.
- ✅ **`@repo/ui` primitives really render.** The built HTML carries `data-slot="label"` (with `sr-only`), `data-slot="input"`, and `data-slot="button"` (`bg-primary text-primary-foreground`) — the vendored primitives, not raw elements.
- ✅ **Control heights align by construction.** `Button size="lg"` resolves to `h-9` in `button.tsx`'s cva, and the `Input` carries an explicit `h-9`. Input and button are the same height; TC-3 confirms it visually.
- ✅ **Behavior invariants intact in source.** `API_BASE = import.meta.env.PUBLIC_API_URL ?? "http://localhost:4000"`; `Status = "idle" | "submitting" | "success" | "error"`; `type="email"`, `required`, `disabled={status === "submitting"}` on both input and button; `role="status"` success, `role="alert"` error; `htmlFor="waitlist-email"` matching `id="waitlist-email"`.
- ✅ **Island still hydrates on load.** `astro-island … component-export="default" client="load"` for `WaitlistForm` is present in the built HTML.
- ✅ **Theme tokens only.** Zero hex, `rgb(`, `hsl(`, or literal palette utilities (`bg-blue-600`-style) in either changed file. Every colour goes through a token: `bg-muted`, `text-muted-foreground`, `ring-foreground/10`, `text-destructive`, `border-border`, `bg-background`.
- ✅ **Every new utility reached the built CSS.** `rounded-2xl`, `bg-muted`, `ring-foreground/10`, `text-destructive`, `border-border`, `sr-only`, `text-balance`, `text-pretty`, `scroll-mt-20`, `sm:px-10`, `sm:flex-row`, `lg:grid-cols-2`, `lg:items-center`, `lg:gap-12` all appear in `_astro/Layout.CyVp-WHp.css`. The `@source` glob picked up the module-dropped files — no class silently missing at runtime.
- ✅ **Dark variants are compiled** and every token the change uses (`--muted`, `--muted-foreground`, `--foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--primary`, `--primary-foreground`) is defined in the built stylesheet — nothing reaches for a token the theme doesn't ship.
- ⚠️ **Known non-regression, not caused by this change:** `pnpm deps:check` exits 1 on unmodified `main` (upstream npm drift in the `api`/`auth`/`database` manifests). `modules/waitlist/registry-item.json` declares `"dependencies": []` and is not implicated. Already recorded in `docs/qa/qa-ui-blocks-landing-page-2026-08-06.md`.
- ⚠️ **Known coverage gap, pre-existing:** the generated `apps/web` declares no `typecheck` script, so `turbo run typecheck` in a generated project covers `@repo/ui` only. A type error inside `WaitlistForm.tsx` is caught by `astro build`'s transpile (which passed), not by `tsc`. Recorded in `docs/qa/qa-ui-tailwind-foundation-2026-08-05.md` as out of scope.

## Not covered / needs human judgment

This box is **headless** — no browser, no GUI, and no live Worker was started. Everything below is the human's, and it is the whole point of this plan:

- **Visual cohesion in light and dark** (TC-1, TC-2) — the agent proved the tokens compile and the classes land; whether the panel *reads* as a sibling of the cta block above it is a judgment call only an eye makes.
- **Responsive behavior** (TC-3, TC-11) — breakpoint collapse, control alignment, overflow at 375px. Static class inspection can't see a layout.
- **The live HTTP round-trip** (TC-5, TC-8's server half, the CORS regression check) — real submit, the `200 {"ok":true}`, the duplicate no-op, the `400` on a malformed body, and the browser preflight all need a running api Worker on `:4000`.
- **Duplicate-email idempotency** — folded into TC-5's D1 query; re-submitting `alice@example.com` must still yield one row and the same success copy. Not exercised here.
- **UX feel** (TC-6, TC-7) — whether the disabled state reads as disabled, whether the label swap shifts the row, whether the error is alarming enough without being loud.
- **Accessibility with real assistive tech** (TC-9, TC-10) — focus-ring visibility against the muted panel, and whether the now-`sr-only` label is actually announced. This is the single riskiest thing the restyle did to a11y and it cannot be checked statically.
- **Contrast ratios** — no automated axe/Lighthouse pass was run. If the panel/copy contrast matters for a compliance target, run one during TC-2.
- **Production `PUBLIC_API_URL`** — dev exercises the `:4000` fallback only; the deployed-Worker value stays doc-only, as in the prior plan.
- **Other browsers** — cases assume one modern browser. Re-run TC-1 to TC-3 elsewhere if the project's browser matrix demands it.
