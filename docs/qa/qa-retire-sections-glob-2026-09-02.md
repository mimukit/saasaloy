# QA Plan: Retire the sections glob for ui-package blocks

_Generated 2026-09-02 · against `93a2eff` (+ uncommitted review fixes) · covers issue #62: explicit landing-page imports, the `@ui/blocks/` wire-up pointer, the waitlist block + island split, and `remove`'s wire-up caveat_

## Summary
- A module that ships UI now drops a block into `packages/ui/src/blocks/`, and `saasaloy add` prints a wire-up pointer instead of a page edit.
- "Working" means: the human wires the block onto the page in two lines, the waitlist form submits end to end, and `remove` deletes the files and says the wire-up is not reversed.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-62-retire-the-sections-glob-for-ui-package-blocks`, with the uncommitted review fixes in the working tree.
- The applier runs against the local registry through the playground shim. No network registry is needed.
- Build the CLI and create a fresh playground:

```sh
pnpm run play:reset
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: fresh playground, waitlist added | The add output points at the skill and edits no page | 🔴 Critical |
| TC-1.2 | 1: fresh playground, waitlist added | The wired-up block renders after the CTA | 🔴 Critical |
| TC-1.3 | 1: fresh playground, waitlist added | The form submits end to end and a row lands in D1 | 🔴 Critical |
| TC-1.4 | 1: fresh playground, waitlist added | Bad input and a dead api fail with clear messages | 🟡 Normal |
| TC-1.5 | 1: fresh playground, waitlist added | The block reads well in both themes and by keyboard | 🟢 Low |
| TC-2.1 | 2: waitlist removed again | Remove deletes the files and names the leftover wire-up | 🔴 Critical |

## Scenario 1: fresh playground, waitlist added

**Setup.** Run once, for every case in this scenario.

1. Add the module (this resolves `api → database-d1 → validators → waitlist`):

```sh
cd .dev/playground && ./saasaloy add database-d1 --yes && ./saasaloy add waitlist --yes
```

2. Keep the terminal output of the `add waitlist` run visible. TC-1.1 reads it.
3. Install dependencies. Use the cooldown override if a pin is quarantined:

```sh
cd .dev/playground && corepack pnpm install --config.minimumReleaseAge=0
```

4. Generate and apply the migration:

```sh
cd .dev/playground && pnpm --filter @repo/db db:generate && pnpm --filter @repo/db db:migrate:local
```

- [ ] Setup complete

### TC-1.1: The add output points at the skill and edits no page  ·  🔴 Critical

**Goal.** `add` never places a block. It tells you where the instructions live.

**Steps**

1. Read the "Next steps" box in the `add waitlist` output from the Setup.
   - [ ] It contains a "Manual wire-up needed" line that names `packages/ui/src/blocks/waitlist.tsx` and says to run `/saasaloy-waitlist`
2. Open `.dev/playground/apps/web/src/pages/index.astro`.
   - [ ] The page contains no waitlist import and no waitlist tag. The applier did not edit it.
3. Open `.dev/playground/.agents/skills/saasaloy-waitlist/SKILL.md` and find the "Wire-up" section.
   - [ ] The section names the file to edit, the import line, the `<WaitlistForm client:load />` tag, and the anchor after `<Cta />` marked as a suggestion

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The wired-up block renders after the CTA  ·  🔴 Critical

**Goal.** The two wire-up lines from the skill put the form on the page where you chose.

**Steps**

1. Do the wire-up in `.dev/playground/apps/web/src/pages/index.astro`. Add the import beside the other block imports, and the tag inside `<main>` after `<Cta siteName={siteName} />`:

   ```astro
   import WaitlistForm from "@web/components/WaitlistForm";
   ```

   ```astro
   <WaitlistForm client:load />
   ```

2. Start both dev servers in separate terminals — api on `:4000`, web on `:3000`:

```sh
cd .dev/playground && pnpm --filter @repo/api dev
```

```sh
cd .dev/playground && pnpm --filter web dev
```

3. Open `http://localhost:3000/` and scroll to below the CTA panel.
   - [ ] A "Get early access" panel with an email input and a "Join the waitlist" button appears after the CTA
   - [ ] The browser console shows no unresolved import for `@web/components/WaitlistForm` or `@repo/ui/blocks/waitlist`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The form submits end to end and a row lands in D1  ·  🔴 Critical

**Goal.** The block's injected `onSubmit` reaches the api across origins and the row persists.

**Steps**

1. Enter `alice@example.com` and click **Join the waitlist**.
   - [ ] The form swaps to "You're on the list — we'll be in touch."
   - [ ] The Network tab shows `POST http://localhost:4000/waitlist` succeeding (`201`), with no CORS error
2. Confirm the row landed:

   ```sh
   cd .dev/playground/apps/api && node_modules/.bin/wrangler d1 execute DB --local --config wrangler.jsonc --persist-to .wrangler/state --command "SELECT id, email, created_at FROM waitlist;"
   ```

   - [ ] Exactly one `alice@example.com` row, with a populated `created_at`
