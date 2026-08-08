# Plan — landing copy interview skill

Grilled: 2026-08-08

Tracked: [#61](https://github.com/mimukit/saasaloy/issues/61)

## Context

`saasaloy init` scaffolds a landing page composed from seven `@repo/ui` blocks carrying
demonstration copy — "Acme", "The SaaS you meant to build, already scaffolded.", a browser tab
reading `my-app — ship your SaaS, not your scaffolding`. Every project that runs `init` faces the
same chore: replace those words with words about their actual product. It is a chore an agent does
well **if** it is first made to understand the product, and badly if it guesses.

This adds a skill that **interviews the project owner, then rewrites the landing copy from the
answers** — shipped inside the base so every scaffolded project has it on day one.

Three things make the shape of the work more than "write a skill":

1. **The copy has nowhere good to live.** It sits as in-file defaults across seven `.tsx` files, so
   a rewrite means seven edits and a re-run means seven diffs.
2. **Half the visible strings are not props at all.** `pricing-table.tsx` renders `Monthly`,
   `Annual`, `Custom`, `/month`, `Most popular` and `aria-label="Billing period"` as bare literals
   in markup; `navbar.tsx` has `Open menu` / `Close menu` / `aria-label="Mobile"`. No prop, no
   default, no way to reach them. A props-only extraction leaves them behind.
3. **A translation module (Bangla + English) is planned (#73).** Every credible i18n library —
   Paraglide, i18next, Intlayer, Lingui — reads from a flat keyed record of strings. Copy embedded
   in JSX defaults is the worst possible starting point for that, and ADR 0022 makes base files a
   **one-time gift** with no `--diff` update path, so every project scaffolded before the
   translation module lands would pay the extraction individually.

So this issue introduces the content surface the copy skill writes into, shaped so the future
translation module inherits a mechanical transform rather than an archaeology dig.

Success: an owner runs `init`, invokes one skill, answers questions about their product, and gets a
landing page that builds and reads like it was written for that product — and a translation module,
whenever it arrives, finds one file to split per locale.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the skill lives | Ships in the base template at `_agents/skills/saasaloy-landing-copy/`, committed per ADR 0015. `init` gains a skill-link step so `.claude/skills/saasaloy-landing-copy` exists the moment scaffolding finishes. |
| Skill shape | **One `SKILL.md`.** All five existing `saasaloy-*` module skills are single files (73–396 lines); `saasaloy-email` proves length is tolerated. No sub-files, no second skill. |
| Where the copy lives | A new **content module**, `packages/ui/src/content/landing.ts`, imported *directly by each block* — not passed through `.astro`. Needs `"./content/*": "./src/content/*.ts"` added to `packages/ui`'s `exports`, which currently stops at `./blocks/*`. |
| Why not props from the page | Astro serializes island props, so feeding a content object into `Navbar`, `PricingTable` and `Faq` would write those strings into the HTML payload *and* leave defaults in the bundle. Direct import keeps static blocks at zero JS and preserves ADR 0022's JS budget. |
| Two namespaces, one file | `landing.*` is marketing copy and the **entire** surface the skill may write. `ui.*` is chrome and a11y labels (`Monthly`, `Most popular`, `Close menu`, `Billing period`) which the skill never touches and #73 needs. One file keeps the shape uniform; the namespace is what makes the skill's boundary expressible. |
| Pricing tiers | The **whole `tiers` array moves into content** — ids, prices, `featured`, `ctaHref` included — as objects each carrying a stable `id`. The block holds no tier data. This is a deliberate exception to "only translatable strings move", bought because it makes the skill's write surface a single file and gives #73 the per-locale price override it already flagged. |
| The skill's write surface | Exactly two files: `packages/ui/src/content/landing.ts` and `packages/ui/src/index.ts` (`siteName`). `landing.meta.title` / `.description` move into content carrying `{siteName}` tokens, so `index.astro` reads from content and carries no copy of its own. |
| `siteName` | Stays in `packages/ui/src/index.ts` as the **untranslated brand constant**. A brand name is a variable, not a message — putting it in the catalog would duplicate it into every locale for nothing. |
| Target i18n library | **Not named.** This plan records content-shape rules only; the library is the translation module's own decision (#73). |
| Source language | The skill writes in the language the owner names, **not English only** — and sets `<html lang>` in `Layout.astro` to match, since it is hardcoded `en` today. The base ships no Bengali webfont; that gap is recorded in the brief as a known follow-up, not papered over. |
| Interview persistence | `docs/product-brief.md` in the scaffolded project — committed, human-editable, re-read on re-run. The base ships **no `docs/` directory at all**, so the brief's existence is an unambiguous signal. |
| Push-back rule | Bounded: at most **two follow-ups per dimension**, then the thin answer is recorded in the brief tagged `weak:` and the copy declines that claim rather than inventing support for it. |
| Re-run guard | The brief is the source of truth; git is advisory. `init` never runs `git init`, so a clean-tree gate is unenforceable exactly when the risk is highest. Dirty or absent repo warns; every write is previewed as a diff and confirmed. Never refuses, never writes unasked. |
| Block removal | Permitted, behind its **own** confirmation, separate from the copy write. Dropping a `<PricingTable />` line from `index.astro` is an edit, not a redesign — and the alternative is shipping invented prices. |
| Enforcement | `scripts/verify-content.ts` + `pnpm verify:content`, following `scripts/verify-css.ts`'s shape and `verify:preset`'s manual-only precedent. Fails on any user-visible string literal or template-literal message left in `src/blocks/*.tsx`. |
| Sequencing | **Blocked by PR [#68](https://github.com/mimukit/saasaloy/pull/68)** (`feat(ui): theme switcher for light/dark and shadcn theme presets`, issue #64) — it already rewrites base `AGENTS.md`, `index.astro` and `Layout.astro`, and adds an eighth block. This work rebases on it and lands **before** [#60](https://github.com/mimukit/saasaloy/issues/60). |
| Relationship to #60 | **Settled, and #60 has been corrected to match.** Both plans previously claimed the other built the content surface, so as written neither did. #61 owns the content module and lands first; #60 rebases on it, its eight reworked blocks keep reading from it, and its six new ones add keys rather than carrying in-file defaults. #60's `Content` rubric row — *"no string a founder must hunt for in markup"* — is what `verify:content` mechanizes. |

### The content-shape rules, and why each exists

These are the load-bearing part. Each one prevents a specific future failure:

- **Max three levels.** Compiler-based libraries (Paraglide) emit one flat function identifier per
  message and have no notion of nested objects. `landing.features.items.speed.title` becomes
  `features_items_speed_title`; `landing.features.speed.title` becomes `features_speed_title`.
  Three levels is the shape that reads well flat *and* nests idiomatically for i18next.
- **Position is never the key.** Keying by array index means Bangla copy silently reattaches to the
  wrong feature the first time someone reorders the grid. An **array whose items each carry a
  stable `id`** satisfies this — `tiers[].id === "pro"` survives reordering, `tiers[1]` does not.
  The rule forbids positional keys, not arrays; that distinction is what lets pricing tiers stay an
  ordered list without breaking the three-level rule.
- **Placeholder tokens, not template literals.** Today's copy interpolates with
  `` `${siteName} gives your product…` ``. A catalog is **data** — a function is not serializable to
  JSON and no extraction tool can read it. Single brace is the safer default: `{x}` → `{{x}}` is a
  regex, the reverse risks eating literal braces. Needs a ~5-line `interpolate()` helper in
  `packages/ui/src/lib/interpolate.ts`, reachable through the existing `./lib/*` export.
- **No runtime concatenation.** `` `/month{annual ? ", billed annually" : ""}` `` becomes two whole
  messages, `ui.pricing.perMonth` and `ui.pricing.perMonthAnnual`. Bangla word order does not
  preserve the fragment boundary, so a sentence assembled at render time cannot be translated.
- **Only translatable strings move — with pricing as the named exception.** `href`, `icon` (a React
  component, which cannot cross the `.astro` boundary anyway) and section `id`s are structure and
  stay in the block. Pricing tiers move wholesale because the skill must rewrite them end to end;
  the exception is stated rather than smuggled.

## Approach

**Size.** This is a large issue — a content refactor across eight blocks, a new verify script, a CLI
change, a skill, and an end-to-end proof. It was kept whole deliberately (the extraction is done
once whichever issue carries it), but it will not fit one worktree session comfortably. issuekit
should expect to file it with a phase-shaped checklist rather than split it.

### What it reuses

- **`createDirLink` / `classifyLink`** (`packages/cli/src/lib/fs-utils.ts`) — cross-platform dir
  symlink with a Windows junction fallback, already used by `add` through `applier.ts`. `init` calls
  the two helpers directly rather than the applier path, because `init` writes no manifest and ADR
  0022's pure-copy property should stay intact.
- **`copyTemplate`'s `_foo` → `.foo` convention** (`packages/cli/src/lib/scaffold.ts`) — applies to
  directories as well as files, so the skill ships as `_agents/` in the template and lands as
  `.agents/`. No scaffold change needed.
- **The base's existing gitignore entry** for `.claude/skills/` — already there for `add`; the init
  link inherits it with no edit. This is also why the skill cannot simply ship at `_claude/skills/`:
  it would land gitignored and the owner's repo would never commit it.
- **`scripts/verify-css.ts`** — the shape `verify-content.ts` copies: a TypeScript script under the
  root `typecheck:scripts` gate, asserting something `build` cannot see.
- **`pnpm verify:preset`** (#64) — the precedent for a manual-only gate that stays out of
  `deps:verify`.
- **Module skill conventions** — `saasaloy-` prefix (ADR 0014), frontmatter `name`/`description`
  shape, "Boundaries to honor" section, as established by `modules/*/skills/saasaloy-*/SKILL.md`.
- **The blocks' existing prop interfaces** — every prop stays; only the *default source* changes, so
  a second landing page can still override per-page and #60's "copy reachable through props" rubric
  row is satisfied rather than broken.

### Phase 1 — the content module

Rebase on PR #68 first, then introduce `packages/ui/src/content/landing.ts` and refactor the blocks
to read their defaults from it.

- Add `"./content/*": "./src/content/*.ts"` to `packages/ui/package.json`'s `exports`.
- Author the content module with two namespaces — `landing.*` (marketing) and `ui.*` (chrome and
  a11y) — per the shape rules, carrying today's demonstration copy verbatim so the rendered page is
  byte-identical before and after.
- Add `interpolate()` to `packages/ui/src/lib/interpolate.ts` and use it wherever copy currently
  uses a template literal (hero, cta, footer, and the page title).
- Move the `tiers` array out of `pricing-table.tsx` into `landing.pricing.tiers` as objects with
  stable `id`s; the block reads it and holds no tier data.
- Sweep every block for in-markup literals and route them through `ui.*` — including `theme-toggle`,
  which arrives with #68. Split `/month{annual ? …}` into two whole messages.
- Move the page title and description into `landing.meta.*` with `{siteName}` tokens; `index.astro`
  interpolates and carries no copy.
- Update the base `AGENTS.md` block conventions — the "copy as in-file defaults" bullet is replaced
  by the content module, with the shape rules documented so an agent editing a block later does not
  reintroduce a hardcoded string.
- Gate: `pnpm deps:verify` (the base is not a workspace member, so the playground build + typecheck
  is the only real gate), plus a visual check that the page is unchanged.

### Phase 2 — the enforcement gate

- Add `scripts/verify-content.ts`: parse `packages/cli/templates/base/packages/ui/src/blocks/*.tsx`
  and fail on any user-visible string literal (JSX text, `aria-label`, `alt`, `title`,
  `placeholder`) or template-literal message that isn't sourced from the content module.
- Wire `pnpm verify:content`, manual-only like `verify:preset`, under the existing
  `typecheck:scripts` gate.
- Gate: green against the Phase 1 refactor; documented in `AGENTS.md` so #60's six new blocks
  inherit it.

### Phase 3 — ship the skill in the base

- Author `packages/cli/templates/base/_agents/skills/saasaloy-landing-copy/SKILL.md` as a single
  file.
- Add a skill-link step to `runInit`: after `copyTemplate`, read `<target>/.agents/skills/`,
  `classifyLink` each entry, `createDirLink` the `missing` ones, report `conflict` without
  clobbering. No manifest entry. A link failure warns; it never fails `init`.
- Mention the skill in `init`'s "Next steps" note, so an owner who just scaffolded knows it exists
  without reading `AGENTS.md` first.
- Reference it from the base `AGENTS.md`.

### Phase 4 — the interview

The differentiator over a one-shot "write me landing copy" prompt. The skill extracts specifics
before writing anything:

- **Dimensions**: audience, the problem, what they do about it today (the real alternative, which is
  usually a spreadsheet or nothing), the differentiator, proof the owner can actually stand behind,
  tone, and the language their audience reads.
- **Push back, bounded.** An answer is **weak** if it names no audience, no number, no named
  alternative, or no proof the owner could point at. "Everyone" is not an audience; "it's faster" is
  not a differentiator. At most two follow-ups per dimension, then the answer is recorded as
  `weak: <verbatim>` and the copy declines that claim rather than inventing support for it.
- **Pricing is extracted, never invented** — tier names, what each is for, and real prices, or an
  explicit "leave pricing as placeholder" answer.
- Answers are written to `docs/product-brief.md`, including the recorded source locale.

### Phase 5 — the rewrite

- Write the interview's output into `packages/ui/src/content/landing.ts` and
  `packages/ui/src/index.ts` (`siteName`). Nothing else.
- Set `<html lang>` in `Layout.astro` to the recorded locale. If it isn't `en`, note in the brief
  that the base ships no webfont for that script.
- **State the anti-AI-writing bar inline.** The scaffolded project has no access to this repo's
  humankit skill, so the `SKILL.md` must carry the bar itself: no abstract benefit nouns, no
  rule-of-three cadence, no claim so hedged nobody could disagree with it, no em-dash tics.
- **Declare what it will not touch**: block internals, layout, design tokens, `globals.css`,
  component markup, `href`s, terms/privacy, and the `ui.*` namespace.
- **Block removal is a separate confirmation.** When the interview yields nothing a block can
  honestly carry, the skill may propose dropping that block's line from `index.astro` — proposed on
  its own, never bundled into the copy write, never silent.
- Gate: build the project so the deliverable is a page that compiles, not a markdown draft.

### Phase 6 — re-run without clobbering

- On re-run, read `docs/product-brief.md` first and ask only what changed — including anything
  tagged `weak:`, which is the thread a second pass should pick up.
- Git is advisory: a dirty or absent repo warns and explains why, and the run continues.
- Show the diff and confirm before every write. Content that differs from a fresh `init` with no
  brief present is the "someone already wrote this" signal — the skill says so and asks rather than
  overwriting.

### Phase 7 — prove it

- Run the whole flow against a fresh `.dev/playground`: `pnpm play:reset`, invoke the skill, answer
  as a real product, build, and show the resulting page.
- Run it a **second** time to exercise Phase 6's re-run path against a brief that already exists.
- Record a qakit manual QA plan and results under `docs/qa/`, covering what the verify script
  cannot judge: whether the copy reads like a real product and clears the anti-AI-writing bar.

## Deferred, and where it went

Not open questions — decisions consciously routed elsewhere.

- **Locale-varying prices.** A Bangladesh market likely wants different tiers entirely, not a
  converted number. Tiers now live in content, which gives #73 the override point; the policy is
  #73's to set.
- **A Bengali webfont.** `Layout.astro` loads none and `font-sans` is the system stack. The skill
  reports the gap; #73 owns closing it.
- **Amending #60.** Done — its plan and issue body both claimed it built the content surface and
  sequenced #61 after itself. Both are corrected: #60 is now `Blocked by #64 and #61`.

## Non-goals

- **Picking the i18n library.** The translation module (#73) owns that decision; this plan
  constrains the content shape only.
- **Shipping any i18n machinery** — no locale routing, no catalogs, no second-locale copy, no font
  loading. The content module is monolingual, though not English-only.
- **Generating imagery or logos.**
- **SEO strategy, keyword research, content marketing** beyond the page's own title and description.
- **Copy for pages other than the landing page** — terms and privacy stay boilerplate.
- **Redesigning the blocks.** Visual quality and the production-readiness bar are #60's job. The
  skill may drop a block from the page with consent; it never edits a block's internals.
- **Retiring the sections glob** — that is #62.
- **Rewriting README.md** or package names.
