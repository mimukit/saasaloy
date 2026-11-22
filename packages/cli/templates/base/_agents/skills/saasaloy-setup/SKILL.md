---
name: saasaloy-setup
description: Interview the project owner once, about the landing page and about the product, then record approval of docs/product-brief.md and docs/product-spec.md before starting the saasaloy-design review. The brief is the shared context every other Saasaloy skill reads; the spec holds the modules and one table for each entity. Use right after saasaloy init, when the owner says "set up this project", "tell you about my product", "build my product", "what is this project", when config.app.name is still the shipped "Saasaloy", when another skill needs product context and no brief exists yet, when re-running to update the brief or the spec after something changed, and when an unattended build runs on a brief whose frontmatter says autonomy: afk.
---

# saasaloy-setup — find out what this project is, once

A scaffolded project knows nothing about the product it is going to become. Its name is `Saasaloy`, because the shipped landing page describes Saasaloy itself, its language is English because nobody asked, and every skill that follows has to either interview the owner again or guess.

So this skill asks once and writes the answers down. It writes two files and two code facts:

- **`docs/product-brief.md`**: the ten landing answers, and the run settings `autonomy` and `deploy` in its frontmatter.
- **`docs/product-spec.md`**: the product part. The modules, one table for each entity, the wishes that are not in this build, and the steps that stay with the owner. Its headings are fixed by [`product-spec-template.md`](product-spec-template.md), which sits beside this file.
- The product's name and its locale, in `packages/config/src/project.ts`.

Use the owner's opening description and ask only for missing facts and decisions. The product read-back confirms the brief, the spec and the screens. After product approval, start the design review. Design approval starts the unattended build unless the owner requests an attended build.

It writes no copy. `saasaloy-landing-copy` does that, from the brief this leaves behind.

## The write surface