3. Reload `/` and submit `alice@example.com` again. Re-run the query.
   - [ ] The form shows the same success message, and the table still holds exactly one row

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: Bad input and a dead api fail with clear messages  ·  🟡 Normal

**Goal.** Failures show a readable message and write no row.

**Steps**

1. Enter `not-an-email` and try to submit. Then re-run the D1 query from TC-1.3.
   - [ ] The browser's native validation blocks the submit, and no new row appears
2. Send a malformed value straight at the api:

   ```sh
   curl -s -w '\n%{http_code}\n' -X POST http://localhost:4000/waitlist -H 'Content-Type: application/json' -d '{"email":"not-an-email"}'
   ```

   - [ ] The response is `400` with an `error` envelope carrying a readable message
3. Stop the api dev server (Ctrl-C in its terminal). Submit `bob@example.com` from the form.
   - [ ] The form shows "Something went wrong — try again." and does not hang on "Joining…"
4. Restart the api server for the next case.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.5: The block reads well in both themes and by keyboard  ·  🟢 Low

**Goal.** The two-column block sits well beside the CTA's muted panel, in both themes, for keyboard users.

**Steps**

1. In light mode, look at the CTA and the waitlist block together at ≥1280px, then at a narrow width.
   - [ ] The pair does not read as two identical centred panels, and the narrow layout stacks cleanly
2. Toggle to dark mode.
   - [ ] The same look is clean in dark, with every label and button legible
3. Tab to the email input, type `carol@example.com`, Tab to the button, press Enter.
   - [ ] The form submits by keyboard alone, and the success message replaces the form

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Scenario 2: waitlist removed again

**Setup.** Run after Scenario 1, in the same playground, with the wire-up lines still in `index.astro`. Keep the web dev server running.

- [ ] Setup complete

### TC-2.1: Remove deletes the files and names the leftover wire-up  ·  🔴 Critical

**Goal.** `remove` undoes the files it wrote and says plainly that your page edit stays yours.

**Steps**

1. Remove the module:

```sh
cd .dev/playground && ./saasaloy remove waitlist --yes
```

   - [ ] The output shows a "Wire-up left behind" box: the block file is deleted, and the text says the hand-added wire-up is not reversed
2. Reload `http://localhost:3000/` (or watch the web dev terminal).
   - [ ] The build fails loudly on the dangling `WaitlistForm` import — no silent half-render
3. Take the import and the tag back out of `index.astro`. Reload `/`.
   - [ ] The base landing page renders whole again, hero to footer

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; the throwaway project lived in the agent's temp directory, not `.dev/playground`, and was deleted afterward):

```sh
pnpm --filter saasaloy build
```

```sh
node packages/cli/dist/index.js init qa-throwaway --force --no-install
```

```sh
SAASALOY_REGISTRY_DIR=<repo>/modules node packages/cli/dist/index.js add database-d1 --yes && SAASALOY_REGISTRY_DIR=<repo>/modules node packages/cli/dist/index.js add waitlist --yes
```

```sh
SAASALOY_REGISTRY_DIR=<repo>/modules node packages/cli/dist/index.js remove waitlist --yes
```

- ✅ `pnpm --filter saasaloy build` → CLI rebuilt clean with the review fixes (`dist/index.js`, 178 KB).
- ✅ `add waitlist --yes` → the Next-steps box prints "Manual wire-up needed — packages/ui/src/blocks/waitlist.tsx is on disk but on no page yet. In Claude Code, run /saasaloy-waitlist and follow its Wire-up section." Both `packages/ui/src/blocks/waitlist.tsx` and `apps/web/src/components/WaitlistForm.tsx` landed on disk. `index.astro` contains zero waitlist references — the applier edited no page.
- ✅ `remove waitlist --yes` → prints the "Wire-up left behind" box ("The wire-up you added by hand is not reversed … Take the import and its tag out yourself, or the build fails."), and the block file is gone from disk afterward.
- ✅ CLI test suite (earlier this session, tree unchanged since) → `pnpm vitest run` in `packages/cli`: 33 files, 652 tests, all passed. Covers the pointer text, the no-skill warning, the `@ui/blocks/` prefix filter, and remove's caveat.
- ✅ `pnpm lint` (earlier this session, doc-only edits since) → all four passes green.

## Not covered / needs human judgment
- **Browser rendering, hydration, and placement** (TC-1.2, TC-1.5) — whether the island mounts and the block sits well after the CTA is a visual call.
- **The live HTTP round-trip and CORS** (TC-1.3, TC-1.4) — needs both dev servers and a real cross-origin browser request (`:3000` → `:4000`).
- **The no-skill warning path** — covered by unit tests against a synthetic module; no real registry module ships a block without a skill, so there is nothing to drive by hand.
- **`pnpm deps:verify`** — the full scaffold-install-build-typecheck chain was not run here (expensive); the issue lists it as a merge gate, run it before the PR merges.
- **Concurrency and performance** — a single-form waitlist has no meaningful load or race surface; skipped on purpose.
- **Production `PUBLIC_API_URL`** — dev uses the localhost fallback; the deployed value stays doc-only, as before.

## Overall result
_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
