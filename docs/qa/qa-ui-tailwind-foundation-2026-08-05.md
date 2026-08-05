# QA Plan: Tailwind 4 foundation, theme, and vendored primitives

_Generated 2026-08-05 · covers `origin/main..HEAD` on `issue-42-tailwind-4-foundation-theme-and-vendored-primitives` (5 commits) · issue #42_

## Summary

- Gives the base template a real design layer: Tailwind 4 wired into `apps/web`, an OKLCH theme owned by `@repo/ui`, a shared `Layout.astro`, and seven vendored shadcn primitives.
- "Working" means a scaffolded project builds, the three pages render styled and look like they did before, dark mode follows the OS with no white flash, and utility classes written inside `packages/ui` actually reach the built CSS.

## Preconditions

- **You need a machine with a browser.** Every case below is a visual or interaction judgment. The dev box (devaloy) is headless — run this plan on your laptop, or forward port 3000 over Tailscale.
- Branch: `issue-42-tailwind-4-foundation-theme-and-vendored-primitives`.
- Node >= 24, pnpm 11.
- Nothing renders differently on purpose beyond picking up the theme. Phase 3 (#43) is what makes the landing page look designed — do **not** QA this as a redesign.

Scaffold a fresh playground from the template:

```sh
pnpm play:reset && pnpm -C .dev/playground install
```

Start the dev server (port 3000, `strictPort` — it fails loudly if the port is taken):

```sh
pnpm -C .dev/playground dev
```

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Dark mode follows the OS with no white flash | 🔴 Critical |
| TC-2 | All three pages render styled and faithful to before | 🔴 Critical |
| TC-3 | The `sections/*.astro` drop-in extension point still works | 🔴 Critical |
| TC-4 | Vendored primitives render and behave | 🟡 Normal |
| TC-5 | Native UI follows the theme (`color-scheme`) | 🟡 Normal |
| TC-6 | Adding a new primitive with the shadcn CLI works | 🟡 Normal |
| TC-7 | Mobile / responsive layout | 🟡 Normal |
| TC-8 | Keyboard navigation and focus rings | 🟢 Low |

## Test cases

### TC-1 — Dark mode follows the OS with no white flash · 🔴 Critical

The pre-paint script is inline in `<head>` specifically so a dark-mode visitor never sees a white flash. A deferred script would still *work* while failing this test, so watch the first paint, not the settled page.

**Steps**

1. Set your OS to **dark** mode.
2. Open `http://localhost:3000` in a fresh tab.
3. Watch the very first paint — reload a few times with a hard refresh (Cmd/Ctrl+Shift+R).
4. Switch the OS to **light** mode and reload.

**Expected**

- Page background is dark immediately on load, in dark mode.
- **No white flash at any point**, not even one frame.
- Text is light-on-dark and readable.
- After switching to light mode and reloading, the page is light.
- There is no theme toggle anywhere in the UI — following the OS is the whole feature.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — All three pages render styled and faithful to before · 🔴 Critical

**Steps**

1. Visit `http://localhost:3000/`.
2. Visit `http://localhost:3000/terms`.
3. Visit `http://localhost:3000/privacy`.
4. On each, compare against the pre-change look (`git stash` the branch or open `origin/main` in a second checkout if you want a side-by-side).

**Expected**

- Home: site name as a large heading, two lines of body copy, a `saasaloy add <module>` code span in a monospace font, and a `Terms · Privacy` nav — all centered in the viewport.
- Terms and Privacy: a centered ~42rem column with comfortable margins, a heading, placeholder copy, and a `← Home` link.
- All links work in both directions.
- Nothing looks unstyled, collapsed to the top-left, or full-bleed edge-to-edge.
- Text is not cramped — line height should feel like prose, not tight UI text.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — The `sections/*.astro` drop-in extension point still works · 🔴 Critical

This is the convention the `waitlist` module depends on. The port to `Layout.astro` must not have broken it.

**Steps**

1. Create a section file in the playground:

```sh
mkdir -p .dev/playground/apps/web/src/sections && printf -- '---\n---\n<p class="mt-8 rounded-lg bg-muted p-4 text-muted-foreground">Hello from a dropped-in section.</p>\n' > .dev/playground/apps/web/src/sections/test.astro
```

2. Reload `http://localhost:3000/`.

**Expected**

- The section appears on the landing page, between the body copy and the `Terms · Privacy` nav.
- It is **styled** — rounded corners, a muted background, padding. This proves Tailwind is scanning app source, not just `packages/ui`.
- Removing the file makes it disappear again after a reload.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — Vendored primitives render and behave · 🟡 Normal

No page imports the primitives yet (that's #43), so nothing exercises them at runtime. This case is the only real proof they work before the blocks land.

**Steps**

1. Create a scratch page that exercises the primitives:

```sh
printf -- '---\nimport Layout from "../layouts/Layout.astro";\nimport { Button } from "@repo/ui/components/button";\nimport { Input } from "@repo/ui/components/input";\nimport { Label } from "@repo/ui/components/label";\nimport { Badge } from "@repo/ui/components/badge";\nimport { Separator } from "@repo/ui/components/separator";\nimport { Card, CardHeader, CardTitle, CardContent } from "@repo/ui/components/card";\nimport { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@repo/ui/components/accordion";\n---\n<Layout title="Primitives">\n  <main class="mx-auto flex max-w-2xl flex-col gap-6 p-8">\n    <div class="flex flex-wrap items-center gap-3">\n      <Button>Primary</Button>\n      <Button variant="outline">Outline</Button>\n      <Button variant="destructive">Destructive</Button>\n      <Badge>Badge</Badge>\n    </div>\n    <Separator />\n    <div class="flex flex-col gap-2">\n      <Label for="email">Email</Label>\n      <Input id="email" placeholder="you@example.com" />\n    </div>\n    <Card>\n      <CardHeader><CardTitle>Card title</CardTitle></CardHeader>\n      <CardContent>Card body copy.</CardContent>\n    </Card>\n    <Accordion client:visible>\n      <AccordionItem value="a">\n        <AccordionTrigger>Open me</AccordionTrigger>\n        <AccordionContent>Panel content.</AccordionContent>\n      </AccordionItem>\n    </Accordion>\n  </main>\n</Layout>\n' > .dev/playground/apps/web/src/pages/primitives.astro
```

2. Visit `http://localhost:3000/primitives`.
3. Click the accordion trigger to open and close it.
4. Type into the input; tab into and out of it.
5. Delete the scratch page when finished:

```sh
rm .dev/playground/apps/web/src/pages/primitives.astro
```

**Expected**

- All seven primitives render with real styling — no unstyled HTML.
- The three button variants look visibly different from each other.
- The accordion opens and closes on click, and the panel **animates** rather than snapping.
- The chevron flips between down and up as it opens.
- The input shows a focus ring when focused.
- Everything is legible in both light and dark mode.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — Native UI follows the theme (`color-scheme`) · 🟡 Normal

Regression guard: the port initially dropped this and it was restored in `ba38e62`.

**Steps**

1. In OS dark mode, open any page and make the window short enough to force a scrollbar.
2. Look at the scrollbar.
3. Load the TC-4 scratch page and look at the text input.

**Expected**

- The scrollbar is **dark**, not a bright light-mode scrollbar against a dark page.
- The input's native chrome (caret, any autofill styling, spinner arrows on a number input) matches the dark theme.
- In light mode, both are light.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — Adding a new primitive with the shadcn CLI works · 🟡 Normal

The vendored set is deliberately small, so this is the documented path users will hit early. It's also the case most likely to expose a wrong `components.json`.

**Steps**

1. From the playground, run the CLI exactly as the docs say — from `packages/ui`:

```sh
pnpm -C .dev/playground/packages/ui dlx shadcn@latest add dialog
```

2. Watch where it writes the file, and whether it edits `package.json`.
3. Open the generated `packages/ui/src/components/dialog.tsx`.

**Expected**

- The CLI finds `components.json` without being pointed at it.
- The file lands in `packages/ui/src/components/dialog.tsx`, **not** in `apps/web` or a `src/components/ui/` subdirectory.
- Its `cn` import resolves (`@repo/ui/lib/utils`).
- It uses Base UI (`@base-ui/react`), matching the `base-nova` style — not Radix.
- Note anything it appended to `package.json` as a **version range** — those need re-pinning to exact, per the repo convention. Flag it if you see one.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-7 — Mobile / responsive layout · 🟡 Normal

**Steps**

1. Open devtools, switch to a narrow viewport (375px wide).
2. Visit all three pages.

**Expected**

- No horizontal scrollbar on any page.
- The home heading scales down and does not overflow or wrap awkwardly.
- Terms/Privacy keep readable side padding rather than touching the screen edge.
- Nothing overlaps or is cut off.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-8 — Keyboard navigation and focus rings · 🟢 Low

**Steps**

1. On the home page, press Tab repeatedly.
2. On the TC-4 scratch page, Tab to the accordion trigger and press Enter or Space.

**Expected**

- Focus moves through Terms and Privacy in a sensible order.
- Every focused element shows a **visible** focus ring, in both light and dark mode.
- The accordion opens from the keyboard, not just the mouse.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks

- [ ] `pnpm play:reset` still scaffolds a working project from scratch.
- [ ] The `@web` Vite alias still resolves (dropping a section that imports `@web/...` works).
- [ ] Dev server still comes up on port **3000** and fails loudly if the port is taken.
- [ ] `pnpm -C .dev/playground clean` runs without error and leaves no `dist`/`.astro` behind.
- [ ] `siteName` still imports from `@repo/ui` on all three pages.

## Automated verification (by AI agent)

_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Full pipeline, from a destroyed playground:

```sh
pnpm run play:destroy && pnpm deps:verify
```

Typecheck the vendored primitives, which the pipeline does **not** cover:

```sh
pnpm -C .dev/playground/packages/ui exec tsc --noEmit -p tsconfig.json
```

Confirm `color-scheme` reached the built stylesheet:

```sh
grep -o "color-scheme:[a-z ]*" .dev/playground/apps/web/dist/_astro/*.css | sort -u
```

- ✅ `pnpm deps:verify` from a destroyed playground → green end to end (scaffold → install → build → verify-css → typecheck), with a genuine `cache miss` rather than a replayed cached build.
- ✅ `verify-css` → sentinel `--saasaloy-css-probe` found in the emitted CSS; Tailwind is scanning `packages/ui`.
- ✅ **Negative test of the smoke test itself** — the `packages/ui` `@source` glob was deliberately pointed at a nonexistent directory, the playground rebuilt, and `verify-css` exited **1** with `sentinel ... is missing from all 4 built CSS/HTML file(s)`. The check is load-bearing, not vacuous. The glob was restored and the gate re-run green.
- ✅ `tsc --noEmit` over `packages/ui` → exit 0. All seven primitives compile, and `@base-ui/react` resolves with the expected types.
- ✅ `color-scheme` → both `light` and `dark` present in the built CSS.
- ✅ `tw-animate-css@1.4.0` defines `--animate-accordion-down` / `-up`, so the accordion's animation utilities resolve.
- ⚠️ `turbo run typecheck` executes **0 tasks** — no workspace in the base template declares a `typecheck` script. Pre-existing, and out of scope for #42, but it means the pipeline's typecheck stage is currently a no-op. This is why the primitives were typechecked by hand above.

## Not covered / needs human judgment

- **Everything visual.** No browser exists on the dev box, so no case above was verified by the agent — first-paint behavior, layout fidelity, and the primitives' appearance are all unverified.
- **The white-flash check specifically.** Only a human watching a real first paint can judge it; a passing build says nothing about it.
- **Browser/OS matrix.** Only whatever browser the tester uses. `oklch()` needs Safari 15.4+ / Chrome 111+; older browsers will render colors wrong and nothing here checks that.
- **Visual diff against `origin/main`.** No screenshots were captured, so "faithful to before" is the tester's eye, not a measured comparison.
- **The shadcn registry.** TC-6 hits the network and depends on `shadcn@latest` at the time you run it, which may drift from the pinned `4.16.1`.
- **The primitives under real composition.** They're exercised in isolation on a scratch page; the compound-primitive-across-island-boundary trap the plan warns about only shows up once #43 composes blocks.
