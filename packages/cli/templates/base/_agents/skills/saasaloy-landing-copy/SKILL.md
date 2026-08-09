---
name: saasaloy-landing-copy
description: Interview the project owner about their product, then rewrite the scaffolded landing page's copy from the answers — into the content module, not a draft. Use when the landing page still says "Acme" or "The SaaS you meant to build", when the owner asks to write, rewrite or update the landing copy, headline, features, pricing or FAQ, when setting the site name or the page's language, and when re-running against an existing docs/product-brief.md.
---

# saasaloy-landing-copy — interview first, then write the page

The scaffolded landing page ships demonstration copy. Replacing it is a chore an agent does
well **if** it is first made to understand the product, and badly if it guesses. So this
skill has two halves, in this order: **interview**, then **write**. Skipping the first half
produces the thing everyone recognises — a page of confident sentences about nothing.

The deliverable is a page that **builds**, not a markdown draft. Every word the landing page
shows lives in one file, so a rewrite is one edit.

## The write surface

| Path | What you change |
|------|-----------------|
| `packages/ui/src/content/landing.ts` | Everything under `landing.*`. This is the copy. |
| `packages/ui/src/index.ts` | `siteName` — the brand constant, untranslated. |
| `apps/web/src/layouts/Layout.astro` | The `lang` attribute only, and only if the language is not English. |
| `apps/web/src/pages/index.astro` | Only to drop a block, and only behind its own confirmation (see below). |
| `docs/product-brief.md` | The interview answers. Create the `docs/` directory if it does not exist. |

Nothing else. The `ui.*` namespace in the content module is chrome and accessibility labels
(`Monthly`, `Most popular`, `Close menu`) — it says nothing about the product, so it is not
yours to rewrite.

## Step 0 — before you ask anything