| Path | What you change |
|------|-----------------|
| `docs/product-brief.md` | The whole file. Create `docs/` if it does not exist. |
| `docs/product-approvals.json` | The product approval and invalidation of a stale design approval. See the approval record below. |
| `docs/product-spec.md` | The whole file, in the shape of `product-spec-template.md`. |
| `./product-brief.md` | Move it to `docs/product-brief.md` when a person supplied it there, as [Step 0](#step-0--before-you-ask-anything) says. |
| `packages/config/src/project.ts` | `app.name` and `app.locale`, and nothing else in the file. |
| `docs/build-log.md` | Under `autonomy: afk` only: the run's lines in the current stage's section, or in a `## Setup` section, or the `## Blocked` list. |

Nothing else. You are not here to write the landing page, add a module or a dependency, or touch a block.

## Step 0 — before you ask anything

1. **Resume a pending review first.** Read `docs/product-brief.md`, `docs/product-spec.md` and `docs/product-approvals.json` when present. For a brief marked `setup-review: required`, finish any missing interview answers before presenting the read-back. Show the read-back if product approval is absent or stale. If product approval is current and design approval is pending or stale, resume the design review. If both approvals are current and the owner asks to build, start or resume `saasaloy-build`. If nobody can answer a pending review, report the pending step and stop. Honor an explicit request to revise the brief or spec. Before starting a new product review, remove any stale `autonomy` field and invalid approvals.

2. **Read `docs/product-brief.md`.** If its frontmatter holds `autonomy: afk`, follow [Unattended run](#unattended-run) and ask nothing, unless a person in this conversation asks for the interview, a change to the brief, or to turn unattended runs off. Then take the attended path below. Otherwise, if it exists, someone has already been through this. Read it and `docs/product-spec.md` fully, and jump to [Re-running](#re-running).
3. **Look for a brief a person supplied.** When `docs/product-brief.md` does not exist and `./product-brief.md` does (or one directory up, when `saasaloy init` made a subfolder), a person wrote the brief before this session. With `autonomy: afk` in its frontmatter, ask nothing: start `saasaloy-build`, whose Intake stage moves the file. Without it, move the file to `docs/product-brief.md` and take [Re-running](#re-running).
4. **Stop when there is no brief and no person.** You have no brief when neither location holds one. You have no person when the prompt says nobody is at the keyboard, or when you run with no way to ask a question (a headless run, such as `claude -p`). A headless run whose prompt says the owner is here and answers your questions has a person: ask each question in text, end your turn, and read the answer in the next message. Without a person, ask nothing and write nothing. Say this, and stop: "No product brief exists and nobody is here to answer the interview. Run /saasaloy-setup with the owner present, or supply a brief with `autonomy: afk` in its frontmatter." Never invent the answers yourself. A brief without `autonomy: afk` and no person is the same case: say "The brief has no `autonomy: afk`, and nobody is here to confirm it", and stop.
5. **Read `packages/config/src/project.ts`** for the current `app.name`. It ships commented out, so the name is still the base's `"Saasaloy"` until someone sets it. When it is set, it is the best opening guess you have, and it belongs in question 1's samples. The project's directory name is the next best guess.
6. **Look at git, and treat it as advice.** Run `git status --short` if there is a repo. A dirty tree or no repo at all is worth one sentence ("your changes aren't committed, so you can't undo this with git; every write here is previewed in the read-back anyway"), and then you carry on. `saasaloy init` creates the repository and commits the scaffold on `main`, unless it ran with `--no-git` or found no git identity. The build's Intake stage makes that commit when `init` could not. **Neither state is a reason to stop.**
7. **Read the module list once**, for question 13: run `saasaloy list --json`, and keep `modules[]`. Each module has `name`, `description`, `stage`, `needs`, `dependsOn`, `requiresOneOf` and `conflictsWith`.
8. **Check whether the agent can generate mockup images.** If the tool is unavailable, tell the owner that the design review can use supplied images or an approved preset.
9. **Say how long this takes and what it is for**, in two lines, before the questions: up to thirteen interview questions, then product approval, then design approval. The unattended build starts after design approval. An owner who does not know why answers thinly.

## Step 1 — the questions

Use the thirteen numbered topics in two parts. Fill any answer the owner already supplied. **If the name is missing, ask for it first and on its own.** Use the name and previous answers in later samples.

Ask the remaining questions in batches of **up to three**. Number them so the owner can answer by number.

### The landing part: questions 1 to 10

| # | Dimension | What you are actually after |
|---|-----------|----------------------------|
| 1 | **Name** | What the product is called. Ask alone, first, before anything else. |
| 2 | **Language** | The language the audience reads, as a name and a code (`en`, `bn`, `es`). Do not assume English. |
| 3 | **Audience** | The specific person who pays. A job title, a team, a situation. |
| 4 | **Problem** | What goes wrong for them today, in their words. |
| 5 | **Current alternative** | What they use *instead* right now: usually a spreadsheet, a contractor, or nothing. This is the real competitor. |
| 6 | **Differentiator** | What this does that the alternative cannot. One thing, not a list. |
| 7 | **Proof** | Something the owner can stand behind today: a number, a named customer who agreed to be named, a benchmark they ran, a certificate. |
| 8 | **Tone** | How the product should sound. Ask for an adjective *and* a site they think gets it right. |
| 9 | **Pricing** | Per tier: name, who it is for, real monthly price, annual price if there is one. See [Pricing](#pricing-is-extracted-never-invented). |
| 10 | **Where "sign up" goes** | The signup, waitlist or app URL the primary button should point at. See [The destination](#the-destination-question). |

Write the brief after question 10, as [Step 2](#step-2--write-the-brief-and-the-spec) says, before the product part starts.

### The product part: questions 11 to 13

| # | Dimension | What you are actually after |
|---|-----------|----------------------------|
| 11 | **Entities** | The things the product's user makes, tracks or reads. You propose one table for each entity, and the owner corrects it. See [Propose the entities](#propose-the-entities). |
| 12 | **Order** | Which entity the build makes first, second, and so on. The build makes every entity, in this order. |
| 13 | **Capabilities** | Which optional modules the product needs, from `saasaloy list --json`. See [The capabilities question](#the-capabilities-question). |

Then give the [read-back](#the-read-back). It confirms the scope before the design review.

### Every question ships with sample answers

Never ask a bare question. Each one carries **three sample answers the owner can take as written, edit, or ignore in favour of their own**, and say that all three routes are open, every time. Most owners answer a picker in seconds and a blank prompt in paragraphs, and the paragraph is usually vaguer.

In Claude Code, ask with the question-picker tool so the samples render as choices with a free-text option beside them. Any other agent: number the samples `a` / `b` / `c` and add "or write your own".

Four rules keep samples useful instead of leading:

- **Derive them.** A sample is a hypothesis built from the name and the answers already given, not a stock phrase. After "Ledgerly" and "bookkeepers", the problem samples talk about month-end and client accounts. If your three samples would fit any product on the internet, you have written filler, and the owner will pick one, and the page will say nothing.
- **Make them differ in substance, not wording.** Three ways to say "small businesses" is one sample. Three different audiences is three.
- **For questions 7, 9 and 10, offer shapes rather than values.** These three become facts the page asserts. "Two named beta customers who agreed to be named" is a shape and is safe to suggest. "300 students enrolled" is a number you invented, and if the owner picks it the landing page now lies. Same for a price, and same for a URL: suggest `https://<yourdomain>/waitlist`, never a domain you made up.
- **Always include the honest empty answer** where one exists: "no proof yet", "no pricing yet", "nothing to link to yet". An owner who cannot see that option supplies something rather than admit to nothing, which is how invented proof gets in.

A worked pair:

> **1. What is this product called?**
> a. `ledgerly` — the name the folder already has
> b. Ledgerly — same word, capitalised the way you would write it on the page
> c. Something else entirely, if the folder name was a placeholder
> Or type it however you want it to appear on the page.

> **4. What goes wrong for a bookkeeper today?** *(samples built from your answer to 3)*
> a. Month-end close runs across four spreadsheets per client, and a broken formula only surfaces when the client queries the invoice.
> b. Chasing clients for receipts eats the first week of every month.
> c. Nothing is wrong exactly, it is just slow, and I want to say what instead.
> Or describe it in your own words — your words are the ones that end up on the page.

### Push back, at most twice

An answer is **weak** when it names no audience, no number, no named alternative, or no proof the owner could point at. "Everyone" is not an audience. "It's faster" is not a differentiator. "Businesses struggle with productivity" is not a problem.

An honest empty answer is not weak. "No proof yet", "no pricing yet" and "nothing to link to yet" are facts the owner stated, so record them as plain text with no `weak:` tag.

Push back **at most twice per question**, and make each follow-up narrower than the last, carrying fresh samples, same as the first ask:

> — Who is your audience?
> — Small businesses.
> — Which ones? Think of the last person who asked you for this. What was their job?
> — Bookkeepers, mostly, at firms with 5–20 clients.

If the second follow-up still comes back thin, **stop asking.** Record it in the brief verbatim, tagged `weak:`, and say what it will cost:

> I've recorded "it's faster" as weak — no number behind it — so anything written from this brief will describe what the product does rather than claim a speed advantage. Give me a benchmark later and that changes.

Two follow-ups is a ceiling, not a quota. A specific first answer needs none. The read-back settles each `weak:` answer: the owner improves it there, or accepts it.

### Pricing is extracted, never invented

The scaffolded page ships three plausible-looking tiers at $0 / $29 / Custom. Shipping those as if they were real is the worst thing this workflow can do, so ask per tier: name, who it is for, real monthly price, annual price if there is one.

Three acceptable outcomes, and no others:

1. **Real prices.** Record them, with the date they were confirmed.
2. **"Leave pricing as a placeholder."** Record that the shipped tiers are unconfirmed placeholder copy, in those words.
3. **"We don't have pricing yet."** Record that. The landing-copy skill will offer to drop the pricing block, which is its call to make and its confirmation to take.

Never round, convert currencies, or fill in a typical number. Record the currency if it is not USD.

Annual pricing has two shapes and both are fine: a real discount (record the effective monthly cost when billed annually) or no discount at all (record that, so nobody writes "Save 20%" over two identical numbers).

### The destination question

Question 10 is the one owners are most surprised to be asked, and the one that most often leaves a page broken. A pre-launch product with a **Join the waitlist** button that reloads the homepage is worse off than one with a wrong icon.

Ask where the primary call to action should go. Three answers to expect:

- **A URL.** Record it. An external form, a waitlist provider, an app subdomain.
- **A route this project will have later** (`/signup`). Record it, and note it does not exist yet.
- **Nothing yet.** Record "nothing to link to yet", with no `weak:` tag. The page keeps sending people to its own closing section, and the labels have to stay modest to match.

### Propose the entities

Question 11 is a proposal, not a blank question. Read the answers to questions 3 to 6, and write one table for each entity the product's user makes, tracks or reads. Propose two to four entities. The owner corrects them: a field, a rule, an action, an entity to add or to drop. There is no limit on the number of entities the owner keeps.

Each table has the five rows of `product-spec-template.md`, in its order:

| Part | What you write |
|------|----------------|
| Table | The table name, plural snake_case: `books`, `reading_sessions`. |
| Fields | Each field as `` `name` type ``, with `required` when a row cannot exist without it. Leave out `id`, the owner column and the timestamps: every table gets them. |
| Who may see it | One of three rules: `the owner` (the user who made the row), `the organization` (every member of the active organization), or `every signed-in user reads, the owner writes`. Add what staff see in `admin`: a read-only list of every row. |
| Actions | Always `` `list` ``, `` `create` `` and `` `update` ``, then each domain verb by name, such as `` `finish` ``, `` `archive` `` or `` `approve` ``. A delete is a domain verb too, so name `` `delete` `` only when the owner wants one. |
| Screens | Always the same four parts: an app list, an app detail, an app create and update form, and an admin read-only list. Name the parts: `data-table`, `detail-panel`, `form` and `field`. |

Use only these field types, so `saasaloy-feature` can map each one to a column and a control:

| Type | What it holds |
|------|---------------|
| `text` | One line, such as a title or a name. |
| `long text` | Several lines, such as notes. |
| `number` | A whole number. |
| `decimal` | A number with a fraction. |
| `money` | An amount in the smallest currency unit, with the brief's currency. |
| `date` | A day with no time. |
| `datetime` | A moment, such as a due time. |
| `yes/no` | A switch. |
| `one of a, b, c` | A fixed list of states. |
| `link to <table>` | A row of another entity in this spec. |

Show the proposal as the tables, then ask with three samples: take the tables as written, change a named part, or add or drop an entity. Ask question 11 on its own, because the tables take the longest to read. Ask question 12 after it, with three different orders as the samples.

> **11. These are the entities I would build for Shelfnote.** *(from your answers to 3 to 6)*
>
> **Books**
>
> | Part | Value |
> |------|-------|
> | Table | `books` |
> | Fields | `title` text, required; `author` text, required; `status` one of `want`, `reading`, `finished`, required; `finished_on` date; `rating` number |
> | Who may see it | the owner; staff read every row in admin |
> | Actions | `list`, `create`, `update`, `finish` |
> | Screens | app: list (`data-table`), detail (`detail-panel`), create and update form (`form`, `field`); admin: read-only list (`data-table`) |
>
> a. Build these as written.
> b. Change a part: name the entity and the row, such as "books: no rating".
> c. Add or drop an entity, such as "add notes on a book".
> Or write your own.

An entity the owner wants that needs a module the MVP lacks, such as an entity of the organization, adds that module to question 13's recommendation (`teams`, `multitenant` and `api-keys-organization` for `the organization`).

### The capabilities question

Question 13 offers the optional modules. Take the choices from the `modules[]` you read in Step 0, never from memory. When `saasaloy list --json` failed, tell the owner its message, which names the fix (such as `GITHUB_TOKEN` for the rate limit), and ask again once it runs.

Build the choices in four steps:

1. **Leave out the MVP set** the build always adds: `database`, `api`, `logger`, `validators`, `shell`, `auth`, `app`, `admin`, `email`, `agent`, `api-keys`, `api-keys-user`, and their drivers and providers.
2. **Leave out the drivers and providers.** A driver or provider is a module that another module's `requiresOneOf` names, or a `<capability>-<vendor>` module that depends on its capability, such as `email-plunk` or `payment-console`. The build picks those.
3. **Leave out the tooling modules** `ci`, `infra-ci-deploy` and `e2e`. They change how the project is built and checked, not what the product does.
4. **Offer the rest**, each with its `description`, grouped by `stage`. Recommend the ones the earlier answers call for, and say which answer each comes from: paid tiers in question 9 call for `subscription` or `payment`; an audience that is a team calls for `teams`; an entity of the organization calls for `teams`, `multitenant` and `api-keys-organization`, which the build installs in place of `api-keys-user` because a user's key acts for no organization and every organization route would refuse it; a waitlist destination in question 10 calls for `waitlist`.

Ask with three samples: the recommended set, nothing beyond the MVP, and a different set the owner names.

When a pick depends on a capability with providers, write that capability's local provider beside the pick in the spec: the provider whose name ends in `-console`, or in `-memory` when no `-console` provider exists. `subscription` pulls in `queue`, so it brings `subscription-console` and `queue-memory`.

**A picked module that needs an account.** A module with a non-empty `needs` (`stripe`, `vendor-account`, `cloudflare-paid`, `domain`) needs a person with that account. Never put it in the spec's `## Modules`. Put its capability's local provider there instead, and add the vendor step to `## Left for the owner`: "Create a Stripe account, then run `saasaloy add subscription-stripe`; the build installed `subscription-console`." Say so in the read-back.

**A wish that no module covers.** When the owner asks for something no module and no entity does, such as "import from Goodreads", write it under `## Not in this build`, in the owner's words. Do not promise it, and do not stretch an entity to hold it.

### The read-back

Once the brief and spec are complete, write them to disk and show the owner:

1. The ten brief answers. Mark each `weak:` answer and state which claim the copy will omit.
2. The default and optional modules, including local providers.
3. Each entity in build order, with its fields, access rule, actions and screens. Name the MCP scopes for those actions.
4. The excluded requests and the owner tasks, including deployment.

Ask: **Approve the product brief and spec and start design?** If the owner requests a change, update the files and present them again. On approval, change accepted `weak:` tags to `weak-accepted:` before you record the approval. The design review owns the next decision. Keep `autonomy` unset while that decision is pending.

### The approval record

Use `docs/product-approvals.json` for both approvals. Record `product.approvedAt`, `product.briefSha256` and `product.specSha256` when the owner approves the read-back. Keep `design` absent while it is pending. Use UTC dates and SHA-256 hashes of the approved files. For the brief, remove only the top-level `autonomy` line from its YAML frontmatter when hashing. Keep `setup-review: required` in the brief so a missing approval record cannot select the older headless path.

Check the hashes when you resume. A material brief or spec change invalidates both approvals. A design revision invalidates only the design approval. If either product hash changes, show the current brief and spec for confirmation before relying on their approval. [Start the design review](#start-the-design-review) when the product approval is current.

## Step 2 — write the brief and the spec

### The brief

`docs/product-brief.md` is the first file. It is human-editable, it is the source of truth on every re-run, and it is what every other skill reads instead of interviewing again.

```md
---
setup-review: required
---

# Product brief

Last updated: YYYY-MM-DD (saasaloy-setup)

- **Name**: Ledgerly
- **Language**: Bangla (`bn`)

## Audience
Bookkeepers at firms carrying 5–20 client accounts.

## Problem
Month-end close runs across four spreadsheets per client, and a broken formula is only found when a client queries the invoice.

## Current alternative
Excel plus a shared Dropbox folder.

## Differentiator
weak-accepted: "it's more organised" — asked twice, no mechanism named. Copy avoids this claim.

## Proof
Two named firms in beta (Rahman & Co, Hasan Associates), both agreed to be named.

## Tone
Plain, unexcited. Owner pointed at basecamp.com.

## Pricing
Confirmed 2026-08-08: Solo ৳900/mo, Firm ৳3,500/mo, no annual discount yet.

## Where "sign up" goes
https://ledgerly.com.bd/waitlist — a Tally form, live now.

## Known gaps
- The template loads no webfont, so a non-Latin script renders in whatever face the visitor's device provides.
```

The frontmatter holds the run settings, and nothing else:

- **`setup-review: required`** marks briefs on this review path. Write it when starting a new brief or bringing an existing brief into this review path.
- **`autonomy: afk`** follows design approval. Preserve a deployment setting already supplied by the owner, and leave deployment to handoff.

Three rules about this file:

- **Keep every `weak:` and `weak-accepted:` tag verbatim.** It is the thread the next run picks up.
- **Write it before you touch any code.** Write it after question 10, and again after the read-back. If the owner walks away after question 6, a brief with six answers in it is worth having; six answers held in a conversation are not.
- Keep the review marker while either approval is pending.

### The spec

`docs/product-spec.md` is the second file. Copy `product-spec-template.md` from this skill's folder and fill it. Its `##` headings are fixed, in this order: `## Modules`, `## Entities`, `## Not in this build` and `## Left for the owner`. Each entity is a `### <n>. <Entity name>` heading under `## Entities`, in the owner's order, with one table whose rows are `Table`, `Fields`, `Who may see it`, `Actions` and `Screens`. `saasaloy-build` and `saasaloy-feature` read these names, so never rename one, drop one, or add another `##` heading.

- **`## Modules`** lists each pick of question 13 and each local provider it brings, one row each, with its `stage` from `saasaloy list --json` and the answer it comes from. It does not list the MVP set. With no picks, write one row: `| None. | | |`.
- **`## Not in this build`** and **`## Left for the owner`** hold one list item each, or `- None.`

Write the spec after question 13, and again after the read-back.

## Step 3 — set the two facts that are code

Both are leaves of the `app` section in `packages/config/src/project.ts`, the one file in `packages/config` a project owner edits.

1. **`app.name`**: the brand as it appears in the header, the footer, the browser tab and every email. `siteName` in `@repo/ui` re-exports it, so nothing else needs editing. It is not translated. It ships commented out: uncomment the line and set it.
2. **`app.locale`**: the brief's language code. `apps/web`'s shared layout reads it as `<html lang>`. Set it whenever it differs from the brief, including back to `en` on a re-run that returns to English. Getting this wrong tells screen readers to pronounce Bangla with English phonetics.

```ts
export const project: ProjectOverride = {
  app: { name: "Ledgerly", locale: "en-GB" },
};
```

When this session leads to a build, its Brand stage sets both values. Run it here only on a re-run with no build to follow: show the change, confirm it, then check it still builds, because every page reads that object:

```sh
pnpm typecheck
pnpm build
```

## Start the design review

After product approval, follow the `review` mode in `.agents/skills/saasaloy-design/SKILL.md` in this session. Tell the owner that the design proposal comes next. Wait for design approval before starting a build.

## Re-running

A brief on disk can contain answers from an earlier session. Keep the answers the owner already supplied.

1. **Summarise it back** in a few lines, with the spec's entities and picks, and ask what changed.
2. **Ask only about what moved**, plus every `weak:` and `weak-accepted:` tag, which is exactly the thread a second pass should pick up. "Last time 'it's faster' had no number behind it. Do you have one now?" Carry samples on those questions too.
3. **A brief with no spec** needs product details before review. Use any facts already supplied, then ask for the missing topics from questions 11 to 13.
4. **Update `Last updated`** in each file you change, and rewrite only the sections that changed.
5. **If a file was hand-edited**, that wins. Do not tidy someone's prose back into your own phrasing.
6. **Confirm changed product scope.** On the review path, record the new product approval and return to design before building. When the owner asks only to update the brief, finish there and tell them if an earlier approval is stale.

## Unattended run

`autonomy: afk` in the brief's frontmatter means the person authorized an unattended build. On the review path, the build also requires both current approvals. Ask nothing in this run: no question, no confirmation, no preview that waits for an answer. The attended interview above never runs here, because only a person can answer it.

1. **Check that the brief is complete.** It is complete when all ten answers are present and filled: Name, Language, Audience, Problem, Current alternative, Differentiator, Proof, Tone, Pricing, and Where "sign up" goes. An honest empty answer ("no proof yet", "no pricing yet") counts as filled, and so does an answer tagged `weak-accepted:`. An answer tagged `weak:`, a missing section, or an empty one does not. `Known gaps` and any extra section are not checked.
2. **With an incomplete brief, stop.** Append each missing, empty or weak section to `docs/build-log.md` under `## Blocked`, one list item each, naming the section and what is wrong (`- Product brief: Proof is empty`). Create the file with a `# Build log` title when it does not exist, and add the `## Blocked` heading when it is not there. End the list with `- Product brief: fill these sections with /saasaloy-setup, or delete the autonomy line to work attended`. Write nothing else, and stop the run. An unattended build does not start the first module with a brief that is not complete.
3. **With a complete brief, set the two facts that are code.** Set `app.name` from Name and `app.locale` from Language's code in `packages/config/src/project.ts`, exactly as [Step 3](#step-3--set-the-two-facts-that-are-code) says, with no confirmation. Leave either one alone when it already matches the brief. Run `pnpm typecheck`.
4. **Log what you did** in `docs/build-log.md`: the name and the locale you set, or that both already matched, and the `pnpm typecheck` result. Add the lines under the current stage's `##` section when a build is running, and under a new `## Setup` section when none is. Write no hex string other than a commit hash, because the log's reader takes the first one in a section as its commit. The stage that commits adds its commit hash to that section.

Never edit the brief or the spec in this run. A wrong answer in either one is the owner's to fix.

## What happens next

The design skill starts the build in this session after design approval. On a re-run with no build to follow, say so explicitly when you finish, because the brief on its own changes nothing the owner can see:

> The brief is at `docs/product-brief.md`, the spec is at `docs/product-spec.md`, and the product's name is set in `packages/config/src/project.ts`. Run `/saasaloy-build` to build the MVP from them, or `/saasaloy-landing-copy` to rewrite only the landing page.

## Boundaries to honor

- **[The write surface](#the-write-surface) is the whole list of files you may touch.**
- **Never write landing copy.** Not into `packages/ui/src/content/landing.ts`, not into a block, not "just the headline while we're here". The brief is your output.
- **Never add a module.** The spec names the modules, and `saasaloy-build` adds them.
- **Never edit a block or the design layer**: `packages/ui/src/blocks/*`, `packages/ui/src/styles/*`, `packages/ui/src/components/*`, `components.json`, or a Tailwind class anywhere.
- **Never invent pricing, proof, a customer name, or a URL.** Not in the brief, not in the spec, and not in a sample answer.
- **Never ask for a secret.** A token or a key goes into a file the owner writes, never into this conversation.
- **No dependencies, no i18n machinery, no webfonts.** Record the gap in the brief; do not close it.
- **Under `autonomy: afk`, never ask.** Write the `## Blocked` list and stop instead.
- **With no brief and no person, stop and say why.** Never answer the interview yourself.
- **A dirty tree, a missing repo, or a thin interview is not a blocker.** Warn, record less, and say what you left out. (This is about those three conditions only: anything unsafe or outside this skill's scope you decline as you normally would.)

## Next

Run the design review after product approval. On a re-run with no build, `saasaloy-landing-copy` writes the landing page from the brief.
