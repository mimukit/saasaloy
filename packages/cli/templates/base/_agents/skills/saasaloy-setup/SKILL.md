---
name: saasaloy-setup
description: Interview the project owner about their product once, and write the answers to docs/product-brief.md — the shared context every other Saasaloy skill reads. Use at the start of a freshly scaffolded project, when the owner says "set up this project", "tell you about my product", "what is this project", when siteName is still the scaffold's directory name, when another skill needs product context and no brief exists yet, and when re-running to update the brief after something changed.
---

# saasaloy-setup — find out what this project is, once

A scaffolded project knows nothing about the product it is going to become. Its name is a
directory name, its language is English because nobody asked, and every skill that follows
has to either interview the owner again or guess.

So this skill asks once and writes the answers down. The deliverable is
**`docs/product-brief.md`**, plus the two facts that are code rather than prose: `siteName`
and the page's `lang` attribute.

It writes no copy. `saasaloy-landing-copy` does that, from the brief this leaves behind.

## The write surface

| Path | What you change |
|------|-----------------|
| `docs/product-brief.md` | The whole file. Create `docs/` if it does not exist. |
| `packages/ui/src/index.ts` | `siteName` — the brand constant, and nothing else in the file. |
| `apps/web/src/layouts/Layout.astro` | The `lang` attribute only, and only when the language is not English. |

Nothing else. You are not here to write the landing page, add a dependency, or touch a
block.

## Step 0 — before you ask anything

