---
name: saasaloy-landing-copy
description: Write the scaffolded landing page's copy from docs/product-brief.md — as a markdown draft the owner reviews first, then into the content module. Use when the landing page still says "Acme" or "The SaaS you meant to build", when the owner asks to write, rewrite, improve or update the landing copy, headline, features, pricing or FAQ, and when re-running after the brief changed. Needs docs/product-brief.md; run saasaloy-setup first if there isn't one.
---

# saasaloy-landing-copy — draft it in markdown, then write the page

Copy is a chore an agent does well **if** it is first made to understand the product, and
badly if it guesses. Understanding the product is not this skill's job: `saasaloy-setup`
already interviewed the owner and left `docs/product-brief.md` behind. This skill turns
that brief into words.

It does it in two passes, and the order matters. **First a markdown draft** the owner can
read end to end in one screen and edit in place. **Then** the content module, once they say
yes. A page of thirty keys reviewed as thirty terminal messages is a page nobody actually
reviewed.

## The write surface

| Path | What you change |
|------|-----------------|
| `docs/landing-copy-draft.md` | The draft. Written every run, deleted once the copy lands. |
| `packages/ui/src/content/landing.ts` | Everything under `landing.*`. Plus `ui.*`, **translated only**, and only when the page is not in English — see [Language](#language-and-the-ui-namespace). |
| `apps/web/src/pages/index.astro` | Only to drop a block, and only behind its own confirmation. |
| `docs/product-brief.md` | Only to append what you learned filling a gap the brief left, and only its **Known gaps** section otherwise. |

Nothing else — in particular not `siteName` and not the page's `lang` attribute. Those are
project identity, `saasaloy-setup` owns them, and [Step 0](#step-0--before-you-write-anything)
says what to do when they disagree with the brief.

## Step 0 — before you write anything

1. **Read `docs/product-brief.md`.** No brief, no copy. Say so and offer to run
   `saasaloy-setup`:

   > There's no `docs/product-brief.md`, so I'd be writing about a product I know nothing
   > about. `/saasaloy-setup` asks ten questions and leaves the brief behind; then this
   > takes about a minute. Want me to run it now?

   Do **not** improvise your own interview. Two skills asking overlapping questions is how
   an owner ends up answering the same thing twice and getting two different pages.
2. **Read `packages/ui/src/content/landing.ts`.** You need the current copy to diff against,
   and its comments carry the shape rules you have to keep.
3. **Read the icon registry** at the top of `packages/ui/src/blocks/feature-grid.tsx`.
   Reading a block is fine; editing one is not. Its keys are the whole vocabulary available
   to `landing.features.items[].icon`, and they are the actual list rather than one copied
   into this file that went stale.
4. **Check the two facts you do not own.** If `siteName` in `packages/ui/src/index.ts` is
   still the scaffold's directory slug, or `lang` in `apps/web/src/layouts/Layout.astro` is
   `en` while the brief names another language, say so now and carry both into the draft's
   **Not mine to fix** list. Writing Bangla copy into a page that declares itself English is
   a real defect, and one attribute long. Do not fix it yourself.
5. **Look at git, and treat it as advice.** `git status --short` if there is a repo. A dirty
   tree or no repo is worth one sentence — "your changes aren't committed, so you can't undo
   this with git; the draft is reviewed before anything is written anyway" — and then you
   carry on. **Neither state is a reason to stop.**
6. **If a draft is already on disk**, an earlier run was abandoned or is waiting on the
   owner. Say it is there, summarise it in a line, and ask whether to build on it or start
   over. Never silently overwrite someone's edits.
7. **If the content module has already been rewritten by hand** and the brief does not
   explain it, say so plainly: someone wrote this themselves. Ask whether to work from what
   is there or start over.

## Step 1 — fill only the gaps the brief left

The interview happened. Your questions are limited to what the brief genuinely does not
answer and the page genuinely needs — usually the FAQ, occasionally a feature that has no
evidence behind it. Ask in one batch, and carry **three sample answers plus "write your
own"** on every question, the same way `saasaloy-setup` does: derived from the brief rather
than generic, shapes rather than invented values wherever the answer becomes a claim the
page makes.

Every `weak:` tag in the brief is a standing question, and re-asking one is always fair:

> Last time "it's faster" had no number behind it, so the hero avoided the claim. Do you
> have a benchmark now?

If a gap stays a gap, write around it. Describe what the product does and leave the claim
out. A page that says less is recoverable; a page that says something false about the
product is not.

## Step 2 — write the draft

`docs/landing-copy-draft.md`. Every key, current value beside proposed, in reading order —
so the owner reviews a page, not a data structure.

Three things belong in it besides the copy, because they are the ones an owner catches and
an agent does not:

- **The non-copy decisions.** Each feature's icon name, and where the two calls to action
  point. A wrong icon is invisible in a list of sentences and obvious in a list of icon
  names.
- **What you were working from.** One line per section tying the choice back to the brief.
  This is what makes "no, that's not what I meant" a two-second correction.
- **What you are least sure about**, and **what is not yours to fix.**

```md
# Landing copy draft — Ledgerly

Generated 2026-08-09 from `docs/product-brief.md`.
Edit anything here and tell me to apply it, or tell me what to change and I'll redo it.
This file is deleted once the copy lands in `packages/ui/src/content/landing.ts`.

## Tab and search result
| Key | Now | Proposed |
|-----|-----|----------|
| `meta.title` | {siteName} — ship your SaaS, not your scaffolding | {siteName} — close the month in one place |

`meta.description` (155 char limit, currently 148):
> Ledgerly closes the month for bookkeepers carrying 5–20 client accounts, without four
> spreadsheets per client.

## Hero
| Key | Now | Proposed |
|-----|-----|----------|
| `hero.eyebrow` | Now in early access | In beta with two firms |
| `hero.primaryActionLabel` | Get started | Join the beta |

`hero.title`:
> ~~The SaaS you meant to build, already scaffolded.~~
> **Close the month without four spreadsheets per client.**

*From the brief: the problem line, and "Excel plus a shared Dropbox folder" as the
alternative. The eyebrow uses the two named beta firms rather than a stage name.*

## Features
| # | Icon | Title | About |
|---|------|-------|-------|
| 1 | `list-checks` (was `zap`) | One close, one checklist | … |

## Where the buttons go
| Key | Now | Proposed |
|-----|-----|----------|
| `navbar.ctaHref` | `#cta` | https://ledgerly.com.bd/waitlist |
| `cta.primaryActionHref` | `/` | https://ledgerly.com.bd/waitlist |

## Least sure about
- The eyebrow names your two beta firms. Fine to say publicly?
- FAQ 4 says data exports as CSV. The brief doesn't mention exports; I inferred it.

## Not mine to fix
- `lang` in `apps/web/src/layouts/Layout.astro` is still `en` and the brief says Bangla.
  Run `/saasaloy-setup`, or change the one attribute yourself.
```

If the owner would rather skip the review — "just write it" — that is their call to make
and you take it. Say once what they are giving up, then go straight to
[Step 4](#step-4--write-the-content-module) and show the diff there instead.

## Step 3 — the owner reviews

Hand them the path and stop. Do not narrate the whole draft back into the terminal; the
point of the file is that it is not the terminal.

> Draft's at `docs/landing-copy-draft.md`. Read it, edit anything you'd rather word
> yourself, then tell me to apply it.

When they come back, **re-read the file from disk** before applying. They may have edited
it, and their wording wins over yours every time.

## Step 4 — write the content module

Show the diff, key by key, old value then new. One confirmation for the file is enough; do
not ask per key. Then write.

Every key below is under `landing.` in `packages/ui/src/content/landing.ts`. Fill all of
them; the layout is built for copy of roughly the length already there, so match it rather
than doubling it.

| Key | What goes there |
|-----|-----------------|
| `meta.title` | Browser tab. `{siteName} — <what it does>`, under 60 characters. |
| `meta.description` | Search result and link preview. One sentence, under 155 characters. |
| `navbar.linkFeatures` `.linkPricing` `.linkFaq` | Nav labels. One or two words. They point at the sections of the same name — keep the meaning, or the anchor lies. |
| `navbar.ctaLabel` `.ctaHref` | Two or three words, a verb first, and where it goes. See [Destinations](#destinations). |
| `hero.eyebrow` | The one-line status above the headline ("Now in early access"). Empty string hides it. |
| `hero.title` | The headline. Under ten words, one idea, concrete. This is the sentence the whole page is judged on. |
| `hero.description` | One or two sentences saying what it does for whom. |
| `hero.primaryActionLabel` `.secondaryActionLabel` | Button labels, a verb first. Both scroll down the page; their hrefs are anchors and stay in the block. |
| `features.title` `.description` | The section's heading and one supporting line. |
| `features.items[]` | Six by default: `{ id, icon, title, description }`. Title 2–4 words; description one sentence about what the owner can *do*, not about the technology. See [Icons](#icons). |
| `pricing.title` `.description` | Heading plus one line. |
| `pricing.annualNote` `.currencySymbol` | See [Pricing](#pricing). |
| `pricing.tiers[]` | `{ id, name, description, monthlyPrice, annualPrice, features, ctaLabel, ctaHref }`. Prices are whole units; `null` renders "Custom". Set `featured` on at most one. A tier's `ctaHref` stays `#cta` unless the brief gives that tier its own destination. |
| `faq.items[]` | Five by default: `{ id, question, answer }`. Write the questions a buyer asks before paying — pricing, migration, lock-in, data, what happens when they outgrow it. One to three sentences, and answer the question. |
| `cta.title` `.description` | The closing ask, plus one line removing a reason to hesitate. |
| `cta.primaryActionHref` `.secondaryActionHref` | See [Destinations](#destinations). |
| `footer.tagline` | One line under the brand. |
| `footer.groupProduct` `.groupLegal` `.link*` | Footer labels. One or two words each. |

Three mechanical rules the code depends on:

- **`{siteName}` is the only placeholder, and it works in exactly four strings**:
  `meta.title`, `meta.description`, `hero.description`, `cta.description`. Anywhere else it
  renders as the literal text `{siteName}`. Never a template literal — copy is data.
- **Feature and FAQ `id`s are stable keys**, not positions. Rewriting a `title` under an
  existing id is free. Renaming an id is allowed but it is a new string to a translation
  layer, so do it only when the item genuinely became a different item.
- **Deleting an item is fine**, in any of the three lists. Fewer than six features and fewer
  than five questions both lay out correctly.

### Icons

Each feature carries an `icon` naming a glyph from the registry at the top of
`packages/ui/src/blocks/feature-grid.tsx`. Rewrite what a feature is about and move its
icon in the same edit — that is the whole reason the name lives in content. A page whose
"practice all four modules" card renders a terminal prompt reads as machine-assembled,
because it was.

- Use a key the registry actually has. Read the map; do not guess from memory. An unknown
  name silently renders the fallback sparkle, which looks like a choice and is not.
- If nothing in the registry fits, say so in the draft and name the lucide icon you would
  want. Widening the map is a two-line edit **the owner makes**, in a block, which is not
  yours.

### Destinations

Three of the page's hrefs are content, and they are the ones that leave the page:
`navbar.ctaHref`, `cta.primaryActionHref`, `cta.secondaryActionHref`. The brief's
**Where "sign up" goes** section is where the answer lives.

- **A URL in the brief.** Write it into `navbar.ctaHref` and `cta.primaryActionHref`.
- **Nothing yet.** Leave them as shipped (`#cta` and `/`) and write labels the page can
  honestly satisfy — "See how it works" rather than "Start your free trial". Note it in the
  draft and in the brief's **Known gaps**. A primary button that reloads the page is the
  single most visible defect this workflow can leave behind, so it does not get to be
  silent.
- **`cta.secondaryActionHref`** is usually docs or an about page. `/` is honest for a
  one-page site; a label promising docs that do not exist is not.

Everything else stays put. `#features`, `#pricing`, `#faq` and `#cta` are anchors matching
section ids, they live in the blocks, and changing one breaks a link.

### Pricing

The brief's **Pricing** section decides this, and it has already been through
`saasaloy-setup`'s "extracted, never invented" rule. Your job is to carry it across without
softening it.

- **Real prices** — write them, and set `currencySymbol` if it is not USD.
- **Placeholder** — leave the shipped tiers exactly as they are and say so in the draft.
- **None yet** — offer to drop the pricing block. That is a
  [block removal](#dropping-a-block-is-its-own-confirmation), with its own confirmation.

`annualNote` is a claim about the two numbers beside it. If there is an annual discount, set
each tier's `annualPrice` to the effective monthly cost when billed annually and make the
note arithmetically true. If there is not, set `annualPrice` equal to `monthlyPrice` and
`annualNote` to `""`. The monthly/annual switch stays on the page — it is chrome, and it now
claims nothing untrue.

Never round, convert currencies, or fill in a typical number.

### The bar this copy has to clear

You are writing without a copy editor, and the failure mode is not bad grammar. It is
fluent, confident, empty text that reads as machine-written. Refuse these, in the copy you
write and in the copy you keep:

- **Abstract benefit nouns as the subject.** "solutions", "experiences", "workflows",
  "innovation", "efficiency". Name what the person does instead.
- **The AI vocabulary.** leverage, unlock, empower, seamless, robust, streamline, elevate,
  cutting-edge, game-changing, effortless, revolutionary, harness, delve.
- **Rule-of-three cadence.** "Faster, simpler, smarter." Three-item lists everywhere is the
  loudest tell there is. Use two, or four, or a sentence.
- **"Not just X — it's Y."** Also "more than just", "isn't only about".
- **Claims nobody could disagree with.** "Built for modern teams." "Designed for how you
  work today." If the opposite is absurd, the sentence is empty.
- **Superlatives with no number behind them.** "Blazing fast", "enterprise-grade",
  "world-class", "industry-leading".
- **Em-dash tic.** At most one em-dash per section. Full stops are free.
- **Every sentence the same length.** Vary it. Let one land in four words.
- **Invented proof.** No statistic, customer name, logo, award, rating or "trusted by
  thousands" that did not come out of the brief. Not one.
- **Second-person promises the product cannot keep.** "You'll never worry about invoices
  again."

Two habits carry more weight than that whole list: use the **owner's own nouns** from the
brief, and **name the current alternative**. "Close the month without four spreadsheets per
client" is a sentence no generator produces, because it required the interview.

### Language, and the `ui.*` namespace

Write in the language the brief names, not English with a translation to follow.

When that language is not English, `ui.*` gets **translated** in the same pass. It is chrome
— "Monthly", "Most popular", "Close menu", the copyright line — and leaving it in English
under Bangla marketing copy ships a visibly broken page. No translation layer exists in the
base to come back for it later, so this is the only pass it gets.

Translated is not rewritten. Four rules:

- **Preserve every `{token}` exactly**: `{currencySymbol}`, `{price}`, `{year}`,
  `{siteName}`. A dropped token is a silently broken price or copyright line.
- **Never rename, add or remove a key.**
- **Never reword a string that stays English.** In an English run, `ui.*` is untouched.
- **Leave `packages/ui/src/lib/theme.ts` alone** regardless. It is inlined verbatim into a
  pre-paint `<script>`, is import-free on purpose, and its labels are a separate decision.

Then record in the brief's **Known gaps**, in one line, that `ui.*` was translated by a copy
agent rather than a translator and is worth a native speaker's read. Also record — once —
that the template loads **no webfont**: `font-sans` is the system stack, so a non-Latin
script renders in whatever face the visitor's device provides. Both are real gaps and
neither is a reason to write the page in English instead.

## Step 5 — prove it, then clean up

A page that does not compile is not a deliverable:

```sh
pnpm --filter @repo/ui typecheck
pnpm build
```

Broken build, broken types: fix it, or revert the write and say what happened. Do not hand
back a red tree.

Then **delete `docs/landing-copy-draft.md`.** It has done its job, and a stale draft beside
a rewritten page is a second source of truth that will disagree within a week. The brief is
the one that persists.

Finally, tell the owner what to look at: `pnpm dev`, the two or three lines you are least
sure about, and anything still on the **Not mine to fix** list.

### Dropping a block is its own confirmation

When the brief yields nothing a block can honestly carry — no pricing, no proof for the FAQ
— you may propose removing that block. **Separately.** Never bundled into the copy write,
never silent.

It is two edits, and both are allowed:

1. Delete that block's line from `apps/web/src/pages/index.astro`.
2. Blank the matching label in content (`landing.navbar.linkPricing = ""`,
   `landing.footer.linkPricing = ""`). A blank label drops the link, so the page keeps no
   nav entry pointing at a section that is gone.

Removing a block is not redesigning one. You are deleting a line from a page, not editing
`packages/ui/src/blocks/`.

## Re-running

Copy on disk plus a brief means this has run before.

1. **Read the brief and the current copy**, and say in a few lines what the page claims
   today.
2. **Ask what changed**, and ask about every `weak:` tag.
3. **Draft again.** The draft's "Now" column is the current copy, so a re-run shows the
   owner exactly what a second pass would move — which is the whole value of the second
   pass.
4. If the copy on disk does not match what the brief would produce, someone edited it by
   hand: say so, show the difference, and ask which wins.

## Boundaries to honor

- **[The write surface](#the-write-surface) is the whole list of files you may touch** —
  nothing outside that table. Two of them carry copy: `packages/ui/src/content/landing.ts`
  (`landing.*` always, `ui.*` translated on a non-English run) and
  `docs/landing-copy-draft.md`, which you write on every run and delete at the end. The
  other two are a consented block removal in `apps/web/src/pages/index.astro` and appended
  gaps in `docs/product-brief.md`.
- **`siteName` and `lang` are not yours.** `packages/ui/src/index.ts` and
  `apps/web/src/layouts/Layout.astro` belong to `saasaloy-setup`. Report a mismatch; do not
  fix it.
- **Never edit a block.** `packages/ui/src/blocks/*.tsx` is off limits: no markup, no
  classes, no structure, no widening the icon registry. Read them freely. If copy will not
  fit a block, say so and let the owner decide.
- **Never touch the design layer** — `packages/ui/src/styles/globals.css`,
  `components.json`, `packages/ui/src/components/*`, or any Tailwind class anywhere.
- **Never rewrite `ui.*`**, in any language. Translate it or leave it.
- **Leave anchors alone.** `#features`, `#pricing`, `#faq`, `#cta` and a tier's default
  `ctaHref` match section ids. The three outbound destinations in
  [Destinations](#destinations) are the exception, and they are the only one.
- **Leave `apps/web/src/pages/terms.astro` and `privacy.astro` alone.** Boilerplate legal
  text is not a copywriting job.
- **No images, logos, icons or screenshots.** Not generated, not sourced, not referenced.
  Choosing an existing icon name is not this.
- **No dependencies, no i18n machinery, no webfonts.** Report the gap; do not close it.
- **Never invent pricing or proof**, and never quietly leave the shipped demo numbers in
  place as if they were real.
- **No interview.** If the brief is missing or thin, hand back to `saasaloy-setup` rather
  than asking its questions yourself. Filling a specific gap the page needs is not this.
- **A dirty tree, a missing repo, or a thin brief is not a blocker.** Warn, write less, and
  say what you left out. (This is about those three conditions only — anything unsafe or
  outside this skill's scope you decline as you normally would.)
