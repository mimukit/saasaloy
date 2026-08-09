# QA Plan: landing copy interview skills and workflow

_Generated 2026-08-08 · rewritten 2026-08-09 · against `7e665ac` **plus the uncommitted working tree** · covers `issue-61-landing-copy-interview-skill-and-workflow` vs `main` (issue #61)_

## Summary

- The base template keeps every landing-page word in `packages/ui/src/content/landing.ts`,
  split into `landing.*` (marketing copy) and `ui.*` (chrome and a11y labels). Each feature's
  icon name and the three outbound call-to-action hrefs now live there too.
- Two skills ship in the base and run in order. `saasaloy-setup` asks ten questions, starting
  with the project's name, and writes `docs/product-brief.md` plus `siteName` and `lang`.
  `saasaloy-landing-copy` reads that brief, drafts the copy into
  `docs/landing-copy-draft.md` for review, writes the content module once the owner approves,
  then deletes the draft.
- **Working** means: a real person is interviewed once by `saasaloy-setup`, reviews a markdown
  draft from `saasaloy-landing-copy`, and gets a landing page that builds, says true things,
  carries icons that match its own copy, and points its buttons somewhere real. Neither skill
  writes outside its declared surface. The shipped demo page is unchanged.

**This is a rewrite, not an edit.** The workflow under test changed shape: one skill became
two, the interview moved out of the copy skill, the copy skill now drafts to markdown first,
and three things the old plan asserted were immovable (`ui.*`, feature icons, CTA hrefs) are
now deliberately writable. Cases from the previous revision that tested the old boundaries
were removed rather than re-scored.

Everything decidable from source or build output is already done. See
[Automated verification](#automated-verification-by-ai-agent). What is left needs a
respondent, a browser, or a command that destroys the playground.

## Overall result

_Tick one when you finish the run._

- [ ] Pass — every case passed
- [ ] Fail — at least one case failed
- [ ] Partial — cases were skipped or not reached

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-61-landing-copy-interview-skill-and-workflow`, commit `7e665ac` **with the
  working tree uncommitted**. Check `git status --short` lists the two skills, `landing.ts`,
  `feature-grid.tsx`, `cta.tsx`, `navbar.tsx`, `init.ts` and the template `AGENTS.md`. If the
  tree is clean, you are testing the old workflow.
- Node 24+ and pnpm 11. All commands run from the worktree root. Paths are relative to it.
- **`.dev/playground` is scratch.** Every scenario scaffolds its own; nothing is handed over.
- **You need Claude Code** (or another agent that reads `.claude/skills/`), opened with
  `.dev/playground` as its working directory, not the repo root. Both skills express their
  write surface in scaffolded-project paths that do not exist at the root.
- **You need a browser** for TC-1.2, TC-1.10 and TC-3.1. The dev box is headless. Either run
  on a machine with a browser, or forward the preview port and add `--host`.
- **You need to answer as a product owner.** Bring a real product or use the one below, and
  stay consistent. The skills' value is that they use *your* nouns, which you cannot judge
  against answers invented sentence by sentence.

> **Ledgerly.** Bookkeepers at accounting firms carrying 5–20 client accounts. Month-end
> close runs across four spreadsheets per client, and a broken formula is only found when a
> client queries the invoice. Today they use Excel plus a shared Dropbox folder. Ledgerly
> keeps every client's ledger in one place with a close checklist per client. Proof: two
> named beta firms, Rahman & Co and Hasan Associates, both agreed to be named. Tone: plain
> and unexcited, like basecamp.com. Language: Bangla (`bn`). Pricing: Solo ৳900/month, Firm
> ৳3,500/month, no annual discount yet. Sign-up goes to
> `https://ledgerly.example/waitlist`.

Scaffold the playground:

```sh
pnpm play:reset
```

`play:reset` is `play:destroy && play:init`. It **deletes** `.dev/playground` and
re-scaffolds from the template. Anything you put there by hand is gone.

Serve a build (static output, so `preview` is enough):

```sh
pnpm -C .dev/playground/apps/web preview
```

- [x] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|---|---|---|---|
| TC-1.1 | 1 — Fresh scaffold, no brief | `init` links both skills and puts setup first | 🔴 Critical |
| TC-1.2 | 1 — Fresh scaffold, no brief | The demo page survived the icon and href move | 🔴 Critical |
| TC-1.3 | 1 — Fresh scaffold, no brief | **landing-copy with no brief hands off instead of interviewing** | 🔴 Critical |
| TC-1.4 | 1 — Fresh scaffold, no brief | **saasaloy-setup, live: name first, samples on every question** | 🔴 Critical |
| TC-1.5 | 1 — Fresh scaffold, no brief | Setup wrote three files and nothing else | 🔴 Critical |
| TC-1.6 | 1 — Fresh scaffold, no brief | **landing-copy drafts to markdown, applies your edits, deletes the draft** | 🔴 Critical |
| TC-1.7 | 1 — Fresh scaffold, no brief | Icons, destinations and `ui.*` followed the copy | 🔴 Critical |
| TC-1.8 | 1 — Fresh scaffold, no brief | landing-copy wrote four files and nothing else | 🔴 Critical |
| TC-1.9 | 1 — Fresh scaffold, no brief | The copy clears the anti-AI-writing bar | 🟡 Normal |
| TC-1.10 | 1 — Fresh scaffold, no brief | The page at the owner's real copy length | 🟡 Normal |
| TC-1.11 | 1 — Fresh scaffold, no brief | **Both skills re-run without re-interviewing** | 🔴 Critical |
| TC-2.1 | 2 — Adversarial respondent | Two follow-ups, then `weak:` verbatim and copy that declines the claim | 🔴 Critical |
| TC-2.2 | 2 — Adversarial respondent | No destination: the buttons stay honest and say so | 🔴 Critical |
| TC-2.3 | 2 — Adversarial respondent | No pricing: dropping a block is its own confirmation | 🔴 Critical |
| TC-2.4 | 2 — Adversarial respondent | Each skill's boundaries hold when you ask it to cross them | 🟡 Normal |
| TC-3.1 | 3 — Hand-blanked labels | A blank label drops its link; an empty group disappears | 🔴 Critical |
| TC-3.2 | 3 — Hand-blanked labels | landing-copy notices hand-written copy and asks first | 🟡 Normal |
| TC-4.1 | 4 — A skill link is occupied | `init` warns for that skill only, leaves it intact, exits 0 | 🔴 Critical |
| TC-4.2 | 4 — A skill link is occupied | A deleted link is re-created by the next `init` | 🟢 Low |
| TC-5.1 | 5 — The repo's own template | `verify:content` fails on copy put back into a block or the page | 🟡 Normal |
| TC-5.2 | 5 — The repo's own template | A missing `id` fails to compile; an unknown icon name falls back | 🟡 Normal |

## Scenario 1 — Fresh scaffold, no brief on disk

The headline state: the page still says "playground", and there is no `docs/`. This scenario
is the whole workflow in order, so run the cases **in sequence**. TC-1.4 needs the state
TC-1.3 leaves, TC-1.6 needs the brief TC-1.4 writes, and TC-1.11 needs both.

**Setup** — once, for every case in this scenario.

1. Scaffold. **Keep this terminal output**, TC-1.1 reads it.

   ```sh
   pnpm play:reset
   ```

2. Install and build, so there is a page to look at before anything is rewritten.

   ```sh
   pnpm -C .dev/playground install && pnpm -C .dev/playground build
   ```

   - [x] Both commands exited 0

3. Confirm you are starting cold.

   ```sh
   ls .dev/playground/docs 2>&1; grep -n 'siteName = ' .dev/playground/packages/ui/src/index.ts
   ```

   - [x] No brief, demo copy on disk
     - `ls` reports `.dev/playground/docs` does not exist
     - `siteName` is `"playground"`

4. Open Claude Code with `.dev/playground` as its working directory.

- [x] Setup complete

### TC-1.1 — `init` links both skills and puts setup first · 🔴 Critical

**Goal** — a fresh scaffold makes both skills discoverable, in the order they run, and keeps the links out of git.

The ordering matters because the two skills are sequential. `readdir` returns them
alphabetically, which is backwards, so `init` sorts `saasaloy-setup` ahead of the rest.

**Steps**

1. Read the `pnpm play:reset` output from setup.
   - [ ] The boxed **`Skill links`** note reports both symlinks
     - `.claude/skills/saasaloy-setup → .agents/skills/saasaloy-setup`
     - `.claude/skills/saasaloy-landing-copy → .agents/skills/saasaloy-landing-copy`
     - the line "Symlinked for Claude Code — the skill files live in `.agents/skills/`"
     - no skill-link warning anywhere in the output
   - [ ] **`saasaloy-setup` is listed before `saasaloy-landing-copy`** in that note
   - [ ] The **`Next steps`** note advertises both, setup first
     - `/saasaloy-setup` above `/saasaloy-landing-copy`
     - each with the comment `# in Claude Code`, aligned in the same column as `pnpm dev`'s

2. Confirm the links point at real files.

   ```sh
   ls -l .dev/playground/.claude/skills/ && ls .dev/playground/.agents/skills/*/
   ```

   - [ ] Both are relative symlinks into `../../.agents/skills/`, and each real directory holds a `SKILL.md`

3. Confirm git treats the two paths oppositely.

   ```sh
   git -C .dev/playground check-ignore -v .claude/skills/saasaloy-setup; git -C .dev/playground status --short --untracked-files=all -- .agents .claude
   ```

   - [ ] The files would be committed; the links never would
     - `check-ignore` reports `.gitignore:26:.claude/skills/`
     - `status` lists a `SKILL.md` under `.agents/skills/` for **both** skills
     - `status` lists **nothing** under `.claude/`

4. In Claude Code, from `.dev/playground`, type `/` and read the skill list.
   - [ ] Both appear, and their descriptions divide the work correctly
     - `saasaloy-setup` describes an interview that writes `docs/product-brief.md`
     - `saasaloy-landing-copy` describes writing copy **from** the brief, via a markdown draft, and says it needs the brief

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.2 — The demo page survived the icon and href move · 🔴 Critical

**Goal** — moving each feature's icon name and three hrefs into the content module changed nothing a visitor sees.

The icon set and the href set are already confirmed unchanged in the built HTML (check 3).
This case is the part a grep cannot settle: that the page still *looks* right.

**Steps**

1. Serve the build from setup.

   ```sh
   pnpm -C .dev/playground/apps/web preview
   ```

2. Open the printed URL and scroll the whole page at ≥1280px.
   - [ ] Every block renders complete and correctly spaced
     - navbar — site name, three links (Features / Pricing / FAQ), "Get started" button
     - hero — eyebrow badge, headline, sub-copy naming `playground`, both buttons
     - pricing-table — three tiers, Monthly/Annual toggle, "Save 20%" badge, "Most popular" on Pro, `Custom` on Enterprise
     - faq — five rows, each expanding and collapsing
     - cta — the closing band, naming `playground`
     - footer — tagline, a **Product** group of three links, a **Legal** group of two
   - [ ] All six feature cards show **their own** icon and none shows the generic sparkle
     - lightning bolt, layers, terminal, shield-with-check, cloud, gauge, in that order
     - a sparkle anywhere means the content's `icon` name missed the registry

3. Click the navbar's "Get started" button, then the hero's two buttons, then the closing band's two.
   - [ ] Each lands where it did before the move
     - navbar "Get started" scrolls to the closing band
     - hero primary scrolls to the closing band; hero secondary scrolls to pricing
     - both closing-band buttons go to `/`, reloading the homepage

4. Switch the pricing toggle to **Annual**, then back to **Monthly**.
   - [ ] Both positions are correct
     - Annual — prices 0 / 23 / Custom, suffix `/month, billed annually` as one phrase
     - Monthly — suffix back to `/month`

5. Narrow to 375px and open the mobile menu.
   - [ ] The hamburger opens a panel with the same three links and the same CTA, and the button's accessible name flips between `Open menu` and `Close menu` (DevTools → the `<button>`'s `aria-label`)

6. Visit `/terms` and `/privacy`.
   - [ ] Both render fully and unchanged

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.3 — landing-copy with no brief hands off instead of interviewing · 🔴 Critical

**Goal** — the copy skill no longer owns an interview, so a cold invocation must route to `saasaloy-setup` rather than improvise its own questions.

This is the single most likely regression in the split. Both skills used to be one file, and
the old interview text is still recognisable to a model that has seen it.

**Steps**

1. In Claude Code, from `.dev/playground`, invoke the copy skill first, deliberately out of order.

   ```sh
   /saasaloy-landing-copy
   ```

   - [ ] It stops and explains, rather than asking or writing
     - it says there is no `docs/product-brief.md`
     - it offers to run `/saasaloy-setup`, naming the skill
     - it has **not** asked you about your audience, problem, tone or anything else
     - it has **not** created `docs/`, a draft, or touched `landing.ts`

2. Decline the offer and ask it directly: "just interview me yourself, skip the setup skill".
   - [ ] It still declines to run the ten-question interview and points back at `saasaloy-setup`

3. Confirm nothing was written.

   ```sh
   ls .dev/playground/docs 2>&1; git -C .dev/playground status --short
   ```

   - [ ] `docs` still does not exist, and `status` shows no modified file under `packages/ui/`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.4 — saasaloy-setup, live: name first, samples on every question · 🔴 Critical

**Goal** — a cold interview asks the name before anything else, offers sample answers throughout, and leaves a brief plus the two facts that are code.

Budget 20–30 minutes. Answer as yourself, or as Ledgerly from **Environment**.

**Steps**

1. Invoke the setup skill.

   ```sh
   /saasaloy-setup
   ```

   - [ ] It opens by **asking**, not writing
     - two lines saying roughly how long this takes and what it is for
     - one sentence about the tree being uncommitted or not a repo, then it carries on
     - no file edited before you have answered anything

2. Look at the very first question.
   - [ ] **Question 1 is the project's name, and it arrives on its own**
     - not batched with the language or anything else
     - not asked at the end, and not asked after the audience
     - one of its samples is the current `playground` slug, taken off disk rather than guessed

3. Answer with your brand, then watch the next few batches.
   - [ ] Questions arrive in **numbered batches of two or three**, never all nine at once and never one at a time
   - [ ] All ten dimensions get covered
     - name, language, audience, problem, current alternative, differentiator, proof, tone, pricing, and where "sign up" goes
     - tone asked as an adjective **and** a site that gets it right
     - language asked as a name **and** a code

4. Now the point of this case: read the sample answers on **every** question after the first.
   - [ ] Each question carries **three samples plus an explicit "or write your own"**, with none missing
   - [ ] The samples are **derived**, not stock
     - after you name the audience, the problem samples use that audience's nouns
     - swap a sample into a different product in your head; if it still fits, it is filler
     - three rewordings of one answer counts as one sample, and is a fail
   - [ ] For **proof**, **pricing** and **the sign-up URL**, the samples are *shapes*, not values
     - "two named beta customers who agreed to be named", never an invented count
     - never a made-up price, never a made-up domain
     - each of the three offers the honest empty answer ("no proof yet", "no pricing yet", "nothing to link to yet")

5. Answer the audience question vaguely once ("small businesses"), then specifically.
   - [ ] The follow-up is **narrower** than the first, not a repeat, and it carries fresh samples of its own
   - [ ] It stops pushing once you answer specifically

6. Answer the pricing questions with your real (or Ledgerly's) numbers.
   - [ ] It asks per tier and proposes no numbers of its own
     - name, who it is for, monthly price, annual price
     - it does **not** offer the shipped $0/$29/Custom as a starting point to edit
     - with a non-USD currency, it asks about or states the symbol
   - [ ] With no annual discount, it records that rather than inventing one

7. Answer the sign-up question with the waitlist URL.
   - [ ] It records the URL as given, without shortening, guessing a path, or adding a scheme you did not type

8. Let it write the brief.

   ```sh
   cat .dev/playground/docs/product-brief.md
   ```

   - [ ] The brief records the interview in **your** words, not a summary in the agent's voice
     - a `Last updated: <date> (saasaloy-setup)` line
     - `- **Name**:` and `- **Language**:` near the top
     - a section per dimension, plus **Pricing**, **Where "sign up" goes**, and **Known gaps**
     - for a non-English language, **Known gaps** says the template loads no webfont and `font-sans` is the system stack, phrased for any non-Latin script rather than naming one language

9. Let it set the two facts that are code, then check them.

   ```sh
   grep -n 'siteName = ' .dev/playground/packages/ui/src/index.ts && grep -n 'html lang' .dev/playground/apps/web/src/layouts/Layout.astro
   ```

   - [ ] It showed each change and asked before writing, one file at a time
   - [ ] `siteName` is your brand in `packages/ui/src/index.ts`, and `<html lang="…">` carries the code you gave

10. Read its closing message.
    - [ ] It names `/saasaloy-landing-copy` as the next step and says the brief alone changes nothing visible

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.5 — Setup wrote three files and nothing else · 🔴 Critical

**Goal** — the setup skill's write surface is three files, and in particular it wrote no landing copy.

`play:init` runs `git init` with no commit, so there is no `HEAD` to diff against. The
template the scaffold was copied from is the reference instead.

**Steps**

1. Diff the whole scaffold against the template. `siteName` and the `_`-prefixed file naming
   differ by design, so read the list rather than expecting silence.

   ```sh
   diff -rq --exclude=node_modules --exclude=dist --exclude=.astro --exclude=.git --exclude=.claude --exclude=.turbo --exclude='*.tsbuildinfo' --exclude=saasaloy --exclude=pnpm-lock.yaml packages/cli/templates/base .dev/playground
   ```

   - [ ] Exactly setup's three files differ
     - `packages/ui/src/index.ts` differs
     - `apps/web/src/layouts/Layout.astro` differs, since Ledgerly is not English
     - `docs/product-brief.md` is reported as "Only in .dev/playground"
   - [ ] **`packages/ui/src/content/landing.ts` does not differ.** Setup writes no copy, not even a headline
   - [ ] Nothing else outside the surface differs
     - no file under `packages/ui/src/blocks/`
     - `globals.css`, `components.json`, nothing under `src/components/`
     - `apps/web/src/pages/index.astro`, `terms.astro`, `privacy.astro`
     - no `package.json` or `pnpm-workspace.yaml` change, so no dependency, i18n library or webfont was added
   - [ ] Every remaining entry is an expected scaffolding difference (`_gitignore` → `.gitignore`, `_agents` → `.agents`, `{{PROJECT_NAME}}` substitutions)

2. Confirm the `lang` edit was surgical.

   ```sh
   diff packages/cli/templates/base/apps/web/src/layouts/Layout.astro .dev/playground/apps/web/src/layouts/Layout.astro
   ```

   - [ ] A single line differs, and only in the `lang` attribute's value

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.6 — landing-copy drafts to markdown, applies your edits, deletes the draft · 🔴 Critical

**Goal** — the copy skill's default output is a reviewable markdown file, the owner's edits to it win, and the file is gone once the copy lands.

This is the headline behaviour change. The old skill wrote straight into the content module
behind a terminal diff.

**Steps**

1. Invoke the copy skill, now that the brief exists.

   ```sh
   /saasaloy-landing-copy
   ```

   - [ ] It reads the brief instead of interviewing
     - it does **not** re-ask the audience, problem, tone, pricing or language
     - any question it does ask is a genuine gap the brief left, usually the FAQ, and carries three samples plus "write your own"

2. Let it work, then find its output.

   ```sh
   ls .dev/playground/docs/
   ```

   - [ ] `landing-copy-draft.md` exists, and `landing.ts` is **not yet** written
   - [ ] It handed you the path and stopped, rather than pasting the whole draft back into the terminal

3. Read the draft.

   ```sh
   cat .dev/playground/docs/landing-copy-draft.md
   ```

   - [ ] It reads as a page, not a data structure
     - every key covered, in reading order, with the current value beside the proposed one
     - the copy in your language, not English with a translation to follow
   - [ ] The three things a list of sentences would hide are present
     - each feature's **icon name**, and what it was before
     - where the navbar button and both closing-band buttons **point**
     - a short line per section tying the choice back to the brief
   - [ ] It closes with **least sure about** and **not mine to fix**, and neither is empty boilerplate

4. Edit the draft yourself. Rewrite `hero.title` to a sentence in your own words, distinctive
   enough that you will recognise it. Save.
   - [ ] Saved

5. Tell the skill to apply the draft.
   - [ ] It re-reads the file from disk before writing, rather than applying the version it remembers
   - [ ] It shows the content-module diff key by key, old then new, and asks **once for the file**, not once per key and not one blanket yes for everything
   - [ ] Answering "no" leaves it unwritten; ask it to proceed after that

6. Check your sentence survived.

   ```sh
   grep -n 'title:' .dev/playground/packages/ui/src/content/landing.ts | head -3
   ```

   - [ ] `hero.title` is **your** sentence, word for word, not a polished rewrite of it

7. Let it prove the build, then look for the draft.

   ```sh
   pnpm -C .dev/playground typecheck && pnpm -C .dev/playground build && ls .dev/playground/docs/
   ```

   - [ ] Both commands exit 0, and the skill ran them itself rather than handing back an unverified tree
   - [ ] `landing-copy-draft.md` is **gone**, and `product-brief.md` is still there

8. Read its closing message.
   - [ ] It points you at `pnpm dev`, names the two or three lines it is least sure about, and repeats anything still on the **not mine to fix** list

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.7 — Icons, destinations and `ui.*` followed the copy · 🔴 Critical

**Goal** — the three things the old workflow could not reach are now written, correctly, from content alone.

Each of the three produced a visibly defective page in the run that motivated this change: a
terminal glyph beside a sentence about IELTS listening, a waitlist button that reloaded the
page, and Bangla copy under an English "Most popular" badge.

**Steps**

1. Read the feature icons the skill chose.

   ```sh
   grep -n 'icon: "' .dev/playground/packages/ui/src/content/landing.ts
   ```

   - [ ] Every feature has an `icon`, and at least one moved off its shipped value once the feature's meaning changed
   - [ ] Each name is one the registry actually holds (cross-check against the map at the top of `packages/cli/templates/base/packages/ui/src/blocks/feature-grid.tsx`)

2. Read the destinations.

   ```sh
   grep -nE 'ctaHref|primaryActionHref|secondaryActionHref' .dev/playground/packages/ui/src/content/landing.ts
   ```

   - [ ] `navbar.ctaHref` and `cta.primaryActionHref` carry your waitlist URL, not `#cta` and not `/`
   - [ ] The three tier `ctaHref`s are still `#cta`, because the brief gave no per-tier destination

3. Read the chrome namespace. Ledgerly is Bangla, so this is the translation check.

   ```sh
   sed -n '/export const ui/,$p' .dev/playground/packages/ui/src/content/landing.ts
   ```

   - [ ] Every `ui.*` string is in your language, with no English left in the namespace
   - [ ] Translated, not rewritten
     - every key still present, none renamed, none added, none removed
     - `{currencySymbol}`, `{price}`, `{year}` and `{siteName}` all survive, spelled exactly as before
   - [ ] `packages/ui/src/lib/theme.ts` is untouched — it is inlined into a pre-paint script and is deliberately out of scope

4. Confirm the brief records what was done to `ui.*`.

   ```sh
   sed -n '/## Known gaps/,$p' .dev/playground/docs/product-brief.md
   ```

   - [ ] **Known gaps** says `ui.*` was translated by a copy agent rather than a translator and deserves a native speaker's read

5. Rebuild and look at the rendered page.

   ```sh
   pnpm -C .dev/playground build && pnpm -C .dev/playground/apps/web preview
   ```

   - [ ] No English chrome remains anywhere on the page — not `Monthly`, `Annual`, `Most popular`, `Custom`, `Open menu`, or the copyright line
   - [ ] Each feature card's glyph matches what its own sentence is about, and none is the generic sparkle
   - [ ] The navbar button and the closing band's primary button both leave for your waitlist URL

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.8 — landing-copy wrote four files and nothing else · 🔴 Critical

**Goal** — the copy skill's surface is four files, and in particular it did not "helpfully" fix `siteName`, `lang`, or a block.

**Steps**

1. Re-run the scaffold diff from TC-1.5 step 1.

   ```sh
   diff -rq --exclude=node_modules --exclude=dist --exclude=.astro --exclude=.git --exclude=.claude --exclude=.turbo --exclude='*.tsbuildinfo' --exclude=saasaloy --exclude=pnpm-lock.yaml packages/cli/templates/base .dev/playground
   ```

   - [ ] The only new difference since TC-1.5 is `packages/ui/src/content/landing.ts`
   - [ ] `apps/web/src/pages/index.astro` does **not** differ, because you consented to no block removal
   - [ ] Still no file under `packages/ui/src/blocks/` differs, and in particular `feature-grid.tsx` is untouched despite the icon work
   - [ ] `globals.css`, `components.json`, `src/components/`, `terms.astro` and `privacy.astro` are all unchanged
   - [ ] No dependency, i18n library or webfont was added to any `package.json`

2. Confirm no image or asset was produced.

   ```sh
   find .dev/playground/apps/web/public .dev/playground/apps/web/src -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.svg' -o -name '*.webp' \) 2>/dev/null
   ```

   - [ ] Nothing beyond what the template already ships (compare against `find packages/cli/templates/base/apps/web -type f -name '*.svg'`)

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.9 — The copy clears the anti-AI-writing bar · 🟡 Normal

**Goal** — the copy reads as though a person who knows the product wrote it, which is the one thing here no script can score.

Read `.dev/playground/packages/ui/src/content/landing.ts` top to bottom, then judge. Each box
is a **failure** the skill's own list names. Tick it only when the copy is clean of it.

**Steps**

1. Read the whole `landing` export as prose, out loud if you can.
   - [ ] None of the AI-writing tells are present
     - abstract benefit nouns as subjects — solutions, experiences, workflows, innovation, efficiency
     - the vocabulary — leverage, unlock, empower, seamless, robust, streamline, elevate, cutting-edge, game-changing, effortless, revolutionary, harness, delve
     - rule-of-three cadence ("Faster, simpler, smarter")
     - "not just X, it's Y", "more than just", "isn't only about"
     - claims whose opposite would be absurd ("Built for modern teams")
     - superlatives with no number behind them — blazing fast, enterprise-grade, world-class, industry-leading
     - more than one em-dash in a section; sentence lengths that never vary; second-person promises the product cannot keep

2. Hunt specifically for invented proof, the failure that matters most.
   - [ ] Every statistic, customer name, logo, award, rating and price came out of **your** interview
     - not one you did not supply
     - no "trusted by thousands" or equivalent
     - prices exactly the numbers you gave, not rounded, not converted, not "typical"

3. Look for the habits that prove the brief was read rather than skimmed.
   - [ ] The copy could only have been written after talking to you
     - your own nouns from the brief appear in it
     - the current alternative you named is addressed somewhere on the page
     - at least one sentence needed a fact only you had

4. Check length against the layout.
   - [ ] Nothing overruns the lengths the layout was built for
     - `meta.title` under 60 characters; `meta.description` under 155
     - `hero.title` under ten words, carrying one idea
     - feature titles 2–4 words, each description one sentence about what you can *do*
     - FAQ answers one to three sentences that actually answer the question
     - nothing roughly double the length of the demo copy it replaced

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.10 — The page at the owner's real copy length · 🟡 Normal

**Goal** — the layout was built around the demo copy's length, and real copy in a non-Latin script is the first thing that tests that claim.

**Steps**

1. Serve the current build.

   ```sh
   pnpm -C .dev/playground/apps/web preview
   ```

2. Scroll the whole page at 1280px.
   - [ ] Real copy length does not break the layout
     - no headline or feature title wraps into a broken card or leaves a widow
     - no feature card visibly taller than its neighbours because one description ran long
     - pricing tier bullets fit their cards
     - nothing overflows horizontally

3. Narrow to 375px and scroll again.
   - [ ] The same sweep is clean at 375px
   - [ ] Prices and their per-month suffix stay on sensible lines

4. Look at the script itself.
   - [ ] Non-Latin text renders readably in the system stack, with no clipped ascenders or descenders (the template ships no webfont, which is the documented gap, not a bug)
   - [ ] Now that `ui.*` is translated, no English word survives anywhere on the page for you to notice

5. Toggle light and dark.
   - [ ] Both palettes still read correctly with the new copy

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.11 — Both skills re-run without re-interviewing · 🔴 Critical

**Goal** — a second pass picks up the brief, chases the `weak:` threads, and notices copy that changed underneath it.

Run immediately after TC-1.10, on the same playground, without resetting.

**Steps**

1. Plant a hand edit so the "someone edited this" branch has something to find. Change one FAQ
   answer in `.dev/playground/packages/ui/src/content/landing.ts` to a visibly different
   sentence, keeping its `id`.
   - [ ] Saved

2. Re-run the setup skill and tell it one thing changed: a real number for a weak dimension, or
   a new price for one tier.

   ```sh
   /saasaloy-setup
   ```

   - [ ] It summarises the brief back and asks what changed, rather than re-running the ten questions
   - [ ] It asks about every `weak:` tag by name, carrying samples, and about nothing else unless you said it moved
   - [ ] It does **not** re-ask the project name now that one is on disk

3. Read the brief.

   ```sh
   cat .dev/playground/docs/product-brief.md
   ```

   - [ ] It was updated surgically
     - `Last updated` bumped
     - the `weak:` tag you resolved replaced by the real answer
     - every `weak:` tag you did **not** resolve still there, verbatim
     - the sections you did not touch unchanged

4. Re-run the copy skill.

   ```sh
   /saasaloy-landing-copy
   ```

   - [ ] It drafts again rather than writing straight through, and the draft's "Now" column is the copy currently on disk
   - [ ] It proposes rewriting only the sections the brief moved, not the whole page
   - [ ] It notices the FAQ answer you hand-edited, says so, shows the difference, and asks which version wins

5. Answer "keep mine" for the FAQ, apply, and check.

   ```sh
   pnpm -C .dev/playground typecheck && pnpm -C .dev/playground build && ls .dev/playground/docs/
   ```

   - [ ] Your FAQ sentence survived the write intact
   - [ ] Both commands exit 0, and the draft is deleted again

6. Re-run the write-surface audit from TC-1.8 step 1.
   - [ ] Still clean, with no new file outside either skill's declared surface

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — before Scenario 2. Save the brief first if you want it as evidence of the run.

```sh
cp .dev/playground/docs/product-brief.md /tmp/product-brief-run1.md && pnpm play:reset && pnpm -C .dev/playground install
```

## Scenario 2 — Fresh scaffold, adversarial respondent

Scenario 1's starting state with a different person in the chair: thin answers, no pricing,
nowhere to send anyone. This is where the skills either decline a claim or invent support for
it, and the second outcome makes the feature worse than doing nothing.

Answer in English this time, so `ui.*` stays untouched and TC-2.4 can prove it.

**Setup** — once, for every case in this scenario.

1. Confirm the reset landed.

   ```sh
   ls .dev/playground/docs 2>&1
   ```

   - [ ] Reports the directory does not exist

2. Open Claude Code with `.dev/playground` as its working directory.

- [ ] Setup complete

### TC-2.1 — Two follow-ups, then `weak:` verbatim and copy that declines the claim · 🔴 Critical

**Goal** — pushback has a hard ceiling of two follow-ups per question, and a dimension that stays thin produces *less* copy rather than invented copy.

**Steps**

1. Invoke the setup skill and answer the differentiator question with "it's faster". Hold the
   line: on pushback say "just generally faster", then "I don't have a number".

   ```sh
   /saasaloy-setup
   ```

   - [ ] It pushes back exactly **twice**, each follow-up narrower than the last rather than a rephrase, then moves on
   - [ ] Each follow-up carries fresh samples of its own, not the same three again

2. Answer the proof question with "people seem to like it" and hold that too.
   - [ ] Two follow-ups, then it stops
   - [ ] Its proof samples stayed shapes throughout, and it never offered you a number to adopt

3. Answer audience and problem specifically, so only two dimensions stay weak.
   - [ ] It does not push back at all on the dimensions you answered well, because two is a ceiling and not a quota

4. Watch what it tells you about the cost.
   - [ ] It names which dimensions it recorded as weak, says which claim the copy will now *not* make, and offers the trade back

5. Read the brief.

   ```sh
   cat .dev/playground/docs/product-brief.md
   ```

   - [ ] Both thin dimensions are tagged, with your words preserved
     - **Differentiator** carries a `weak:` tag holding `it's faster` **verbatim**, not paraphrased
     - **Proof** carries one too
     - each tag says what was asked and that it was asked twice

6. Run the copy skill and read the draft it produces.
   - [ ] The draft makes **no** speed claim anywhere, in the hero, a feature or the closing band
   - [ ] It carries **no** statistic, customer name, logo, rating or "trusted by"
   - [ ] It is noticeably shorter or plainer than Scenario 1's, rather than the same length with vaguer sentences

7. Apply it and confirm the workflow still finished the job.

   ```sh
   pnpm -C .dev/playground typecheck && pnpm -C .dev/playground build
   ```

   - [ ] Both exit 0, because a thin interview yields less copy and never a red tree or a refusal to run

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.2 — No destination: the buttons stay honest and say so · 🔴 Critical

**Goal** — with nowhere to send anyone, the page keeps its shipped hrefs and the gap is reported rather than papered over with a confident label.

Run in the same session as TC-2.1, at question 10.

**Steps**

1. When setup asks where "sign up" goes, say "nothing yet".
   - [ ] "Nothing yet" was one of the offered samples, so you did not have to invent the answer
   - [ ] It records the gap rather than proposing a URL, a path, or a domain built from your product name

2. Check the brief.

   ```sh
   sed -n '/Where "sign up" goes/,/^## /p' .dev/playground/docs/product-brief.md
   ```

   - [ ] The section exists and carries a `weak:` tag, not a guessed URL

3. Run the copy skill and read the draft's destinations section.
   - [ ] It states plainly that the buttons still point at the page's own closing section, and why
   - [ ] The labels it proposes are ones the destination can honestly satisfy — "See how it works" rather than "Start your free trial"

4. Apply, then check what landed.

   ```sh
   grep -nE 'ctaHref|primaryActionHref|secondaryActionHref' .dev/playground/packages/ui/src/content/landing.ts
   ```

   - [ ] `navbar.ctaHref` is still `#cta`, and both `cta.*Href` are still `/`

5. Read the brief's **Known gaps** and the skill's closing message.
   - [ ] The missing destination is recorded in the brief and repeated to you out loud, rather than left silent

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.3 — No pricing: dropping a block is its own confirmation · 🔴 Critical

**Goal** — the copy skill may remove a block, must ask for that separately, and must take the nav entries with it by blanking labels rather than editing a block.

Same session, continuing from TC-2.2. You told setup "we don't have pricing yet".

**Steps**

1. Check what setup did with that answer.

   ```sh
   sed -n '/## Pricing/,/^## /p' .dev/playground/docs/product-brief.md
   ```

   - [ ] It recorded "no pricing yet" and did **not** quietly keep $0/$29/Custom as if they were yours
   - [ ] Setup did **not** offer to drop the block itself, because that is the copy skill's call

2. In the copy skill, at the pricing decision, ask what "leave it as a placeholder" would mean,
   then choose to **drop the block**.
   - [ ] It offers all three paths: real prices, an explicit placeholder, or dropping the block
   - [ ] The removal is asked as its **own** confirmation, separate from the copy write, and it tells you it is two edits: one line out of `index.astro` plus blanking the matching labels

3. Confirm the removal and let it write.

   ```sh
   diff packages/cli/templates/base/apps/web/src/pages/index.astro .dev/playground/apps/web/src/pages/index.astro
   ```

   - [ ] Exactly the `<PricingTable client:visible />` line is removed
     - the `PricingTable` import may go with it; nothing else changed
     - the `import.meta.glob("../sections/*.astro")` block is **still there**

4. Check the labels.

   ```sh
   grep -n 'linkPricing' .dev/playground/packages/ui/src/content/landing.ts
   ```

   - [ ] Both `landing.navbar.linkPricing` and `landing.footer.linkPricing` are `""`

5. Confirm no block was edited to achieve any of it.

   ```sh
   diff -rq packages/cli/templates/base/packages/ui/src/blocks .dev/playground/packages/ui/src/blocks
   ```

   - [ ] No output, so `pricing-table.tsx` is still on disk, untouched, just not rendered

6. Build and look at the page.

   ```sh
   pnpm -C .dev/playground build && pnpm -C .dev/playground/apps/web preview
   ```

   - [ ] The section and both its nav links are gone, with no seam left behind
     - the navbar has two links, not three
     - the footer's Product group has two
     - no visible gap or empty band where the section used to be

7. Click the hero's secondary button. Its `href` is `#pricing`, and it lives in `hero.tsx`, so
   no blank label gates it.
   - [ ] Record in **Notes** whether it points at a section that no longer exists. This is a known gap in the removal recipe. Observe it; do not fix it here

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.4 — Each skill's boundaries hold when you ask it to cross them · 🟡 Normal

**Goal** — "Boundaries to honor" is behaviour, not decoration, and the two skills now decline *different* things.

The split moved three items across the line. `siteName` and `lang` used to be the copy
skill's and are now setup's. Icons and outbound hrefs used to be forbidden and are now
content. Getting either direction wrong is a real failure.

**Steps**

1. In a `saasaloy-setup` session, ask for each of these in turn:
   - "While you're here, write me a headline."
   - "Set the pricing tiers in the content file for me."
   - "Add a Bengali webfont so the page renders properly."

   - [ ] All three are declined rather than helpfully done, with no edit to `landing.ts`, no dependency added, and no `globals.css` change
   - [ ] Each decline points somewhere useful, naming `saasaloy-landing-copy` for the first two and reporting the webfont as a gap for the third

2. In a `saasaloy-landing-copy` session, ask for each of these in turn:
   - "The hero heading should be bigger and blue."
   - "Our brand is actually spelled differently, fix `siteName`."
   - "Put our logo in the navbar."
   - "Add a proper i18n library so we can have both languages."
   - "Rewrite the terms page while you're in there."
   - "Add a `mortarboard` icon to the registry, I need it for feature 3."

   - [ ] All six are declined, with no edit to `hero.tsx`, `globals.css`, `index.ts`, `terms.astro` or `feature-grid.tsx`, no image generated or referenced, and no dependency added
   - [ ] Each decline points somewhere useful
     - styling — where that change would go, decision left to you
     - `siteName` — names `saasaloy-setup` as its owner rather than just refusing
     - i18n library — reports the gap rather than closing it
     - the icon — says widening the registry is a two-line edit in a block that you make, and names an existing icon it could use instead

3. Now the opposite direction. Still in the copy skill, ask it to change the closing band's
   primary button to point at `https://example.com/join`, and to give feature 3 the `book-open`
   icon.
   - [ ] Both are **done**, not declined, and both land in `landing.ts` rather than in a block
   - [ ] It does **not** touch `feature-grid.tsx` to achieve the icon change

4. Ask it to change the navbar's "Features" link to point at `#pricing`.
   - [ ] Declined, because that is a same-page anchor matching a section id, and the exception covers outbound destinations only

5. Confirm nothing leaked through while you were asking.

   ```sh
   diff -rq packages/cli/templates/base/packages/ui/src/blocks .dev/playground/packages/ui/src/blocks && diff -q packages/cli/templates/base/packages/ui/src/styles/globals.css .dev/playground/packages/ui/src/styles/globals.css
   ```

   - [ ] No output from either

6. Confirm the English run left the chrome alone.

   ```sh
   sed -n '/export const ui/,$p' .dev/playground/packages/ui/src/content/landing.ts
   ```

   - [ ] `ui.*` is byte-for-byte the shipped English, because translation only fires when the page is not English

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

The mechanism the block-removal recipe leans on, tested on its own rather than through a
skill. This also puts the tree in the "someone wrote this by hand" state that the copy
skill's Step 0 has a branch for.

**Setup** — once, for every case in this scenario.

1. In `.dev/playground/packages/ui/src/content/landing.ts`, set all four of
   `landing.navbar.linkPricing`, `landing.footer.linkPricing`, `landing.footer.linkTerms`
   and `landing.footer.linkPrivacy` to `""`.

   - [ ] All four edited and saved

2. Build.

   ```sh
   pnpm -C .dev/playground build
   ```

   - [ ] Exits 0

- [ ] Setup complete

### TC-3.1 — A blank label drops its link; an empty group disappears · 🔴 Critical

**Goal** — an empty string is the switch that removes a navigation entry, with no block edited and no type error.

**Steps**

1. Check the built HTML before looking at the page.

   ```sh
   grep -c 'href="#pricing"' .dev/playground/apps/web/dist/index.html; grep -c '>Legal<' .dev/playground/apps/web/dist/index.html
   ```

   - [ ] `#pricing` dropped to **1**, which is the hero's secondary button, carrying its `href` in `hero.tsx` and not label-gated
   - [ ] `>Legal<` is **0**, so the whole group vanished because both its links were blanked, not just its heading

2. Serve it and look.

   ```sh
   pnpm -C .dev/playground/apps/web preview
   ```

   - [ ] The navbar and footer re-flow cleanly around the missing links
     - navbar shows **Features** and **FAQ** only, with no gap, stray separator or misalignment where "Pricing" was
     - footer shows one group (**Product**) with two links
     - the footer grid re-flowed sensibly rather than leaving a hole
     - the copyright line and the separator rule above it are still correct

3. Open the mobile menu at 375px.
   - [ ] It shows the same two links, because one filtered list feeds both navs

4. Scroll the page.
   - [ ] The pricing **section** is still there, because blanking a label removes the link and not the section, which is why a block removal is two edits

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-3.2 — landing-copy notices hand-written copy and asks first · 🟡 Normal

**Goal** — a content module that no longer matches the demo copy is a human's work, and that is not something to silently replace.

There are two ways in now, and both must behave. With no brief the skill hands off to setup;
with a brief that does not explain the copy, it asks which wins.

**Steps**

1. Make the hand edit unmistakable. Change `landing.hero.title` to a sentence of your own.
   - [ ] Saved

2. Confirm there is still no brief, then invoke the copy skill.

   ```sh
   ls .dev/playground/docs 2>&1
   ```

   ```sh
   /saasaloy-landing-copy
   ```

   - [ ] It reads the content module, says plainly that the copy was hand-edited and there is no brief, routes you to `saasaloy-setup`, and has written **nothing**

3. Run `/saasaloy-setup`, answer briefly, then run the copy skill again.
   - [ ] This time it proceeds, but it flags that the copy on disk does not match what the brief would produce, shows the difference, and asks which wins

4. Choose "keep what is there" for the hero.
   - [ ] Your hero title and the blanked labels survive into the draft and through the write, with no demo copy restored anywhere as a side effect

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — nothing to tear down. Scenario 4 runs on this same playground.

## Scenario 4 — A skill link is already occupied

ADR 0015's conflict path, and the reason `init` warns instead of failing: the link is a
convenience, and a path holding something that is not ours is left exactly as it was. With
two skills, a conflict on one must not affect the other.

`pnpm play:init` re-runs `init --force` **over** the existing playground rather than deleting
it, which is exactly the situation these cases need.

**Setup** — once, for every case in this scenario. Reuse Scenario 3's playground.

1. Replace one symlink with a real directory holding a file of your own. Leave the other alone.

   ```sh
   rm .dev/playground/.claude/skills/saasaloy-setup && mkdir -p .dev/playground/.claude/skills/saasaloy-setup && printf 'my own skill, do not clobber\n' > .dev/playground/.claude/skills/saasaloy-setup/SKILL.md
   ```

   - [ ] `ls -l .dev/playground/.claude/skills/` shows `saasaloy-setup` as a **directory** and `saasaloy-landing-copy` still as a link

- [ ] Setup complete

### TC-4.1 — `init` warns for that skill only, leaves it intact, exits 0 · 🔴 Critical

**Goal** — a conflict on one skill is reported without clobbering, does not fail the scaffold, and does not take the other skill's link down with it.

**Steps**

1. Re-run `init` over the existing playground.

   ```sh
   pnpm play:init; echo "exit=$?"
   ```

   - [ ] `exit=0`, so the conflict did not fail the scaffold

2. Read the output.
   - [ ] A **warning** names `.claude/skills/saasaloy-setup` and tells you how to recover
     - says it already exists and is not ours
     - says to remove it, then re-run to link the skill
     - it is a warning, not an error or a stack trace
   - [ ] The blast radius is one skill
     - no `Skill links` success line for `saasaloy-setup`, and no `/saasaloy-setup` in `Next steps`
     - `saasaloy-landing-copy` **is** still reported as linked and still appears in `Next steps`

3. Confirm your file survived.

   ```sh
   cat .dev/playground/.claude/skills/saasaloy-setup/SKILL.md && ls -l .dev/playground/.claude/skills/
   ```

   - [ ] It still reads `my own skill, do not clobber`, and the path is still a directory, not a symlink

4. Confirm the real skill files are where they belong.

   ```sh
   ls .dev/playground/.agents/skills/saasaloy-setup/
   ```

   - [ ] `SKILL.md` is there, because losing the link costs discovery and not files

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-4.2 — A deleted link is re-created by the next `init` · 🟢 Low

**Goal** — the recovery the warning suggests actually works, and a repeat run is idempotent.

**Steps**

1. Follow the warning's own advice.

   ```sh
   rm -rf .dev/playground/.claude/skills/saasaloy-setup && pnpm play:init; echo "exit=$?"
   ```

   - [ ] `exit=0`, both skills are back in the `Skill links` note with `saasaloy-setup` first, both appear in `Next steps`, and there is no warning this time

2. Confirm the links.

   ```sh
   ls -l .dev/playground/.claude/skills/
   ```

   - [ ] Both point into `../../.agents/skills/`

3. Run `init` once more, changing nothing.

   ```sh
   pnpm play:init; echo "exit=$?"
   ```

   - [ ] `exit=0`, the note still reports both links, still no warning, so a second run is idempotent rather than a conflict with itself

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

1. Start from the branch's working tree so the reverts below are unambiguous.

   ```sh
   git status --short
   ```

   - [ ] The listed files are the ones this branch changed, and nothing else is modified under `packages/cli/` or `scripts/`

- [ ] Setup complete

### TC-5.1 — `verify:content` fails on copy put back into a block or the page · 🟡 Normal

**Goal** — the guard bites in the repo, on the real paths, so the regression it exists for cannot land green.

The icon registry added 41 kebab-case string keys to `feature-grid.tsx`. None is prose, so the
scanner should stay quiet about them, which step 1 confirms.

**Steps**

1. Confirm the clean baseline.

   ```sh
   pnpm verify:content; echo "exit=$?"
   ```

   - [ ] `exit=0`, reporting `8 block(s) + packages/cli/templates/base/apps/web/src/pages/index.astro clean`, with no finding against the new icon keys

2. Put three literals back into
   `packages/cli/templates/base/packages/ui/src/blocks/pricing-table.tsx` by hand, one per rule:
   - rule A — `title = landing.pricing.title,` → `title = "Pricing that stays out of the way",`
   - rule B — `{ui.pricing.featuredBadge}` → `Most popular`
   - rule C — `aria-label={ui.pricing.billingPeriodLabel}` → `aria-label="Billing period"`

   - [ ] All three edited and saved

3. Run the guard.

   ```sh
   pnpm verify:content; echo "exit=$?"
   ```

   - [ ] `exit=1` with **3** findings, one per rule, at the lines you actually edited
     - each names the file, the line, the rule (`A prose string literal`, `B text in JSX`, `C aria-label literal`) and the offending text
   - [ ] The failure tells you where to move them, and to use `interpolate()` rather than a template literal

4. Now test the page. Add `<p>Ship your product faster</p>` just after `<main>` in
   `packages/cli/templates/base/apps/web/src/pages/index.astro`, then run the guard again.

   ```sh
   pnpm verify:content; echo "exit=$?"
   ```

   - [ ] A finding names `index.astro` with `B text in JSX`, so the composing page is scanned and not just the blocks

5. Break a rule on purpose to prove the self-test runs first. In `scripts/verify-content.ts`,
   make `isProse` `return false;` on its first line.

   ```sh
   pnpm verify:content; echo "exit=$?"
   ```

   - [ ] `exit=1` with a **self-test** failure naming rule A and its own fixture, not a clean pass and not a report about `pricing-table.tsx`
   - [ ] It says plainly that the scanner is broken, so a clean run would prove nothing

6. Revert everything.

   ```sh
   git checkout -- scripts/verify-content.ts packages/cli/templates/base/packages/ui/src/blocks/pricing-table.tsx packages/cli/templates/base/apps/web/src/pages/index.astro && pnpm verify:content; echo "exit=$?"
   ```

   - [ ] `exit=0` and clean again, with `git status --short` back to the branch's own changes

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-5.2 — A missing `id` fails to compile; an unknown icon name falls back · 🟡 Normal

**Goal** — the two halves of the content contract: `id` is required at compile time, while a bad `icon` name degrades to the fallback glyph instead of breaking the page.

The root gate does **not** typecheck the template: `packages/cli/tsconfig.json` includes only
`src`, and the base is not a workspace member. `pnpm deps:verify` is the only command that
compiles `templates/base/**`, and it destroys and re-scaffolds `.dev/playground` on the way,
which is why an unattended agent must not run it.

**Steps**

1. Confirm the declarations are non-optional.

   ```sh
   grep -n '^  id: string;' packages/cli/templates/base/packages/ui/src/blocks/feature-grid.tsx packages/cli/templates/base/packages/ui/src/blocks/faq.tsx packages/cli/templates/base/packages/ui/src/blocks/pricing-table.tsx
   ```

   - [ ] All three show `id: string;`, and none shows `id?: string;`

2. Delete the `id: "outgrow",` line from the last `landing.faq.items[]` entry in
   `packages/cli/templates/base/packages/ui/src/content/landing.ts`.
   - [ ] Saved

3. Compile the template. This re-scaffolds and rebuilds `.dev/playground` and needs network.
   Allow a few minutes.

   ```sh
   pnpm deps:verify; echo "exit=$?"
   ```

   - [ ] It **fails** with a TypeScript error about a missing `id` on the FAQ items, naming `faq.tsx` or `landing.ts`, findable from the message alone

4. Revert and confirm green.

   ```sh
   git checkout -- packages/cli/templates/base/packages/ui/src/content/landing.ts && pnpm deps:verify; echo "exit=$?"
   ```

   - [ ] `exit=0`, with `git status --short` back to the branch's own changes

5. Now the icon half. Edit the **playground's** copy, not the template's. In
   `.dev/playground/packages/ui/src/content/landing.ts`, change the first feature's
   `icon: "zap"` to `icon: "mortarboard"`, a name the registry does not hold. Rebuild the
   playground only.

   ```sh
   pnpm -C .dev/playground build && pnpm -C .dev/playground/apps/web preview
   ```

   - [ ] The build exits 0, because an unknown icon name is not a type error
   - [ ] The first card renders the generic sparkle while the other five keep their own icons, so it is not a blank space and not a crash

6. Prove the louder failure is still loud. Delete the whole `icon: "layers",` line from the
   second feature and rebuild.

   ```sh
   pnpm -C .dev/playground typecheck; echo "exit=$?"
   ```

   - [ ] `exit=1` with a TypeScript error about the missing `icon` property, which is the deliberate trade: a wrong name degrades quietly, a missing field does not

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — leave `.dev/playground` as it is; it is scratch. Confirm the repo itself carries
only this branch's changes before signing off.

```sh
git status --short
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and
sign-off._

All checks below ran this session against the working tree described in **Environment**.

**1. The template compiles and builds from a clean scaffold**

```sh
pnpm play:reset && pnpm -C .dev/playground install && pnpm -C .dev/playground typecheck && pnpm -C .dev/playground build
```

- ✅ All four green. `@repo/ui:typecheck` passed, and Astro built 3 pages. This is the proof
  that all 41 lucide imports in the new icon registry resolve: a missing export would fail
  `tsc` before the build started.
- ℹ️ Run during implementation, before this plan was written. Not re-run here, per the rule
  against an agent destroying the state a human is about to test.

**2. The repo's own gate**

```sh
pnpm typecheck && pnpm verify:content
```

- ✅ `typecheck` exit 0, covering `scripts/` and the CLI's `src/`.
- ✅ `verify:content` exit 0 — `8 block(s) + …/index.astro clean`. Reaching that line means all
  16 self-test fixtures passed first. The 41 new kebab-case icon keys in `feature-grid.tsx`
  trip no rule, which is TC-5.1 step 1's expectation.
- ℹ️ `pnpm lint` runs no task in this repo (`No tasks were executed`), so there is nothing to
  report from it.

**3. The rendered demo page is unchanged by the icon and href move**

```sh
grep -o 'lucide-[a-z-]*' .dev/playground/apps/web/dist/index.html | sort -u
```

```sh
grep -o 'href="[^"]*"' .dev/playground/apps/web/dist/index.html | sort | uniq -c
```

- ✅ The six feature glyphs are `zap`, `layers`, `terminal`, `shield-check`, `cloud`, `gauge` —
  the same six the id-keyed map produced before the change, and no `sparkles`.
- ✅ Href counts unchanged: `3 × "/"`, `5 × "#cta"`, `3 × "#pricing"`, `2 × "#features"`,
  `2 × "#faq"`, plus `/terms` and `/privacy`.
- ⚠️ **Not** a byte-for-byte HTML comparison against `main`. The previous revision of this plan
  recorded one at `207e91e`; those artifacts no longer exist and rebuilding both sides would
  mean destroying the playground. TC-1.2 is the human check that stands in for it.

**4. The client bundle did not grow**

```sh
grep -oh 'lucide-[a-z-]*' .dev/playground/apps/web/dist/_astro/*.js | sort -u
```

- ✅ No icon component reaches any client chunk. `FeatureGrid` takes no `client:*` directive, so
  the registry is read at build time only. Total `_astro/*.js` is 261,610 bytes across 8 files,
  in line with the 261,452 recorded before this change.

**5. Every icon name in content exists in the registry**

```sh
node --input-type=module -e "import {readFileSync} from 'node:fs'; const b='packages/cli/templates/base/packages/ui/src/'; const c=readFileSync(b+'content/landing.ts','utf8'), g=readFileSync(b+'blocks/feature-grid.tsx','utf8'); const reg=[...g.matchAll(/^  \"?([a-z-]+)\"?: ([A-Za-z]+Icon),$/gm)].map(m=>m[1]); const used=[...c.matchAll(/icon: \"([a-z-]+)\"/g)].map(m=>m[1]); console.log(reg.length, used.join(','), used.filter(n=>!reg.includes(n)).join(',')||'(none unknown)')"
```

- ✅ Registry holds **41** names. Content uses 6, all present, none falling back.

**6. The three outbound hrefs are in content and the anchors are not**

```sh
grep -n 'href: "' packages/cli/templates/base/packages/ui/src/blocks/*.tsx
```

- ✅ `navbar.ctaHref`, `cta.primaryActionHref` and `cta.secondaryActionHref` are the only hrefs
  now read from `landing.ts`, shipping as `#cta`, `/` and `/`.
- ✅ Every remaining hardcoded `href:` in a block is a same-page anchor or a legal page:
  `#features`, `#pricing`, `#faq`, `#cta`, `/terms`, `/privacy`, across `navbar.tsx`,
  `hero.tsx` and `footer.tsx`. The exception is scoped to outbound destinations, as
  TC-2.4 step 4 checks from the other side.

**7. Both skills' structural claims about themselves**

- ✅ ADR 0014: each frontmatter `name:` matches its folder and its installed link name, both
  `saasaloy-` prefixed, frontmatter limited to `name:` + `description:` in the "… Use when …"
  shape.
- ✅ `saasaloy-setup`'s write-surface table lists **3** paths, and its Boundaries section points
  back at that table as the whole list rather than restating it.
  `saasaloy-landing-copy`'s table lists **4**, and its Boundaries section names all four again
  in prose, so the two places a future agent reads for permission agree. Neither document
  contradicts the other on `siteName` or `lang`.
- ✅ `saasaloy-landing-copy`'s description states it needs the brief and names `saasaloy-setup`,
  which is what makes TC-1.3's hand-off reachable by routing rather than by luck.
- ℹ️ Whether either agent *obeys* its own text is Scenarios 1 through 4. Nothing here is
  evidence of behaviour.

**8. `init` links and orders both skills**

```sh
pnpm play:init
```

- ✅ The `Skill links` note reports both symlinks with `saasaloy-setup` first, and `Next steps`
  lists `/saasaloy-setup` above `/saasaloy-landing-copy`. Before the `SKILL_ORDER` sort,
  `readdir` returned them alphabetically, which put the copy skill first.
- ✅ `.gitignore:26:.claude/skills/` ignores the links while `.agents/skills/**` stays tracked.
- ℹ️ TC-4.1 and TC-4.2 cover the conflict and missing branches; both mutate state, so they are
  the human's.

**9. Carried forward from the previous revision, still true**

- ✅ `interpolate()` substitutes a known token, leaves an unknown one visible, and passes
  `{constructor}` / `{toString}` / `{__proto__}` through untouched.
- ✅ `{siteName}` is honoured in exactly four `landing.*` strings: `meta.title`,
  `meta.description`, `hero.description`, `cta.description`.
- ✅ `@repo/ui` exports `"./content/*"`, so `@repo/ui/content/landing` resolves.
- ✅ `feature-grid.tsx` still looks its icon up through `Object.hasOwn`, so a name of
  `constructor` or `toString` cannot resolve to an inherited function that slips past the
  `SparklesIcon` fallback. Only the map's keys changed, from feature ids to icon names.

## Not covered / needs human judgment

- **The interviews themselves, which are the point of the issue.** An interview needs a
  respondent, so no unattended run can discharge them. Nothing above is evidence that either
  skill *behaves*, only that its text says the right things and the code it writes compiles.
  TC-1.4 and TC-1.6 are the only proof there will ever be.
- **Whether the sample answers are any good.** TC-1.4 step 4 asks a human to judge whether three
  samples are genuinely different and genuinely derived from the brief so far. There is no
  linter for "this sample would fit any product on the internet", which is exactly the failure
  mode that makes samples worse than a blank prompt.
- **Whether the copy is any good.** TC-1.9 is a human reading prose.
- **Everything visual.** The dev box is headless, so the rendered page, the feature glyphs, the
  re-flowed footer and non-Latin rendering are the human's alone (TC-1.2, TC-1.10, TC-3.1).
- **`ui.*` translation quality.** The workflow now translates chrome with a copy agent rather
  than a translator. The plan checks that keys and `{token}`s survive; it cannot check that the
  Bangla is right. The skill records this in the brief's **Known gaps** for exactly that
  reason, and TC-1.7 step 4 confirms the record exists.
- **A byte-for-byte HTML comparison against `main`.** See automated check 3. Rebuilding both
  sides needs the playground destroyed twice, so TC-1.2 stands in for it.
- **The template's compiler.** The root gate does not typecheck `templates/base/**`.
  `pnpm deps:verify` is the only thing that does, and it destroys the playground, so TC-5.2 is
  a human case.
- **`verify:content` is a guard, not a proof.** Textual, with no TypeScript parser. It catches
  the three shapes it knows and can miss an exotic one. Green means no *known* drift shape.
- **The hero's `#pricing` anchor after a pricing-block removal.** `hero.tsx` carries
  `href: "#pricing"` on its secondary action, and an anchor is structure, so no blank label
  gates it. The removal recipe names two edits and does not mention it. TC-2.3 step 7 and
  TC-3.1 step 1 ask the human to observe it; neither fixes it. Judge whether it needs a
  follow-up issue.
- **`theme.ts`'s labels stay English in every language.** Deliberately out of scope: the file is
  inlined verbatim into a pre-paint `<script>` and is import-free on purpose. Worth its own
  issue now that the rest of the chrome translates.
- **No webfont for non-Latin scripts.** The template loads none; `font-sans` is the system
  stack. The workflow must *report* this gap, not close it. TC-1.4 step 8 confirms the report,
  TC-1.10 step 4 the rendering.
- **`init`'s unreadable-skills-directory warning has no manual case.** Verified at the helper
  level previously, but not reachable through the CLI: `copyTemplate` writes into
  `.agents/skills/` before `linkAgentSkills` reads it, so a `chmod 000` there fails the copy
  first.
- **Concurrency, performance and security.** Deliberately skipped. This branch adds no endpoint,
  request handler, auth path or user-input surface. It moves string constants between files in
  a static-site template and adds a sort to one CLI list. The client bundle figure in check 4 is
  the only performance number this change has.
- **Windows.** `createDirLink` takes a `junction` branch on `win32` that nothing here exercises.
- **Other agents.** Both skills are discovered through `.claude/skills`, so this plan tests them
  under Claude Code only. `.agents/skills/` is the vendor-neutral home per ADR 0015, but no
  other runtime was tried.