1. **Read `docs/product-brief.md`.** If it exists, this is a re-run: someone has already
   been interviewed. Read it fully, then jump to [Re-running](#re-running).
2. **Read `packages/ui/src/content/landing.ts`.** You need the current copy to diff against,
   and its comments carry the shape rules you must keep.
3. **Look at git, and treat it as advice.** `git status --short` if there is a repo. A dirty
   tree or no repo at all is worth one sentence — "your changes aren't committed, so you
   can't undo this with git; every write here is previewed and confirmed anyway" — and then
   you carry on. `saasaloy init` does not run `git init`, so a clean-tree requirement would
   block exactly the person who just scaffolded. **Neither state is a reason to stop.**
4. **If the content module has already been rewritten** (it no longer matches the shipped
   demonstration copy) **and there is no brief**, say so plainly: someone wrote this by hand.
   Ask whether to work from what is there or start over. Do not overwrite it silently.

## Step 1 — the interview

Seven dimensions. Ask them in **small batches** — two or three questions per message, not
seven at once and not one at a time. Number them so the owner can answer by number.

| Dimension | What you are actually after |
|-----------|----------------------------|
| **Audience** | The specific person who pays. A job title, a team, a situation. |
| **Problem** | What goes wrong for them today, in their words. |
| **Current alternative** | What they use *instead* right now — usually a spreadsheet, a contractor, or nothing. This is the real competitor. |
| **Differentiator** | What this does that the alternative cannot. One thing, not a list. |
| **Proof** | Something the owner can stand behind today: a number, a named customer who agreed to be named, a benchmark they ran, a compliance certificate. |
| **Tone** | How the product should sound. Ask for an adjective *and* a site they think gets it right. |
| **Language** | The language their audience reads, as a name and a code (`en`, `bn`, `es`). Default to English only if they say so. |

Then pricing, which has its own rules — see [Pricing](#pricing-is-extracted-never-invented).

### Push back, at most twice

An answer is **weak** when it names no audience, no number, no named alternative, or no
proof the owner could point at. "Everyone" is not an audience. "It's faster" is not a
differentiator. "Businesses struggle with productivity" is not a problem.

Push back **at most twice per dimension**, and make each follow-up narrower than the last:

> — Who is your audience?
> — Small businesses.
> — Which ones? Think of the last person who asked you for this — what was their job?
> — Bookkeepers, mostly, at firms with 5–20 clients.

If the second follow-up still comes back thin, **stop asking.** Record it verbatim in the
brief, tagged `weak:`, and write copy that **declines that claim** rather than inventing
support for it. A page that says less is recoverable; a page that says something false about
the product is not. Tell the owner what you did and what it cost:

> I've recorded "it's faster" as weak — no number behind it — so the hero talks about what
> the product does instead of claiming a speed advantage. Give me a benchmark later and
> that headline gets much stronger.

Two follow-ups is a ceiling, not a quota. A specific first answer needs none.

### Pricing is extracted, never invented

The scaffolded page ships three plausible-looking tiers at $0 / $29 / Custom. Shipping those
as if they were real is the single worst outcome of this skill. So ask for, per tier: the
name, who it is for, the real monthly price, and the annual price if there is one.

Three acceptable outcomes, and no others:

1. **Real prices.** Write them.
2. **"Leave pricing as a placeholder."** Keep the shipped tiers untouched, and say in the
   brief that pricing is unconfirmed placeholder copy.
3. **"We don't have pricing yet."** Offer to drop the pricing block — that is a
   [block removal](#dropping-a-block-is-its-own-confirmation), with its own confirmation.

Never round, convert currencies, or fill in a "typical" number. If the owner names a
currency other than USD, set `landing.pricing.currencySymbol`.

Annual pricing has two shapes and both are fine:

- **There is an annual discount.** Set each tier's `annualPrice` to the effective monthly
  cost when billed annually, and make `landing.pricing.annualNote` arithmetically true — the
  shipped "Save 20%" is a claim about the numbers beside it.
- **There is not.** Set `annualPrice` equal to `monthlyPrice` and `annualNote` to `""`. The
  monthly/annual switch stays on the page (it is chrome, and yours to leave alone) but it
  now claims nothing untrue.

## Step 2 — write the brief

Write `docs/product-brief.md` before you write any copy. It is the source of truth on the
next run, it is human-editable, and it is what makes a re-run cheap.

```md
# Product brief

Last updated: YYYY-MM-DD (saasaloy-landing-copy)

- **Site name**: Ledgerly
- **Language**: Bangla (`bn`)

## Audience
Bookkeepers at firms carrying 5–20 client accounts.

## Problem
Month-end close runs across four spreadsheets per client, and a broken formula is only
found when a client queries the invoice.

## Current alternative
Excel plus a shared Dropbox folder.

## Differentiator
weak: "it's more organised" — asked twice, no mechanism named. Copy avoids this claim.

## Proof
Two named firms in beta (Rahman & Co, Hasan Associates), both agreed to be named.

## Tone
Plain, unexcited. Owner pointed at basecamp.com.

## Pricing
Confirmed 2026-08-08: Solo ৳900/mo, Firm ৳3,500/mo, no annual discount yet.

## Known gaps
- No Bengali webfont ships with the template; `font-sans` is the system stack.
```

Keep every `weak:` tag verbatim. It is the thread the next run picks up.

## Step 3 — write the copy

Every key below is under `landing.` in `packages/ui/src/content/landing.ts`. Fill all of
them; the layout is built for copy of roughly the length that is already there, so match it
rather than doubling it.

| Key | What goes there |
|-----|-----------------|
| `meta.title` | Browser tab. `{siteName} — <what it does>`, under 60 characters. |
| `meta.description` | Search result and link preview. One sentence, under 155 characters. |
| `navbar.linkFeatures` `.linkPricing` `.linkFaq` | Nav labels. One or two words. They point at the sections of the same name — keep the meaning, or the anchor lies. |
| `navbar.ctaLabel` | Two or three words, a verb first. |
| `hero.eyebrow` | The one-line status above the headline ("Now in early access"). Empty string hides it. |
| `hero.title` | The headline. Under ten words, one idea, concrete. This is the sentence the whole page is judged on. |
| `hero.description` | One or two sentences saying what it does for whom. |
| `hero.primaryActionLabel` `.secondaryActionLabel` | Button labels, a verb first. |
| `features.title` `.description` | The section's heading and one supporting line. |
| `features.items[]` | Six by default: `{ id, title, description }`. Title 2–4 words; description one sentence about what the owner can *do*, not about the technology. |
| `pricing.title` `.description` | Heading plus one line. |
| `pricing.annualNote` `.currencySymbol` | See [Pricing](#pricing-is-extracted-never-invented). |
| `pricing.tiers[]` | `{ id, name, description, monthlyPrice, annualPrice, features, ctaLabel, ctaHref }`. Prices are whole units; `null` renders "Custom". Set `featured` on at most one. Leave `ctaHref` as `#cta`. |
| `faq.items[]` | Five by default: `{ id, question, answer }`. Write the questions a buyer actually asks before paying — pricing, migration, lock-in, data, what happens when they outgrow it. Answer in one to three sentences, and answer the question. |
| `cta.title` `.description` | The closing ask, plus one line removing a reason to hesitate. |
| `footer.tagline` | One line under the brand. |
| `footer.groupProduct` `.groupLegal` `.link*` | Footer labels. One or two words each. |

Four mechanical rules that the code depends on:

- **`{siteName}` is the only placeholder, and it works in exactly four strings**:
  `meta.title`, `meta.description`, `hero.description`, `cta.description`. Anywhere else it
  renders as the literal text `{siteName}`. Never use a template literal — copy is data.
- **Keep the six feature `id`s** (`fast`, `modules`, `source`, `secure`, `cloudflare`,
  `current`). Each one picks an icon in `feature-grid.tsx`, which you may not edit. Rewriting
  `title` and `description` under an existing id is free; introducing a new id renders a
  generic fallback icon, so if the owner wants a different icon, tell them which line of
  `feature-grid.tsx` to change and let them decide.
- **Deleting an item is fine**, in any of the three lists. Fewer than six features and fewer
  than five questions both lay out correctly.
- **`siteName` lives in `packages/ui/src/index.ts`**, not in the content module. Set it there.

### The bar this copy has to clear

You are writing without a copy editor, and the failure mode is not bad grammar — it is
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
  thousands" that did not come out of the interview. Not one.
- **Second-person promises the product cannot keep.** "You'll never worry about invoices
  again."

Two habits that carry more weight than the whole list above: use the **owner's own nouns**
from the interview, and **name the current alternative**. "Close the month without four
spreadsheets per client" is a sentence no generator produces, because it required the
interview.

Where a dimension came back `weak:`, write around it. Describe what the product does, and
leave the claim out.

### Language, and the `lang` attribute

Write in the language the owner named — not English with a translation to follow. If it is
not English:

- Set `<html lang="…">` in `apps/web/src/layouts/Layout.astro` to the code. It ships
  hardcoded as `en`.
- Say once, and record in the brief's **Known gaps**, that the template loads **no webfont**:
  `font-sans` is the system stack, so a non-Latin script renders in whatever the visitor's
  device provides. It is a real gap, not a reason to write in English instead.
- Leave the `ui.*` namespace in English. It is chrome, it is not yours, and a translation
  layer is where it gets handled.

## Step 4 — show the diff, then write

**Confirm before every write.** For each file, show what changes — key by key for the content
module, old value then new — and ask. One confirmation per file is enough; do not ask per
key, and do not batch all files into a single blanket yes.

Then prove it builds, because a page that does not compile is not a deliverable:

```sh
pnpm --filter @repo/ui typecheck
pnpm build
```

Broken build, broken types: fix it, or revert the write and say what happened. Do not hand
back a red tree.

Finally, tell the owner what to look at: `pnpm dev`, and the two or three lines you are least
sure about.

### Dropping a block is its own confirmation

When the interview yields nothing a block can honestly carry — no pricing, no proof for the
FAQ — you may propose removing that block. **Separately.** Never bundled into the copy write,
never silent.

It is two edits, and both are allowed:

1. Delete that block's line from `apps/web/src/pages/index.astro`.
2. Blank the matching label in content (`landing.navbar.linkPricing = ""`,
   `landing.footer.linkPricing = ""`). A blank label drops the link, so the page keeps no
   nav entry pointing at a section that is gone.

Removing a block is not redesigning one. You are deleting a line from a page, not editing
`packages/ui/src/blocks/`.

## Re-running

A brief on disk means the interview already happened. Do not run it again from scratch.

1. **Summarise the brief back** in a few lines and ask what changed.
2. **Ask only about what moved** — plus every `weak:` tag, which is exactly the thread a
   second pass should pick up. "Last time 'it's faster' had no number behind it. Do you have
   one now?"
3. **Diff before writing**, as always. If the copy on disk differs from what the brief would
   produce, someone edited it by hand: say so, show the difference, and ask which wins.
4. **Update the brief's `Last updated` line** and rewrite only the sections that changed.

## Boundaries to honor

- **[The write surface](#the-write-surface) is the whole list of files you may touch** —
  nothing outside that table. Two of them carry copy: `packages/ui/src/content/landing.ts`
  (`landing.*` only) and `packages/ui/src/index.ts` (`siteName`). The other three are
  `docs/product-brief.md`, which you write on **every** run (Step 2), the `lang` attribute in
  `apps/web/src/layouts/Layout.astro`, and a consented block removal in
  `apps/web/src/pages/index.astro`.
- **Never edit a block.** `packages/ui/src/blocks/*.tsx` is off limits: no markup, no
  classes, no structure, no icon swaps. If copy will not fit a block, say so and let the owner
  decide.
- **Never touch the design layer** — `packages/ui/src/styles/globals.css`,
  `components.json`, `packages/ui/src/components/*`, or any Tailwind class anywhere.
- **Never touch `ui.*`.** Chrome and accessibility labels are not product copy.
- **Leave `href`s alone**, including `ctaHref` on a tier. Anchors match section ids; changing
  one breaks a link.
- **Leave `apps/web/src/pages/terms.astro` and `privacy.astro` alone.** Boilerplate legal
  text is not a copywriting job.
- **No images, logos, icons or screenshots.** Not generated, not sourced, not referenced.
- **No dependencies, no i18n machinery, no webfonts.** Report the gap; do not close it.
- **Never invent pricing or proof**, and never quietly leave the shipped demo numbers in
  place as if they were real.
- **A dirty tree, a missing repo, or a thin interview is not a blocker.** Warn, write less,
  and say what you left out. (This is about those three conditions only — anything unsafe or
  outside this skill's scope you decline as you normally would.)
