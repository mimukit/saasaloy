# QA Plan: landing copy interview skill and workflow

_Generated 2026-08-08 · against `207e91e` · covers `issue-61-landing-copy-interview-skill-and-workflow` vs `main` (8 commits, issue #61)_

## Summary

- The base template's landing copy moved out of the eight blocks and into one file,
  `packages/ui/src/content/landing.ts`, split into `landing.*` (marketing copy — the whole
  surface a rewrite touches) and `ui.*` (chrome and a11y labels — never rewritten). Blocks
  import it directly, `interpolate()` fills `{siteName}`-style placeholders in place of
  template literals, and `scripts/verify-content.ts` (`pnpm verify:content`) fails if a
  user-visible string is written back into a block. On top of that sits the point of the
  issue: `templates/base/_agents/skills/saasaloy-landing-copy/SKILL.md`, an interview-first
  skill that `saasaloy init` now symlinks into `.claude/skills/` so it is discoverable the
  moment scaffolding finishes.
- "Working" means: a real person can be interviewed by the skill twice — once cold, once
  against the brief it left behind — and get a landing page that **builds** and says true
  things about their product, written **only** into the five files the skill declares; and
  the shipped demo page renders exactly as it did before the refactor.

**Split of work in this document.** Everything decidable from source or from the artifacts
already on disk — the rendered page being unchanged, the hydration-island count, the copy
being bundled once, `interpolate`'s edge cases, the `verify:content` scanner in both
directions, the `init` symlink and its gitignore treatment, the skill's structural claims
about itself — the agent already ran; see
[Automated verification](#automated-verification-by-ai-agent).

What is left is what an unattended run **cannot** discharge. Acceptance criterion 13 asks
for two live end-to-end runs of the interview skill, and an interview needs a respondent.
That is [Scenario 1](#scenario-1--fresh-scaffold-no-brief-on-disk-the-ac-13-runs) and it is
the reason this plan exists. Everything after it is smaller: the adversarial respondent, the
blank-label mechanism, the occupied-link path, and the two gates that only a human should be
allowed to run because they destroy the playground.

## Overall result

_Tick one when you finish the run._

- [ ] Pass — every case passed
- [ ] Fail — at least one case failed
- [ ] Partial — cases were skipped or not reached

## Environment

True for the whole plan — do this once, before Scenario 1.

- Branch under test: `issue-61-landing-copy-interview-skill-and-workflow`, commit `207e91e`.
- Every command is run from the worktree root. Paths are relative to it.
- Node 24+ and pnpm 11, per the repo's toolchain.
- **You need Claude Code (or another agent that reads `.claude/skills/`)**, because Scenarios
  1 and 2 are the skill talking to you. Open it with `.dev/playground` as its working
  directory, not the repo root — the skill's write surface is expressed in
  scaffolded-project paths (`packages/ui/src/content/landing.ts`), and pointed at the repo
  root those paths do not exist.
- **You need a browser for TC-1.2, TC-1.7 and TC-3.1.** The repo's dev box is headless.
  Either run the plan on a machine with a browser, or forward the preview port over Tailscale
  and add `--host` to the serve command.
- **You need to be able to answer as a product owner.** Bring a real product, or invent one
  and stay consistent — the skill's whole value is that it uses *your* nouns, and you cannot
  judge that against answers you made up sentence by sentence. A worked fictional example is
  supplied in TC-1.3 if you would rather not improvise.

**The state of `.dev/playground` as handed to you.** It is a fresh post-`play:init` scaffold
with a matching build in `apps/web/dist`: `siteName` is `"playground"`, `Layout.astro` has
`lang="en"`, there is no `docs/` directory, the content module is byte-identical to the
template's, and `.claude/skills/saasaloy-landing-copy` is a working symlink. Every scenario
below re-creates that state anyway, so you can start anywhere.

Reset it with:

```sh
pnpm play:reset
```

`play:reset` is `play:destroy && play:init` — it **deletes** `.dev/playground` and
re-scaffolds it from the template. Anything you put there by hand is gone. That is by
design; `.dev` is scratch.

Serve the built site (static output, so `preview` is enough):

```sh
pnpm -C .dev/playground/apps/web preview
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|---|---|---|---|
| TC-1.1 | 1 — Fresh scaffold, no brief on disk | `init` links the skill into `.claude/skills` and advertises it | 🔴 Critical |
| TC-1.2 | 1 — Fresh scaffold, no brief on disk | The shipped demo page still renders as it did before the refactor | 🔴 Critical |
| TC-1.3 | 1 — Fresh scaffold, no brief on disk | **Run 1 — the interview, live, end to end** | 🔴 Critical |
| TC-1.4 | 1 — Fresh scaffold, no brief on disk | Run 1 touched the write surface and nothing else | 🔴 Critical |
| TC-1.5 | 1 — Fresh scaffold, no brief on disk | The copy clears the anti-AI-writing bar | 🟡 Normal |
| TC-1.6 | 1 — Fresh scaffold, no brief on disk | **Run 2 — the re-run reads the brief first and diffs every write** | 🔴 Critical |
| TC-1.7 | 1 — Fresh scaffold, no brief on disk | The rewritten page in a browser, at the owner's real copy length | 🟡 Normal |
| TC-2.1 | 2 — Fresh scaffold, adversarial respondent | Two follow-ups, then `weak:` verbatim and copy that declines the claim | 🔴 Critical |
| TC-2.2 | 2 — Fresh scaffold, adversarial respondent | "No pricing yet" — dropping a block is its own confirmation | 🔴 Critical |
| TC-2.3 | 2 — Fresh scaffold, adversarial respondent | The boundaries hold when you ask the skill to cross them | 🟡 Normal |
| TC-3.1 | 3 — Scaffold with hand-blanked labels | A blank label drops its link; a group with no links disappears | 🔴 Critical |
| TC-3.2 | 3 — Scaffold with hand-blanked labels | The skill notices hand-written copy and asks before overwriting | 🟡 Normal |
| TC-4.1 | 4 — `.claude/skills/<name>` already occupied | `init` warns, leaves the directory intact, and still exits 0 | 🔴 Critical |
| TC-4.2 | 4 — `.claude/skills/<name>` already occupied | A deleted link is re-created by the next `init` | 🟢 Low |
| TC-5.1 | 5 — The repo's own template, no playground | `verify:content` fails on a prose literal put back into a block | 🟡 Normal |
| TC-5.2 | 5 — The repo's own template, no playground | The three content interfaces really require an `id` | 🟡 Normal |

## Scenario 1 — Fresh scaffold, no brief on disk (the AC 13 runs)

The headline. A project owner has just scaffolded, the page still says "Acme" and "The SaaS
you meant to build", and there is no `docs/product-brief.md`. This is the state acceptance
criterion 13 names, and the two interview runs it asks for are TC-1.3 and TC-1.6.

Run the cases **in order** — TC-1.6 needs the brief TC-1.3 writes.

**Setup** — once, for every case in this scenario.

1. Reset and re-scaffold the playground. **Keep this terminal output** — TC-1.1 reads it.

   ```sh
   pnpm play:reset
   ```

   - [ ] The command exits 0

2. Install and build it, so you have a page to look at before anything is rewritten.

   ```sh
   pnpm -C .dev/playground install && pnpm -C .dev/playground build
   ```

   - [ ] Both exit 0

3. Confirm you are starting cold — no brief, demo copy on disk.

   ```sh
   ls .dev/playground/docs 2>&1; grep -n 'siteName = ' .dev/playground/packages/ui/src/index.ts
   ```

   - [ ] `ls` reports that `.dev/playground/docs` does not exist
   - [ ] `siteName` is `"playground"`

4. Open Claude Code with `.dev/playground` as its working directory.

- [ ] Setup complete

### TC-1.1 — `init` links the skill into `.claude/skills` and advertises it  ·  🔴 Critical

**Goal** — acceptance criterion 6's happy path: a fresh scaffold ships the skill's real
files in `.agents/skills/`, links them where Claude Code looks, keeps the link out of git,
and tells the owner the skill exists without making them read `AGENTS.md`.

**Steps**

1. Read the `pnpm play:reset` output from the setup above.
   - [ ] A boxed **`Skill links`** note appears, listing
         `.claude/skills/saasaloy-landing-copy → .agents/skills/saasaloy-landing-copy`
   - [ ] It carries the line "Symlinked for Claude Code — the skill files live in
         `.agents/skills/`"
   - [ ] No warning about a skill link appears anywhere in the output
2. Read the **`Next steps`** note at the end of the same output.
   - [ ] It contains a `/saasaloy-landing-copy` line with the comment `# in Claude Code`
   - [ ] That line's comment is aligned in the same column as `pnpm dev`'s comment above it

3. Confirm the link is a symlink pointing at the real directory.

   ```sh
   ls -l .dev/playground/.claude/skills/ && ls .dev/playground/.agents/skills/saasaloy-landing-copy/
   ```

   - [ ] `saasaloy-landing-copy` is shown as a link to `../../.agents/skills/saasaloy-landing-copy`
   - [ ] The real directory contains `SKILL.md`

4. Confirm git's treatment of the two paths — the link is per-machine, the files are not.

   ```sh
   git -C .dev/playground check-ignore -v .claude/skills/saasaloy-landing-copy; git -C .dev/playground status --short --untracked-files=all -- .agents .claude
   ```

   - [ ] `check-ignore` reports `.gitignore:26:.claude/skills/` — the link is ignored
   - [ ] `status` lists `?? .agents/skills/saasaloy-landing-copy/SKILL.md` — the real file
         would be committed
   - [ ] `status` lists **nothing** under `.claude/`
5. Confirm the agent can actually see it. In Claude Code, from `.dev/playground`, type `/`
   and look at the skill list.
   - [ ] `saasaloy-landing-copy` appears, with its description
   - [ ] Its description mentions the interview and the content module — not a markdown draft

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.2 — The shipped demo page still renders as it did before the refactor  ·  🔴 Critical

**Goal** — acceptance criterion 1's second half, judged by eye: moving every word out of
eight blocks and into one file changed nothing a visitor sees, apart from one documented
artifact in the footer.

The agent already proved the *text* is byte-identical (see
[Automated verification](#automated-verification-by-ai-agent), check 1). This case is the
part it cannot do: confirming the page still **looks** right, and that the one HTML-level
change did not become a visible spacing bug.

**Steps**

1. Serve the build from the setup.

   ```sh
   pnpm -C .dev/playground/apps/web preview
   ```

2. Open the printed URL and scroll the whole page at desktop width (≥1280px).
   - [ ] navbar — site name, three links (Features / Pricing / FAQ) and the "Get started"
         button all present and correctly spaced
   - [ ] hero — the eyebrow badge, the headline, the sub-copy naming `playground`, and both
         buttons
   - [ ] feature-grid — six cards, **each with its own icon** (this is the case the icon-by-id
         map can break: a card showing a generic sparkle instead of its own icon is a failure)
   - [ ] pricing-table — three tiers, the Monthly/Annual toggle, the "Save 20%" badge, the
         "Most popular" badge on Pro, and `Custom` on Enterprise
   - [ ] faq — five rows, each expanding and collapsing
   - [ ] cta — the closing band, naming `playground`
   - [ ] footer — the tagline, a **Product** group of three links, a **Legal** group of two
3. Zoom in on the footer's copyright line. This is the one place the HTML changed: it used
   to be three React text children and is now a single interpolated string.
   - [ ] It reads exactly `© 2026 playground. All rights reserved.`
   - [ ] There is exactly one space between `©` and `2026`, between `2026` and `playground`
   - [ ] No doubled space, and no missing space, anywhere in that line
4. Switch the pricing toggle to **Annual**.
   - [ ] Prices change to 0 / 23 / Custom
   - [ ] The suffix reads `/month, billed annually` — one phrase, not `/month` with something
         bolted on the end
5. Switch back to **Monthly**.
   - [ ] The suffix reads `/month`
6. Narrow the window to 375px and open the mobile menu.
   - [ ] The hamburger opens a panel with the same three links
   - [ ] Its accessible name changes between `Open menu` and `Close menu` as it toggles
         (DevTools → the `<button>`'s `aria-label`)
7. Visit `/terms` and `/privacy`.
   - [ ] Both render fully, unchanged — neither reads its copy from the content module and
         neither should have moved

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.3 — Run 1 — the interview, live, end to end  ·  🔴 Critical

**Goal** — acceptance criterion 13, first run, and criteria 7–12 with it: a cold interview
of a real respondent produces true copy in the content module, a brief on disk, and a green
build — with nothing invented along the way.

**This is the case the whole plan exists for.** Budget 20–30 minutes and answer as yourself.

If you would rather not improvise, use this fictional product and stay consistent with it:

> **Ledgerly.** Bookkeepers at accounting firms carrying 5–20 client accounts. Month-end
> close runs across four spreadsheets per client and a broken formula is only found when a
> client queries the invoice. Today they use Excel plus a shared Dropbox folder. Ledgerly
> keeps every client's ledger in one place with a close checklist per client. Proof: two
> named firms in beta, Rahman & Co and Hasan Associates, both agreed to be named. Tone:
> plain and unexcited, like basecamp.com. Language: Bangla (`bn`). Pricing: Solo ৳900/month,
> Firm ৳3,500/month, no annual discount yet.

**Steps**

1. In Claude Code, from `.dev/playground`, invoke the skill.

   ```sh
   /saasaloy-landing-copy
   ```

   - [ ] It starts by **asking**, not by writing — no file is edited before you have answered
         anything
   - [ ] It does not announce that it read an existing brief (there is none)
   - [ ] It says something about the tree being uncommitted or not a repo, in **one
         sentence**, and then carries on — it must not refuse to run over a dirty tree
2. Watch the shape of the questions.
   - [ ] Questions arrive in **small batches of two or three**, not all seven at once and not
         one at a time
   - [ ] The questions are numbered, so you can answer by number
   - [ ] Over the whole interview it covers all seven dimensions: **audience, problem,
         current alternative, differentiator, proof, tone, language**
   - [ ] Tone is asked for as an adjective **and** a site that gets it right
   - [ ] Language is asked for as a name **and** a code
3. Answer the audience question deliberately vaguely once — say "small businesses" — then
   answer the follow-up specifically.
   - [ ] It pushes back with a **narrower** question than the first, not a repeat
   - [ ] Once you give a specific answer it stops pushing and moves on
4. Answer the pricing questions with your real (or the fictional) numbers.
   - [ ] It asks per tier for the name, who it is for, the monthly price, and the annual price
   - [ ] It does **not** propose numbers of its own, and does not offer the shipped
         $0/$29/Custom as a starting point to edit
   - [ ] With a non-USD currency, it asks about or states `currencySymbol`
   - [ ] With no annual discount, it says it will set `annualPrice` equal to `monthlyPrice`
         and blank `annualNote` — rather than inventing a discount to keep "Save 20%" true
5. Let it write the brief.
   - [ ] It writes `docs/product-brief.md` **before** it writes any copy
   - [ ] The brief has a `Last updated: 2026-08-08 (saasaloy-landing-copy)` line
   - [ ] It has a section per dimension, plus **Pricing** and **Known gaps**
   - [ ] Your own words are in there — it is a record of the interview, not a summary in the
         agent's voice
   - [ ] For a non-English language, **Known gaps** records that the template loads no
         webfont and `font-sans` is the system stack
6. Read the diff it shows you before it writes the content module.
   - [ ] It shows the changes **key by key**, old value then new
   - [ ] It asks **once per file**, not once per key, and not one blanket yes for all files
   - [ ] Answer "no" to the first file it offers and confirm it does **not** write it, then
         ask it to proceed
7. Let it write, then read what it produced.

   ```sh
   grep -n 'siteName = ' .dev/playground/packages/ui/src/index.ts && grep -n 'html lang' .dev/playground/apps/web/src/layouts/Layout.astro
   ```

   - [ ] `siteName` is your brand, set in `packages/ui/src/index.ts` — **not** in the content
         module
   - [ ] For a non-English language, `<html lang="…">` carries the code you gave; for English
         it is still `en`
8. Check the copy against the mechanical rules the code depends on.

   ```sh
   grep -nE '\{[a-zA-Z]+\}|`' .dev/playground/packages/ui/src/content/landing.ts | grep -v '^\s*[0-9]*: *//'
   ```

   - [ ] The only `{token}` used anywhere is `{siteName}` (plus `{year}`/`{currencySymbol}`/
         `{price}` which were already in `ui.*` and are not the skill's to touch)
   - [ ] `{siteName}` appears only in `meta.title`, `meta.description`, `hero.description`
         and `cta.description` — anywhere else it renders as literal text
   - [ ] **No template literal** (backtick) was introduced into `landing.*`
   - [ ] The six feature `id`s are still `fast`, `modules`, `source`, `secure`, `cloudflare`,
         `current` — the words changed under them
   - [ ] Every `faq.items[]` and `pricing.tiers[]` entry still has an `id`
   - [ ] Every `ctaHref` is still `#cta`
   - [ ] The whole `ui` export is **untouched** — still `Monthly`, `Most popular`,
         `Close menu`, `Billing period`, in English
9. Let it prove the build.

   ```sh
   pnpm -C .dev/playground typecheck && pnpm -C .dev/playground build
   ```

   - [ ] Both exit 0
   - [ ] The skill ran these itself and reported the result — it did not hand back an
         unverified tree
10. Serve it and look at the page.

    ```sh
    pnpm -C .dev/playground/apps/web preview
    ```

    - [ ] Every visible string on the page is your product's, not the demo's
    - [ ] The word "Acme" appears nowhere
    - [ ] The chrome is still in English (`Monthly`, `Annual`, `Most popular`)
11. Read its closing message.
    - [ ] It points you at `pnpm dev`
    - [ ] It names the two or three lines it is **least** sure about — not a claim that
          everything is great

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.4 — Run 1 touched the write surface and nothing else  ·  🔴 Critical

**Goal** — acceptance criterion 10 and the skill's own boundary list, audited mechanically
after the fact: the interview may write exactly five files, and it wrote no others.

`pnpm play:init` runs `git init` in the playground with **no commit**, so there is no `HEAD`
to diff against. `git status --untracked-files=all` on an all-untracked tree is useless. Use
the template as the reference instead — that is what the scaffold was copied from.

**Steps**

1. Diff the whole scaffold against the template it came from. `siteName` differs by design
   (`init` substitutes `{{PROJECT_NAME}}`), and so does the `_`-prefixed file naming, so read
   the list rather than expecting silence.

   ```sh
   diff -rq --exclude=node_modules --exclude=dist --exclude=.astro --exclude=.git --exclude=.claude --exclude=.turbo --exclude='*.tsbuildinfo' --exclude=saasaloy --exclude=pnpm-lock.yaml packages/cli/templates/base .dev/playground
   ```

   - [ ] `packages/ui/src/content/landing.ts` differs
   - [ ] `packages/ui/src/index.ts` differs
   - [ ] `apps/web/src/layouts/Layout.astro` differs **only if** your language was not English
   - [ ] `docs/product-brief.md` is reported as "Only in .dev/playground"
   - [ ] `apps/web/src/pages/index.astro` does **not** differ (you did not consent to a block
         removal in TC-1.3)
   - [ ] **No file under `packages/ui/src/blocks/` differs** — not one
   - [ ] `packages/ui/src/styles/globals.css` does not differ
   - [ ] `packages/ui/components.json` does not differ
   - [ ] Nothing under `packages/ui/src/components/` differs
   - [ ] `apps/web/src/pages/terms.astro` and `privacy.astro` do not differ
   - [ ] `packages/ui/package.json`, the root `package.json` and `pnpm-workspace.yaml` do not
         differ — no dependency, no i18n library, no webfont was added
   - [ ] The only other entries are the expected scaffolding differences (`_gitignore` →
         `.gitignore`, `_agents` → `.agents`, `{{PROJECT_NAME}}` substitutions)
2. Confirm no image or asset was produced.

   ```sh
   find .dev/playground/apps/web/public .dev/playground/apps/web/src -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.svg' -o -name '*.webp' \) 2>/dev/null
   ```

   - [ ] No output beyond whatever the template already shipped (compare with
         `find packages/cli/templates/base/apps/web -type f -name '*.svg'`)
3. Confirm the `lang` edit, if any, was surgical.

   ```sh
   diff packages/cli/templates/base/apps/web/src/layouts/Layout.astro .dev/playground/apps/web/src/layouts/Layout.astro
   ```

   - [ ] Either no output, or a single changed line whose only difference is the `lang`
         attribute value

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.5 — The copy clears the anti-AI-writing bar  ·  🟡 Normal

**Goal** — acceptance criterion 11: the copy reads as though a person who knows the product
wrote it, which is the one thing in this plan no script can score.

Read `.dev/playground/packages/ui/src/content/landing.ts` top to bottom, then judge. Each box
below is a **failure** the skill's own list names — tick it only when the copy is clean of it.

**Steps**

1. Read the whole `landing` export as prose, out loud if you can.
   - [ ] No abstract benefit noun as a subject — "solutions", "experiences", "workflows",
         "innovation", "efficiency"
   - [ ] None of the AI vocabulary — leverage, unlock, empower, seamless, robust, streamline,
         elevate, cutting-edge, game-changing, effortless, revolutionary, harness, delve
   - [ ] No rule-of-three cadence ("Faster, simpler, smarter") anywhere
   - [ ] No "not just X — it's Y", "more than just", "isn't only about"
   - [ ] No claim whose opposite would be absurd ("Built for modern teams")
   - [ ] No superlative without a number behind it — "blazing fast", "enterprise-grade",
         "world-class", "industry-leading"
   - [ ] At most one em-dash per section
   - [ ] Sentence lengths vary; at least one lands short
   - [ ] No second-person promise the product cannot keep
2. Hunt specifically for invented proof. This is the failure that matters most.
   - [ ] Every statistic, customer name, logo, award and rating in the copy came out of your
         interview — there is **not one** you did not supply
   - [ ] No "trusted by thousands" or equivalent
   - [ ] The prices are exactly the numbers you gave: not rounded, not converted, not
         "typical"
3. Look for the two habits that prove the interview happened rather than being skipped.
   - [ ] Your own nouns from the interview appear in the copy
   - [ ] The current alternative you named is addressed somewhere on the page
   - [ ] At least one sentence is one a generic generator could not have produced, because it
         needed a fact only you had
4. Check length against the layout.
   - [ ] `meta.title` is under 60 characters
   - [ ] `meta.description` is under 155 characters
   - [ ] `hero.title` is under ten words and carries one idea
   - [ ] Feature titles are 2–4 words; each description is one sentence about what you can
         *do*
   - [ ] FAQ answers are one to three sentences and actually answer the question
   - [ ] Nothing is roughly double the length of the demo copy it replaced

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.6 — Run 2 — the re-run reads the brief first and diffs every write  ·  🔴 Critical

**Goal** — acceptance criterion 12 and the second half of criterion 13: a second run does
**not** re-interview from scratch, it picks up the brief, chases the `weak:` threads, and
notices copy that changed underneath it.

Run this immediately after TC-1.3, on the same playground, without resetting.

**Steps**

1. First, plant a hand edit so the "someone edited this by hand" branch has something to
   find. Change one FAQ answer in
   `.dev/playground/packages/ui/src/content/landing.ts` by hand — a visibly different
   sentence, same `id`.
   - [ ] Saved
2. Invoke the skill a second time.

   ```sh
   /saasaloy-landing-copy
   ```

   - [ ] It reads `docs/product-brief.md` **before** asking anything
   - [ ] It summarises the brief back to you in a few lines and asks what changed
   - [ ] It does **not** re-run the seven-dimension interview from the start
3. Watch which questions it does ask.
   - [ ] It asks about every `weak:` tag in the brief, by name ("Last time '…' had no number
         behind it. Do you have one now?")
   - [ ] It asks about nothing else unless you said it moved
4. Answer that one thing changed — give a real number for one of the weak dimensions, or a
   new price for one tier — and leave everything else alone.
   - [ ] It proposes rewriting only the sections that moved
   - [ ] It does **not** propose rewriting the whole page
5. Watch it handle the FAQ answer you edited by hand in step 1.
   - [ ] It notices the copy on disk differs from what the brief would produce
   - [ ] It **says so**, shows you the difference, and asks which version wins
   - [ ] Answer "keep mine" and confirm your sentence survives the write
6. Let it write, then check the brief.
   - [ ] `Last updated` is bumped
   - [ ] The `weak:` tag you resolved is replaced by the real answer
   - [ ] Every `weak:` tag you did **not** resolve is still there, verbatim
   - [ ] The sections you did not touch are unchanged
7. Prove the tree is still green.

   ```sh
   pnpm -C .dev/playground typecheck && pnpm -C .dev/playground build
   ```

   - [ ] Both exit 0
8. Re-run the write-surface audit from TC-1.4 step 1.
   - [ ] Still no file under `packages/ui/src/blocks/` differs from the template
   - [ ] Still no new file outside the five-file write surface

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.7 — The rewritten page in a browser, at the owner's real copy length  ·  🟡 Normal

**Goal** — the layout was built around the demo copy's length, and real copy is the first
thing that tests that claim.

**Steps**

1. Serve the post-run-2 build.

   ```sh
   pnpm -C .dev/playground/apps/web preview
   ```

2. Scroll the whole page at 1280px.
   - [ ] No headline or feature title wraps in a way that breaks its card or leaves a widow
   - [ ] No card in the feature grid is visibly taller than its neighbours because one
         description ran long
   - [ ] Pricing tier bullets fit their cards
   - [ ] Nothing overflows horizontally
3. Narrow to 375px and scroll again.
   - [ ] Same — nothing overflows, nothing is clipped
   - [ ] The pricing prices and their `/month` suffix stay on sensible lines
4. If your language was not English, look at the script.
   - [ ] The non-Latin text renders in *some* readable font (the system stack — the template
         ships no webfont, and this is the documented gap, not a bug)
   - [ ] Line-height does not clip ascenders or descenders
   - [ ] The English chrome (`Monthly`, `Most popular`) sitting beside non-English copy looks
         like an obvious untranslated gap rather than a rendering fault — note how bad it
         looks; that is issue #73's job, not this one's
5. Toggle light and dark.
   - [ ] Both palettes still read correctly with the new copy

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — before Scenario 2, re-scaffold. Save the brief first if you want to keep it as
evidence of the run.

```sh
cp .dev/playground/docs/product-brief.md /tmp/product-brief-run1.md && pnpm play:reset
```

## Scenario 2 — Fresh scaffold, adversarial respondent (no brief)

The same starting state as Scenario 1, with a different person in the chair: someone whose
answers are thin and who has no pricing yet. This is where the skill either declines a claim
or invents support for it, and the second outcome is the one that makes the whole feature
worse than doing nothing.

**Setup** — once, for every case in this scenario.

1. Re-scaffold and install.

   ```sh
   pnpm play:reset && pnpm -C .dev/playground install
   ```

   - [ ] Both exit 0
   - [ ] `.dev/playground/docs` does not exist

2. Open Claude Code with `.dev/playground` as its working directory.

- [ ] Setup complete

### TC-2.1 — Two follow-ups, then `weak:` verbatim and copy that declines the claim  ·  🔴 Critical

**Goal** — acceptance criteria 8 and 9: the pushback has a hard ceiling of two follow-ups per
dimension, and a dimension that stays thin produces *less* copy rather than invented copy.

**Steps**

1. Invoke the skill and answer the differentiator question with "it's faster". Hold that
   line: when it pushes back, say "just generally faster". When it pushes back again, say
   "I don't have a number".

   ```sh
   /saasaloy-landing-copy
   ```

   - [ ] It pushes back exactly **twice** on that dimension — a third follow-up is a failure
   - [ ] Each follow-up is narrower than the one before it, not a rephrase
   - [ ] After the second, it stops asking and moves on
2. Answer the proof question with "people seem to like it" and hold that too.
   - [ ] Two follow-ups, then it stops
3. Answer audience and problem specifically, so only two dimensions are weak.
   - [ ] It does not push back at all on the dimensions you answered well — two follow-ups is
         a ceiling, not a quota
4. Watch what it tells you about the cost.
   - [ ] It says plainly which dimensions it recorded as weak
   - [ ] It says what that cost the page — which claim the copy will now *not* make
   - [ ] It offers the trade back ("give me a benchmark later and that headline gets
         stronger")
5. Read the brief it writes.

   ```sh
   cat .dev/playground/docs/product-brief.md
   ```

   - [ ] The **Differentiator** section carries a `weak:` tag
   - [ ] Your words `it's faster` are recorded **verbatim** inside it, not paraphrased
   - [ ] The **Proof** section carries a `weak:` tag too
   - [ ] Each tag says what was asked and that it was asked twice
6. Read the copy it wrote.
   - [ ] The page makes **no** speed claim anywhere — not in the hero, not in a feature, not
         in the CTA
   - [ ] The page carries **no** statistic, customer name, logo, rating or "trusted by"
   - [ ] The hero describes what the product *does* instead of claiming an advantage
   - [ ] The copy is noticeably shorter or plainer than TC-1.3's, rather than the same length
         with vaguer sentences
7. Confirm it still finished the job.

   ```sh
   pnpm -C .dev/playground typecheck && pnpm -C .dev/playground build
   ```

   - [ ] Both exit 0 — a thin interview produces less copy, never a red tree and never a
         refusal to run

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.2 — "No pricing yet" — dropping a block is its own confirmation  ·  🔴 Critical

**Goal** — the pricing rule's third branch and the block-removal rule together: the skill may
offer to remove a block, must ask for that separately, and must take the nav entries with it
by blanking labels rather than editing a block.

Run this in the same session as TC-2.1, at the pricing questions.

**Steps**

1. When it asks about pricing, say "we don't have pricing yet".
   - [ ] It offers **three** paths, not one: real prices, leave the shipped tiers as an
         explicit placeholder, or drop the pricing block
   - [ ] It does **not** silently keep the $0/$29/Custom tiers as if they were yours
2. Ask what "leave it as a placeholder" would mean, then choose to **drop the block**.
   - [ ] The removal is asked as its **own** confirmation — separate from the copy write, not
         bundled into it
   - [ ] It tells you it is two edits: one line out of `index.astro`, plus blanking the
         matching labels in content
3. Confirm the removal and let it write.

   ```sh
   diff packages/cli/templates/base/apps/web/src/pages/index.astro .dev/playground/apps/web/src/pages/index.astro
   ```

   - [ ] Exactly one line is removed: the `<PricingTable client:visible />` line
   - [ ] The `import.meta.glob("../sections/*.astro")` block is **still there** (it is issue
         #62's, not this skill's)
   - [ ] The `PricingTable` import may be removed with it; nothing else changed
4. Check the labels.

   ```sh
   grep -n 'linkPricing' .dev/playground/packages/ui/src/content/landing.ts
   ```

   - [ ] `landing.navbar.linkPricing` is `""`
   - [ ] `landing.footer.linkPricing` is `""`
5. Confirm no block was edited to achieve any of this.

   ```sh
   diff -rq packages/cli/templates/base/packages/ui/src/blocks .dev/playground/packages/ui/src/blocks
   ```

   - [ ] No output — `pricing-table.tsx` is still on disk, untouched, just not rendered
6. Build and look at the page.

   ```sh
   pnpm -C .dev/playground build && pnpm -C .dev/playground/apps/web preview
   ```

   - [ ] The pricing section is gone from the page
   - [ ] The navbar has two links, not three — no "Pricing"
   - [ ] The footer's Product group has two links — no "Pricing"
   - [ ] No visible gap or empty band where the section used to be
7. Now check the loose end the skill's instructions do **not** mention. The hero's secondary
   action is `{ label: landing.hero.secondaryActionLabel, href: "#pricing" }` — the `href`
   lives in `hero.tsx` and is not gated by a label.
   - [ ] Look at the hero's second button and click it. Note in **Notes** whether it points
         at a section that no longer exists
   - [ ] If it does, that is a real gap in the removal recipe, not a build failure — record it
         rather than fixing it here

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.3 — The boundaries hold when you ask the skill to cross them  ·  🟡 Normal

**Goal** — the "Boundaries to honor" section is behaviour, not decoration: an owner asking
for something outside the write surface gets a clear no and a pointer, not a helpful edit.

Same session. Ask for each of these in turn.

**Steps**

1. "The hero heading should be bigger and blue."
   - [ ] It declines to edit `hero.tsx` or `globals.css`
   - [ ] It tells you where that change would go and leaves the decision to you
2. "Translate `Monthly` and `Most popular` too."
   - [ ] It declines to touch `ui.*`
   - [ ] It explains that chrome is a translation-layer job, and names the gap
3. "Put our logo in the navbar."
   - [ ] It declines — no image generated, sourced or referenced
4. "Add a proper i18n library so we can have both languages."
   - [ ] It declines to add a dependency
   - [ ] It reports the gap rather than closing it
5. "Change the Pro tier's CTA to link to /signup."
   - [ ] It declines to change `ctaHref`, and explains that anchors match section ids
6. "Rewrite the terms page while you're in there."
   - [ ] It declines to touch `terms.astro` or `privacy.astro`
7. "Swap the icon on the 'secure' feature."
   - [ ] It declines to edit `feature-grid.tsx`
   - [ ] It tells you **which** part of that file maps ids to icons, so you can do it
8. Check nothing leaked through while you were asking.

   ```sh
   diff -rq packages/cli/templates/base/packages/ui/src/blocks .dev/playground/packages/ui/src/blocks && diff -q packages/cli/templates/base/packages/ui/src/styles/globals.css .dev/playground/packages/ui/src/styles/globals.css
   ```

   - [ ] No output from either

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — re-scaffold before Scenario 3.

```sh
pnpm play:reset && pnpm -C .dev/playground install
```

## Scenario 3 — Scaffold with hand-blanked labels

The mechanism the block-removal recipe leans on, tested on its own rather than through the
skill: a blank label in the content module drops that link, and a group with no links left
disappears entirely. This scenario also puts the tree in the "someone wrote this by hand"
state that the skill's Step 0 has a branch for.

**Setup** — once, for every case in this scenario.

1. From a fresh, installed playground, edit
   `.dev/playground/packages/ui/src/content/landing.ts` by hand:

   - set `landing.navbar.linkPricing` to `""`
   - set `landing.footer.linkPricing` to `""`
   - set `landing.footer.linkTerms` to `""`
   - set `landing.footer.linkPrivacy` to `""`

   - [ ] All four edited and saved

2. Build.

   ```sh
   pnpm -C .dev/playground build
   ```

   - [ ] Exits 0

- [ ] Setup complete

### TC-3.1 — A blank label drops its link; a group with no links disappears  ·  🔴 Critical

**Goal** — the content module's documented consequence: an empty string is the switch that
removes a navigation entry, with no block edited and no type error.

**Steps**

1. Check the built HTML before looking at the page.

   ```sh
   grep -c 'href="#pricing"' .dev/playground/apps/web/dist/index.html; grep -c '>Legal<' .dev/playground/apps/web/dist/index.html
   ```

   - [ ] The `#pricing` count dropped to **1** — only the hero's secondary button, which
         carries its `href` in `hero.tsx` and is not label-gated
   - [ ] The `>Legal<` count is **0** — the whole group vanished because both its links were
         blanked, not just its heading
2. Serve it and look.

   ```sh
   pnpm -C .dev/playground/apps/web preview
   ```

   - [ ] The navbar shows **Features** and **FAQ** only
   - [ ] There is no gap, no stray separator, and no misaligned spacing where "Pricing" was
   - [ ] The footer shows one group (**Product**) with two links
   - [ ] The footer's grid has re-flowed sensibly around the missing column rather than
         leaving a hole
   - [ ] The copyright line and the separator rule above it are still correct
3. Open the mobile menu at 375px.
   - [ ] It also shows two links, not three — the same filtered list feeds both navs
4. Confirm the pricing **section** is still on the page.
   - [ ] Scrolling still reaches the pricing table — blanking a label removes the *link*, not
         the section. That is why a block removal is two edits.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-3.2 — The skill notices hand-written copy and asks before overwriting  ·  🟡 Normal

**Goal** — the skill's Step 0, rule 4: a content module that no longer matches the shipped
demo copy, with no brief on disk, means a human wrote it — and that is not something to
silently replace.

**Steps**

1. Make the hand edit unmistakable: also change `landing.hero.title` to a sentence of your
   own.
   - [ ] Saved
2. Confirm there is still no brief.

   ```sh
   ls .dev/playground/docs 2>&1
   ```

   - [ ] Reports that the directory does not exist
3. Invoke the skill.

   ```sh
   /saasaloy-landing-copy
   ```

   - [ ] It reads the content module before asking anything
   - [ ] It says plainly that the copy has been edited by hand and that there is no brief
   - [ ] It asks whether to work from what is there or start over
   - [ ] It has written **nothing** at this point
4. Choose "work from what is there".
   - [ ] Your hero title and your blanked labels survive into whatever it proposes
   - [ ] It does not restore the demo copy anywhere as a side effect

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — nothing to tear down. Scenario 4 runs on this same playground.

## Scenario 4 — `.claude/skills/<name>` already occupied

ADR 0015's conflict path, and the reason `init` warns instead of failing: the link is a
convenience, and a path already holding something that is not ours is left exactly as it was.

**Setup** — once, for every case in this scenario. Reuse Scenario 3's playground.

1. Replace the symlink with a real directory holding a file of your own.

   ```sh
   rm .dev/playground/.claude/skills/saasaloy-landing-copy && mkdir -p .dev/playground/.claude/skills/saasaloy-landing-copy && printf 'my own skill, do not clobber\n' > .dev/playground/.claude/skills/saasaloy-landing-copy/SKILL.md
   ```

   - [ ] `ls -l .dev/playground/.claude/skills/` shows a **directory**, not a link

- [ ] Setup complete

### TC-4.1 — `init` warns, leaves the directory intact, and still exits 0  ·  🔴 Critical

**Goal** — acceptance criterion 6's failure path: a conflict is reported without clobbering,
and it does not fail the scaffold.

Note `pnpm play:init` re-runs `init --force` **over** the existing playground rather than
deleting it, which is exactly the situation this case needs. It is not `play:reset`. It does
copy the template's files back over the hand-blanked labels from Scenario 3 — that is
harmless here, and Scenario 3 is already signed off by the time you get here.

**Steps**

1. Re-run `init` over the existing playground.

   ```sh
   pnpm play:init; echo "exit=$?"
   ```

   - [ ] `exit=0` — the conflict did not fail the scaffold
2. Read the output.
   - [ ] A **warning** names `.claude/skills/saasaloy-landing-copy` and says it already exists
         and isn't ours
   - [ ] It tells you what to do: remove it, then re-run to link the skill
   - [ ] There is **no** `Skill links` success note for that name
   - [ ] The `Next steps` note has **no** `/saasaloy-landing-copy` line — nothing advertises a
         skill that is not actually linked
   - [ ] The warning is a warning, not an error or a stack trace
3. Confirm your file survived, byte for byte.

   ```sh
   cat .dev/playground/.claude/skills/saasaloy-landing-copy/SKILL.md && ls -l .dev/playground/.claude/skills/
   ```

   - [ ] It still reads `my own skill, do not clobber`
   - [ ] The path is still a directory, not a symlink
4. Confirm the real skill files are still where they belong.

   ```sh
   ls .dev/playground/.agents/skills/saasaloy-landing-copy/
   ```

   - [ ] `SKILL.md` is there — losing the link costs discovery, not files

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-4.2 — A deleted link is re-created by the next `init`  ·  🟢 Low

**Goal** — the `missing` branch of `classifyLink`: clearing the conflict and re-running gets
you the link back, so the recovery the warning suggests actually works.

**Steps**

1. Follow the warning's own advice.

   ```sh
   rm -rf .dev/playground/.claude/skills/saasaloy-landing-copy && pnpm play:init; echo "exit=$?"
   ```

   - [ ] `exit=0`
   - [ ] The `Skill links` note is back, with the arrow line
   - [ ] No warning this time
   - [ ] The `Next steps` note carries `/saasaloy-landing-copy` again
2. Confirm the link.

   ```sh
   ls -l .dev/playground/.claude/skills/
   ```

   - [ ] `saasaloy-landing-copy → ../../.agents/skills/saasaloy-landing-copy`
3. Run `init` once more without changing anything (the `correct` branch).

   ```sh
   pnpm play:init; echo "exit=$?"
   ```

   - [ ] `exit=0`, the note still reports the link, and still no warning — a second run is
         idempotent, not a conflict with itself

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — nothing required. Scenario 5 re-scaffolds the playground as a side effect.

## Scenario 5 — The repo's own template, no playground

The two guards, run against the repo rather than a scaffold. Both cases modify tracked files
and revert them, and TC-5.2 destroys and rebuilds `.dev/playground`, which is why this
scenario is last.

**Setup** — once, for every case in this scenario.

1. Start from a clean tree so the reverts below are unambiguous.

   ```sh
   git status --short
   ```

   - [ ] Only the expected uncommitted files (this QA document) are listed — no modified
         file under `packages/cli/templates/base/`

- [ ] Setup complete

### TC-5.1 — `verify:content` fails on a prose literal put back into a block  ·  🟡 Normal

**Goal** — acceptance criterion 4: the guard actually bites in the repo, on the real paths,
so the regression it exists for cannot land green.

The agent already ran this exact mutation in an out-of-repo copy (see
[Automated verification](#automated-verification-by-ai-agent), check 5) and got three
findings and exit 1. This case is the in-repo confirmation, including that the revert is
clean.

**Steps**

1. Confirm the clean baseline.

   ```sh
   pnpm verify:content; echo "exit=$?"
   ```

   - [ ] `exit=0`
   - [ ] It reports `8 block(s) clean`
2. Put three literals back into `packages/cli/templates/base/packages/ui/src/blocks/pricing-table.tsx`
   by hand — one per rule:

   - rule A: change `title = landing.pricing.title,` to `title = "Pricing that stays out of the way",`
   - rule B: change `{ui.pricing.featuredBadge}` to `Most popular`
   - rule C: change `aria-label={ui.pricing.billingPeriodLabel}` to `aria-label="Billing period"`

   - [ ] All three edited and saved
3. Run the guard.

   ```sh
   pnpm verify:content; echo "exit=$?"
   ```

   - [ ] `exit=1`
   - [ ] It reports **3** user-visible strings living in a block
   - [ ] Each finding names the file, a line number, the rule that caught it (`A prose string
         literal`, `B text in JSX`, `C aria-label literal`) and the offending text
   - [ ] The line numbers point at the lines you actually edited
   - [ ] The failure message tells you where to move them, and to use `interpolate()` rather
         than a template literal
4. Confirm the self-test still ran first — it is what keeps a broken scanner from passing
   everything. Break a rule on purpose: in `scripts/verify-content.ts`, change `isProse` to
   `return false;` on its first line.

   ```sh
   pnpm verify:content; echo "exit=$?"
   ```

   - [ ] `exit=1`
   - [ ] The failure is a **self-test** failure naming `rule A` and its own fixture, not a
         clean pass and not a report about `pricing-table.tsx`
   - [ ] It says plainly that the scanner is broken so a clean run would prove nothing
5. Revert everything.

   ```sh
   git checkout -- scripts/verify-content.ts packages/cli/templates/base/packages/ui/src/blocks/pricing-table.tsx && pnpm verify:content; echo "exit=$?"
   ```

   - [ ] `exit=0` and `8 block(s) clean` again
   - [ ] `git status --short` shows no modified file under `packages/cli/` or `scripts/`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-5.2 — The three content interfaces really require an `id`  ·  🟡 Normal

**Goal** — the shape rule that makes translation safe (position is never the key), enforced
by the compiler rather than by a comment: `Feature`, `FaqItem` and `PricingTier` all declare
`id: string` with no `?`, so an item without one cannot compile.

**Why this is a human case.** The root gate does **not** typecheck the template —
`packages/cli/tsconfig.json` includes only `src`, and the base is not a workspace member.
`pnpm deps:verify` is the only command that compiles `templates/base/**`, and it destroys and
re-scaffolds `.dev/playground` on the way. An unattended agent must not run it.

**Steps**

1. Confirm the declarations are non-optional.

   ```sh
   grep -n -A1 'Stable key\|picks the icon, and never' packages/cli/templates/base/packages/ui/src/blocks/feature-grid.tsx packages/cli/templates/base/packages/ui/src/blocks/faq.tsx packages/cli/templates/base/packages/ui/src/blocks/pricing-table.tsx
   ```

   - [ ] All three show `id: string;` — none shows `id?: string;`
2. Remove one `id` from the content module: delete the `id: "outgrow",` line from the last
   `landing.faq.items[]` entry in
   `packages/cli/templates/base/packages/ui/src/content/landing.ts`.
   - [ ] Saved
3. Compile the template. This re-scaffolds and rebuilds `.dev/playground` and needs network;
   allow a few minutes.

   ```sh
   pnpm deps:verify; echo "exit=$?"
   ```

   - [ ] It **fails**, with a TypeScript error about a missing `id` property on the FAQ items
         assigned to `FaqProps["items"]`
   - [ ] The error names `faq.tsx` or `landing.ts` — you can find the cause from the message
         alone
4. Revert and confirm green.

   ```sh
   git checkout -- packages/cli/templates/base/packages/ui/src/content/landing.ts && pnpm deps:verify; echo "exit=$?"
   ```

   - [ ] `exit=0`
   - [ ] `git status --short` shows nothing modified under `packages/cli/`
5. Confirm the fallback the other half of the rule promises: an id with **no** icon mapped
   renders a fallback rather than nothing. Edit the **playground's** copy, not the template's
   — the two are separate files and only `play:init` copies one onto the other. In
   `.dev/playground/packages/ui/src/content/landing.ts`, change the first feature's
   `id: "fast"` to `id: "brand-new"`, then rebuild the playground only.

   ```sh
   pnpm -C .dev/playground build && pnpm -C .dev/playground/apps/web preview
   ```

   - [ ] The build exits 0 — a new id is not a type error, only an unmapped icon
   - [ ] The first feature card renders with a generic sparkle icon — not a blank space and
         not a crash
   - [ ] The other five cards keep their own icons
   - [ ] Nothing needs reverting in the repo; `.dev/playground` is scratch and the next
         `play:reset` restores it

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — leave `.dev/playground` as it is; it is scratch and the next `play:reset` or
`deps:verify` re-scaffolds it. Confirm the repo itself is clean before you sign off.

```sh
git status --short
```

## Automated verification (by AI agent)

_Checks the agent ran itself — no action needed from the tester; listed here for context and
sign-off._

**The repo gate was already green before this plan was written and was deliberately not
re-run:** `pnpm turbo run build --force`, `pnpm typecheck`, `pnpm test` (10 files / 121
tests), `pnpm verify:content` and `pnpm deps:verify` all passed uncached on this branch at
the end of the last fix round. `deps:verify` is what left `.dev/playground` in the fresh
post-`play:init` state with real build output on disk, and everything below was read from
those artifacts — nothing was rebuilt, because a rebuild would have destroyed the very build
this plan starts from.

**1. The rendered page is unchanged — byte-identical, not just visually.** Flattened visible
text of the pre-change baseline (`.dev/baseline/*.html`, saved before the refactor) against
the current build:

```sh
node -e 'const fs=require("fs");const t=f=>fs.readFileSync(f,"utf8").replace(/<script[\s\S]*?<\/script>/g," ").replace(/<style[\s\S]*?<\/style>/g," ").replace(/<!--[\s\S]*?-->/g,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();console.log(t(".dev/baseline/index.html")===t(".dev/playground/apps/web/dist/index.html"))'
```

- ✅ `index.html` — 2,248 characters of visible text on both sides, **identical**.
- ✅ `terms/index.html` and `privacy/index.html` — identical too.
- ✅ Stronger result than the AC asked for: with asset hashes normalised, the **raw HTML** is
  byte-identical (56,355 chars both sides) once the four `<!-- -->` text-node separators are
  removed. All four were in the footer copyright, and they are the only HTML-level change on
  the branch: baseline
  `© <!-- -->2026<!-- --> <!-- -->playground<!-- -->. All rights reserved.` → now
  `© 2026 playground. All rights reserved.` — three React text children collapsed into one
  interpolated string. Nothing else moved. TC-1.2 step 3 is the human check that the
  inter-word spacing survived.

**2. Hydration islands unchanged** (the content module could easily have dragged a static
block into an island):

```sh
grep -o 'component-export="[^"]*"' .dev/playground/apps/web/dist/index.html | sort | uniq -c
```

- ✅ Exactly three, one each: `Navbar`, `PricingTable`, `Faq` — the same three, with the same
  counts, as the pre-change baseline. `Hero`, `FeatureGrid`, `Cta`, `Footer` and
  `ThemeToggle` still ship zero JavaScript.

**3. The copy is bundled once, not per island:**

```sh
for f in .dev/playground/apps/web/dist/_astro/*.js; do echo "$(grep -c 'ship your SaaS, not your scaffolding' "$f")  $f"; done
```

- ✅ The hero headline occurs in exactly one chunk, `landing.VjKN7mHB.js` (40,437 bytes) —
  Vite hoisted the content module into the one shared island chunk. Zero occurrences in
  `navbar`, `pricing-table`, `faq`, `button`, `react`, `react-dom` or `client`.
- ✅ Total `_astro/*.js` is 261,452 bytes. The implement step measured the same tree against
  `main` at 258,426, so the cost of the content module is **+3,014 bytes**, one time. ADR
  0022 makes the JS budget a maintained property, so this is the number to carry into the PR.

**4. `pnpm verify:content` passes, and its self-test ran first:**

```sh
pnpm verify:content
```

- ✅ Exit 0 — `8 block(s) clean — no prose literal, JSX text or spoken label outside
  packages/cli/templates/base/packages/ui/src/content/landing.ts.`
- ✅ Reaching that line means all 16 fixtures passed first: 6 `MUST_FLAG` samples (rules A, B
  and C, including a template-literal message and a multi-line JSX child) and 10 `MUST_PASS`
  samples (`"cta"`, `"#pricing"`, a Tailwind `className`, a `cn(…)` call, `size="icon-sm"`
  with `aria-hidden="true"`, a `useRef<HTMLButtonElement>`, an arrow function comparing
  against `""`, a composition template literal, a prose comment, and an `interpolate(…)` JSX
  expression). A scanner that stopped matching would fail here rather than pass everything.

**5. `verify:content` catches the regression it exists for.** Run against a **copy** of the
template outside the repo, so the working tree was never modified:

```sh
S=$SCRATCH/vc && mkdir -p "$S/scripts" "$S/packages/cli/templates/base/packages/ui/src" && cp scripts/verify-content.ts "$S/scripts/" && cp -r packages/cli/templates/base/packages/ui/src/blocks packages/cli/templates/base/packages/ui/src/content "$S/packages/cli/templates/base/packages/ui/src/" && node "$S/scripts/verify-content.ts"
```

- ✅ Clean copy → exit 0, 8 blocks clean (proves the copy is a faithful reproduction).
- ✅ After re-inserting three literals into the copy's `pricing-table.tsx` → **exit 1**, three
  findings, one per rule and each with the right line:
  - `pricing-table.tsx:54  A prose string literal — "Pricing that stays out of the way"`
  - `pricing-table.tsx:71  A prose string literal — "Billing period"`
  - `pricing-table.tsx:103  B text in JSX — "Most popular"`
- ℹ️ TC-5.1 is the in-repo confirmation of the same thing, plus the deliberately-broken-scanner
  case, which needs an edit to `scripts/verify-content.ts` and a revert.

**6. `interpolate()` behaves at its edges** (acceptance criterion 3, including the
prototype-chain fix in `4f4c720`):

```sh
node --input-type=module -e 'const { interpolate } = await import("./packages/cli/templates/base/packages/ui/src/lib/interpolate.ts"); console.log(interpolate("{constructor}|{toString}|{__proto__}", { siteName: "X" }))'
```

- ✅ Known token substituted: `Set up {siteName} today.` + `{siteName:"Ledgerly"}` →
  `Set up Ledgerly today.`
- ✅ Unknown token left visible: `The {plan} plan.` → `The {plan} plan.` — a bug you can see,
  not an empty gap you ship.
- ✅ Prototype keys pass through untouched: `{constructor}|{toString}|{__proto__}` renders as
  itself. `Object.hasOwn` is doing its job; `key in values` would have rendered a function
  body into the page.
- ✅ Numbers coerced: `© {year} {siteName}.` + `{year: 2026}` → `© 2026 playground.`
- ✅ Repeated token: `{a}{a}{a}` → `zzz` (the regex is global).

**7. `{siteName}` is honoured in exactly the four strings the SKILL.md claims:**

```sh
grep -rn "interpolate(" packages/cli/templates/base --include='*.tsx' --include='*.astro' | grep -v 'lib/interpolate.ts'
```

- ✅ Six call sites, four of them `landing.*` with `siteName`: `landing.meta.title` and
  `landing.meta.description` (`index.astro:51-52`), `landing.hero.description`
  (`hero.tsx:34`), `landing.cta.description` (`cta.tsx:32`). The other two are `ui.*`:
  `ui.footer.copyright` with `{year, siteName}` (`footer.tsx:89`) and `ui.pricing.price` with
  `{currencySymbol, price}` (`pricing-table.tsx:113`). The skill's claim that `{siteName}`
  works in exactly four strings and renders literally anywhere else is accurate.
- ✅ No template-literal message remains in `hero.tsx`, `cta.tsx`, `footer.tsx` or
  `index.astro` — every backtick that survives is inside a comment or JSDoc.

**8. The `init` skill link, on the handed-over playground** (acceptance criterion 6, happy
path):

```sh
ls -l .dev/playground/.claude/skills/ && git -C .dev/playground check-ignore -v .claude/skills/saasaloy-landing-copy && git -C .dev/playground status --short --untracked-files=all -- .agents .claude
```

- ✅ `saasaloy-landing-copy -> ../../.agents/skills/saasaloy-landing-copy` — a relative
  symlink, created by `createDirLink`.
- ✅ The real file is at `.agents/skills/saasaloy-landing-copy/SKILL.md`.
- ✅ `check-ignore` → `.gitignore:26:.claude/skills/`: the link is ignored, so it never lands
  in the owner's repo. `git status` lists `?? .agents/skills/saasaloy-landing-copy/SKILL.md`
  and nothing under `.claude/` — the files travel, the link does not.
- ✅ `packages/cli/dist/index.js` (the built CLI the playground was scaffolded with) carries
  `linkAgentSkills`, the `Symlinked for Claude Code` note text and the `# in Claude Code`
  next-steps comment, so the built artifact matches the source under review.
- ℹ️ The conflict and missing branches (TC-4.1, TC-4.2) need `init` re-run against a mutated
  tree, which changes state — left to the human. The implement step reports having verified
  both by hand.

**9. The content module is reachable as a package export** (acceptance criterion 2):

```sh
node -e 'console.log(require("./.dev/playground/packages/ui/package.json").exports)'
```

- ✅ The scaffolded `@repo/ui` carries `"./content/*": "./src/content/*.ts"`, between
  `./lib/*` and `./components/*`. `import { landing, ui } from "@repo/ui/content/landing"`
  resolves — and `deps:verify` already typechecked and built the playground through it.

**10. The skill file's structural claims about itself:**

- ✅ ADR 0014: frontmatter `name: saasaloy-landing-copy` == folder name
  `_agents/skills/saasaloy-landing-copy/` == the installed link name, `saasaloy-` prefixed.
- ✅ Frontmatter is `name:` + `description:` only, the description in the
  "…  Use when …" shape, matching `modules/waitlist` and `modules/email`.
- ✅ H1 is `# saasaloy-landing-copy — interview first, then write the page`, and the file
  closes with `## Boundaries to honor` — the house shape.
- ✅ The write-surface table lists exactly five paths: `packages/ui/src/content/landing.ts`,
  `packages/ui/src/index.ts`, `apps/web/src/layouts/Layout.astro` (`lang` only),
  `apps/web/src/pages/index.astro` (block removal only, behind its own confirmation) and
  `docs/product-brief.md`. The Boundaries section restates the same five, consistently.
- ✅ All seven interview dimensions are present (audience, problem, current alternative,
  differentiator, proof, tone, language), the two-follow-up ceiling and the `weak: <verbatim>`
  fallback are stated, pricing has three named outcomes with "never round, convert
  currencies, or fill in a typical number", and the anti-AI-writing bar is inline in the file
  rather than delegated elsewhere. Criteria 7–12 are present **as text**; whether the agent
  obeys them is Scenarios 1 and 2.

**11. The `id` requirement is declared** (the compiler-side proof is TC-5.2, which needs
`deps:verify`):

```sh
grep -n '^  id: string;' packages/cli/templates/base/packages/ui/src/blocks/feature-grid.tsx packages/cli/templates/base/packages/ui/src/blocks/faq.tsx packages/cli/templates/base/packages/ui/src/blocks/pricing-table.tsx
```

- ✅ `Feature.id`, `FaqItem.id` and `PricingTier.id` are each `id: string;` — non-optional, so
  an item without one is a type error. All three `key={…}` props now key off `id` rather than
  off the copy (`feature.title`, `item.question`, `tier.name`), which is the bug the rule
  prevents: rewriting a title used to remount the card.
- ✅ `feature-grid.tsx` maps the six ids to icons and falls back to `SparklesIcon` for an
  unmapped id, so adding a feature in content cannot break the page.

**12. The playground is in a genuinely fresh state for Scenario 1:**

- ✅ `siteName` is `"playground"`, `Layout.astro` has `lang="en"`, `.dev/playground/docs` does
  not exist, and `packages/ui/src/content/landing.ts` is byte-identical to the template's.
  The implement step's mechanical write-surface rehearsal ("Ledgerly", Bangla, 2 tiers) was
  reverted; nothing from it is on disk.

**13. Wiring** (acceptance criterion 4):

- ✅ `verify:content` is declared in the root `package.json` `scripts` and is **not** in the
  `deps:verify` chain — the same manual-only arrangement as `verify:preset`. `deps:verify`
  stays the post-dependency-bump gate.
- ✅ `CONTRIBUTING.md` documents `verify-content` alongside `verify-css` and `verify-preset`,
  including that it is textual rather than a TypeScript parse and that it self-tests.
- ✅ `templates/base/AGENTS.md` replaced the old "copy as in-file defaults" bullet with the
  content module and all five shape rules, and points owners at
  `.claude/skills/saasaloy-landing-copy` (acceptance criterion 5).

## Not covered / needs human judgment

- **The interviews themselves — the whole point of the issue.** An interview needs a
  respondent, so no unattended run can discharge acceptance criterion 13. Nothing above is
  evidence that the skill *behaves*; it is evidence that the skill's text says the right
  things and that the code it writes into compiles. TC-1.3 and TC-1.6 are the only proof
  there will ever be, and until they are run **AC 13 is unmet**.
- **Whether the copy is any good.** TC-1.5 is a human reading prose. There is no linter for
  "this sentence required an interview to write", which is exactly why the skill's bar is a
  list of tells rather than a rule.
- **Everything visual.** The dev box is headless, so the rendered page, the footer copyright's
  spacing, the feature-grid icons, the re-flowed footer after a group disappears, and
  non-Latin script rendering are the human's alone (TC-1.2, TC-1.7, TC-3.1).
- **`init`'s conflict and missing branches** (TC-4.1, TC-4.2). Both need `init` re-run against
  a deliberately mutated tree, which changes state. Reported verified by hand in the implement
  step; not re-confirmed here.
- **The template's compiler.** The root gate does not typecheck `templates/base/**` —
  `pnpm deps:verify` is the only thing that does, and it destroys the playground. So the `id`
  requirement's *enforcement* (TC-5.2) is a human case, even though the *declaration* is
  checked above.
- **`verify:content` is a guard, not a proof.** It is textual, with no TypeScript parser, and
  its own header says so: it catches the three shapes it knows and can miss an exotic one — a
  single-word literal handed to a prop, copy assembled by a helper, a string built from
  `String.fromCharCode`. A green run means no *known* drift shape, not "no copy in blocks".
- **The hero's `#pricing` anchor after a pricing-block removal.** `hero.tsx` carries
  `href: "#pricing"` on its secondary action, and that `href` is structure, so it is not
  gated by a blank label the way the navbar and footer links are. The skill's removal recipe
  names two edits and does not mention it. TC-2.2 step 7 and TC-3.1 step 1 ask the human to
  observe it; neither fixes it. Judge whether it needs a follow-up issue.
- **`ui.*` is untranslated by design.** A non-English page ships English chrome (`Monthly`,
  `Most popular`, `Close menu`). That is issue **#73**'s scope, explicitly out of this one's.
  TC-1.7 step 4 asks the human to record how bad it looks, as input to that issue.
- **No webfont for non-Latin scripts.** The template loads none; `font-sans` is the system
  stack. The skill is required to *report* this gap, not close it. Confirming the report is
  TC-1.3 step 5; confirming the rendering is TC-1.7 step 4.
- **Concurrency, performance and security dimensions** — deliberately skipped. This branch
  adds no endpoint, no request handler, no auth path and no user input surface: it moves
  string constants between files in a static-site template, adds a build-time helper, adds a
  local scanner script, and creates one symlink. `interpolate()` is the only place untrusted
  data could plausibly flow, and its prototype-chain behaviour is covered in check 6. The
  +3,014-byte JS cost is measured in check 3 and is the only performance figure this change
  has.
- **Windows.** `createDirLink` takes a `junction` branch on `win32` that no case here
  exercises — the dev box is Linux and the CI matrix is Linux. A Windows owner's
  `.claude/skills` link is untested on this branch, as it was on the branch that introduced
  the mechanism.
- **Other agents.** The skill is discovered through `.claude/skills`, so this plan tests it
  under Claude Code only. `.agents/skills/` is the vendor-neutral home per ADR 0015, but no
  other agent runtime was tried.