1. **Read `docs/product-brief.md`.** If it exists, someone has already been through this.
   Read it fully and jump to [Re-running](#re-running).
2. **Read `packages/ui/src/index.ts`** for the current `siteName`. `saasaloy init` sets it
   to the directory name, so it is usually a slug like `my-saas` rather than a brand. It is
   still the best opening guess you have, and it belongs in question 1's samples.
3. **Look at git, and treat it as advice.** `git status --short` if there is a repo. A dirty
   tree or no repo at all is worth one sentence — "your changes aren't committed, so you
   can't undo this with git; every write here is previewed and confirmed anyway" — and then
   you carry on. `saasaloy init` does not run `git init`, so a clean-tree requirement would
   block exactly the person who just scaffolded. **Neither state is a reason to stop.**
4. **Say how long this takes and what it is for**, in two lines, before question 1. Ten
   questions is a real ask, and an owner who does not know why is an owner who answers
   thinly.

## Step 1 — the questions

Ten of them. **Question 1 is the project's name, it goes first, and it goes on its own** —
every sample answer after it is built out of the name and the answers before it, so asking
it last (as an earlier version of this workflow did) means every other question gets asked
with nothing to work from.

After that, ask in batches of **two or three**. Number them so the owner can answer by
number.

| # | Dimension | What you are actually after |
|---|-----------|----------------------------|
| 1 | **Name** | What the product is called. Ask alone, first, before anything else. |
| 2 | **Language** | The language the audience reads, as a name and a code (`en`, `bn`, `es`). Do not assume English. |
| 3 | **Audience** | The specific person who pays. A job title, a team, a situation. |
| 4 | **Problem** | What goes wrong for them today, in their words. |
| 5 | **Current alternative** | What they use *instead* right now — usually a spreadsheet, a contractor, or nothing. This is the real competitor. |
| 6 | **Differentiator** | What this does that the alternative cannot. One thing, not a list. |
| 7 | **Proof** | Something the owner can stand behind today: a number, a named customer who agreed to be named, a benchmark they ran, a certificate. |
| 8 | **Tone** | How the product should sound. Ask for an adjective *and* a site they think gets it right. |
| 9 | **Pricing** | Per tier: name, who it is for, real monthly price, annual price if there is one. See [Pricing](#pricing-is-extracted-never-invented). |
| 10 | **Where "sign up" goes** | The signup, waitlist or app URL the primary button should point at. See [The destination](#the-destination-question). |

### Every question ships with sample answers

Never ask a bare question. Each one carries **three sample answers the owner can take as
written, edit, or ignore in favour of their own** — and say that all three routes are open,
every time. Most owners answer a picker in seconds and a blank prompt in paragraphs, and
the paragraph is usually vaguer.

In Claude Code, ask with the question-picker tool so the samples render as choices with a
free-text option beside them. Any other agent: number the samples `a` / `b` / `c` and add
"or write your own".

Four rules keep samples useful instead of leading:

- **Derive them.** A sample is a hypothesis built from the name and the answers already
  given, not a stock phrase. After "Ledgerly" and "bookkeepers", the problem samples talk
  about month-end and client accounts. If your three samples would fit any product on the
  internet, you have written filler, and the owner will pick one, and the page will say
  nothing.
- **Make them differ in substance, not wording.** Three ways to say "small businesses" is
  one sample. Three genuinely different audiences is three.
- **For questions 7, 9 and 10, offer shapes rather than values.** These three become facts
  the page asserts. "Two named beta customers who agreed to be named" is a shape and is
  safe to suggest. "300 students enrolled" is a number you invented, and if the owner picks
  it the landing page now lies. Same for a price, and same for a URL: suggest
  `https://<yourdomain>/waitlist`, never a domain you made up.
- **Always include the honest empty answer** where one exists: "no proof yet", "no pricing
  yet", "nothing to link to yet". An owner who cannot see that option supplies something
  rather than admit to nothing, which is how invented proof gets in.

A worked pair:

> **1. What is this product called?**
> a. `ledgerly` — the name the folder already has
> b. Ledgerly — same word, capitalised the way you would write it on the page
> c. Something else entirely, if the folder name was a placeholder
> Or type it however you want it to appear on the page.

> **4. What goes wrong for a bookkeeper today?** *(samples built from your answer to 3)*
> a. Month-end close runs across four spreadsheets per client, and a broken formula only
>    surfaces when the client queries the invoice.
> b. Chasing clients for receipts eats the first week of every month.
> c. Nothing is wrong exactly, it is just slow, and I want to say what instead.
> Or describe it in your own words — your words are the ones that end up on the page.

### Push back, at most twice

An answer is **weak** when it names no audience, no number, no named alternative, or no
proof the owner could point at. "Everyone" is not an audience. "It's faster" is not a
differentiator. "Businesses struggle with productivity" is not a problem.

Push back **at most twice per question**, and make each follow-up narrower than the last —
carrying fresh samples, same as the first ask:

> — Who is your audience?
> — Small businesses.
> — Which ones? Think of the last person who asked you for this. What was their job?
> — Bookkeepers, mostly, at firms with 5–20 clients.

If the second follow-up still comes back thin, **stop asking.** Record it in the brief
verbatim, tagged `weak:`, and say what it will cost:

> I've recorded "it's faster" as weak — no number behind it — so anything written from this
> brief will describe what the product does rather than claim a speed advantage. Give me a
> benchmark later and that changes.

Two follow-ups is a ceiling, not a quota. A specific first answer needs none.

### Pricing is extracted, never invented

The scaffolded page ships three plausible-looking tiers at $0 / $29 / Custom. Shipping
those as if they were real is the worst thing this workflow can do, so ask per tier: name,
who it is for, real monthly price, annual price if there is one.

Three acceptable outcomes, and no others:

1. **Real prices.** Record them, with the date they were confirmed.
2. **"Leave pricing as a placeholder."** Record that the shipped tiers are unconfirmed
   placeholder copy, in those words.
3. **"We don't have pricing yet."** Record that. The landing-copy skill will offer to drop
   the pricing block, which is its call to make and its confirmation to take.

Never round, convert currencies, or fill in a typical number. Record the currency if it is
not USD.

Annual pricing has two shapes and both are fine: a real discount (record the effective
monthly cost when billed annually) or no discount at all (record that, so nobody writes
"Save 20%" over two identical numbers).

### The destination question

Question 10 is the one owners are most surprised to be asked, and the one that most often
leaves a page broken. A pre-launch product with a **Join the waitlist** button that reloads
the homepage is worse off than one with a wrong icon.

Ask where the primary call to action should go. Three answers to expect:

- **A URL.** Record it. An external form, a waitlist provider, an app subdomain.
- **A route this project will have later** (`/signup`). Record it, and note it does not
  exist yet.
- **Nothing yet.** Record it as `weak:`. The page keeps sending people to its own closing
  section, which is honest but weak, and the labels have to stay modest to match.

## Step 2 — write the brief

`docs/product-brief.md` is the deliverable. It is human-editable, it is the source of truth
on every re-run, and it is what every other skill reads instead of interviewing again.

```md
# Product brief

Last updated: YYYY-MM-DD (saasaloy-setup)

- **Name**: Ledgerly
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

## Where "sign up" goes
https://ledgerly.com.bd/waitlist — a Tally form, live now.

## Known gaps
- The template loads no webfont, so a non-Latin script renders in whatever face the
  visitor's device provides.
```

Two rules about this file:

- **Keep every `weak:` tag verbatim.** It is the thread the next run picks up.
- **Write it before you touch any code.** If the owner walks away after question 6, a brief
  with six answers in it is worth having; six answers held in a conversation are not.

## Step 3 — set the two facts that are code

Show the change and confirm it, one file at a time.

1. **`siteName`** in `packages/ui/src/index.ts`. This is the brand as it appears in the
   header, the footer and the browser tab. It is not translated, and it is the only thing
   in that file you may edit.
2. **`lang`** in `apps/web/src/layouts/Layout.astro`, only when the language is not
   English. It ships hardcoded as `en`. Getting this wrong tells screen readers to
   pronounce Bangla with English phonetics.

Then check it still builds, because both files are imported by the page:

```sh
pnpm --filter @repo/ui typecheck
pnpm build
```

## Re-running

A brief on disk means the interview already happened.

1. **Summarise it back** in a few lines and ask what changed.
2. **Ask only about what moved** — plus every `weak:` tag, which is exactly the thread a
   second pass should pick up. "Last time 'it's faster' had no number behind it. Do you
   have one now?" Carry samples on those questions too.
3. **Update `Last updated`** and rewrite only the sections that changed.
4. **If the brief was hand-edited**, that wins. Do not tidy someone's prose back into your
   own phrasing.

## What happens next

Say so explicitly when you finish, because the brief on its own changes nothing the owner
can see:

> The brief is at `docs/product-brief.md` and `siteName` is set. Run
> `/saasaloy-landing-copy` and it will write the landing page from this, as a markdown
> draft you review before anything touches the site.

## Boundaries to honor

- **[The write surface](#the-write-surface) is the whole list of files you may touch.**
- **Never write landing copy.** Not into `packages/ui/src/content/landing.ts`, not into a
  block, not "just the headline while we're here". The brief is your output.
- **Never edit a block or the design layer** — `packages/ui/src/blocks/*`,
  `src/styles/globals.css`, `src/components/*`, `components.json`, or a Tailwind class
  anywhere.
- **Never invent pricing, proof, a customer name, or a URL.** Not in the brief, and not in
  a sample answer.
- **No dependencies, no i18n machinery, no webfonts.** Record the gap in the brief; do not
  close it.
- **A dirty tree, a missing repo, or a thin interview is not a blocker.** Warn, record less,
  and say what you left out. (This is about those three conditions only — anything unsafe
  or outside this skill's scope you decline as you normally would.)
