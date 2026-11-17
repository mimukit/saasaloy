---
name: saasaloy-setup
description: Interview the project owner once, about the landing page and about the product, then write docs/product-brief.md and docs/product-spec.md and start saasaloy-build in the same session. The brief is the shared context every other Saasaloy skill reads; the spec holds the modules, the database driver and one table for each entity. Use right after saasaloy init, when the owner says "set up this project", "tell you about my product", "build my product", "what is this project", when config.app.name is still the shipped "Saasaloy", when another skill needs product context and no brief exists yet, when re-running to update the brief or the spec after something changed, and when an unattended build runs on a brief whose frontmatter says autonomy: afk.
---

# saasaloy-setup — find out what this project is, once

A scaffolded project knows nothing about the product it is going to become. Its name is `Saasaloy`, because the shipped landing page describes Saasaloy itself, its language is English because nobody asked, and every skill that follows has to either interview the owner again or guess.

So this skill asks once and writes the answers down. It writes two files and two code facts:

- **`docs/product-brief.md`**: the ten landing answers, and the run settings `autonomy` and `deploy` in its frontmatter.
- **`docs/product-spec.md`**: the product part. The modules, the database driver, one table for each entity, the wishes that are not in this build, and the steps that stay with the owner. Its headings are fixed by [`product-spec-template.md`](product-spec-template.md), which sits beside this file.
- The product's name and its locale, in `packages/config/src/project.ts`.

The interview has about fifteen questions and ends with one read-back. The owner's one confirmation there settles every thin answer, approves the screens, and sets `autonomy: afk`. Then this skill starts `saasaloy-build` in the same session, and nobody answers another question.

It writes no copy. `saasaloy-landing-copy` does that, from the brief this leaves behind.

## The write surface

| Path | What you change |
|------|-----------------|
| `docs/product-brief.md` | The whole file. Create `docs/` if it does not exist. |
| `docs/product-spec.md` | The whole file, in the shape of `product-spec-template.md`. |
| `./product-brief.md` | Move it to `docs/product-brief.md` when a person supplied it there, as [Step 0](#step-0--before-you-ask-anything) says. |
| `packages/config/src/project.ts` | `app.name` and `app.locale`, and nothing else in the file. |
| `docs/build-log.md` | Under `autonomy: afk` only: the run's lines in the current stage's section, or in a `## Setup` section, or the `## Blocked` list. |

Nothing else. You are not here to write the landing page, add a module or a dependency, or touch a block.

## Step 0 — before you ask anything

1. **Read `docs/product-brief.md`.** If its frontmatter holds `autonomy: afk`, follow [Unattended run](#unattended-run) and ask nothing, unless a person in this conversation asks for the interview, a change to the brief, or to turn unattended runs off. Then take the attended path below. Otherwise, if it exists, someone has already been through this. Read it and `docs/product-spec.md` fully, and jump to [Re-running](#re-running).
2. **Look for a brief a person supplied.** When `docs/product-brief.md` does not exist and `./product-brief.md` does (or one directory up, when `saasaloy init` made a subfolder), a person wrote the brief before this session. With `autonomy: afk` in its frontmatter, ask nothing: start `saasaloy-build`, whose Intake stage moves the file. Without it, move the file to `docs/product-brief.md` and take [Re-running](#re-running).
3. **Stop when there is no brief and no person.** You have no brief when steps 1 and 2 found none. You have no person when the prompt says nobody is at the keyboard, or when you run with no way to ask a question (a headless run, such as `claude -p`). Then ask nothing and write nothing. Say this, and stop: "No product brief exists and nobody is here to answer the interview. Run /saasaloy-setup with the owner present, or supply a brief with `autonomy: afk` in its frontmatter." Never invent the answers yourself. A brief without `autonomy: afk` and no person is the same case: say "The brief has no `autonomy: afk`, and nobody is here to confirm it", and stop.
4. **Read `packages/config/src/project.ts`** for the current `app.name`. It ships commented out, so the name is still the base's `"Saasaloy"` until someone sets it. When it is set, it is the best opening guess you have, and it belongs in question 1's samples. The project's directory name is the next best guess.
5. **Look at git, and treat it as advice.** Run `git status --short` if there is a repo. A dirty tree or no repo at all is worth one sentence ("your changes aren't committed, so you can't undo this with git; every write here is previewed in the read-back anyway"), and then you carry on. `saasaloy init` creates the repository and commits the scaffold on `main`, unless it ran with `--no-git` or found no git identity. The build's Intake stage makes that commit when `init` could not. **Neither state is a reason to stop.**
6. **Read the module list once**, for questions 13 and 14: run `saasaloy list --json`, and keep `modules[]`. Each module has `name`, `description`, `stage`, `needs`, `dependsOn`, `requiresOneOf` and `conflictsWith`.
7. **Say how long this takes and what it is for**, in two lines, before question 1: about fifteen questions, then one read-back, then the build runs with no more questions. An owner who does not know why answers thinly.

## Step 1 — the questions

Fifteen of them, in two parts. **Question 1 is the project's name, it goes first, and it goes on its own**: every sample answer after it is built out of the name and the answers before it.

After that, ask in batches of **two or three**. Number them so the owner can answer by number.

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

### The product part: questions 11 to 15

| # | Dimension | What you are actually after |
|---|-----------|----------------------------|
| 11 | **Entities** | The things the product's user makes, tracks or reads. You propose one table for each entity, and the owner corrects it. See [Propose the entities](#propose-the-entities). |
| 12 | **Order** | Which entity the build makes first, second, and so on. The build makes every entity, in this order. |
| 13 | **Capabilities** | Which optional modules the product needs, from `saasaloy list --json`. See [The capabilities question](#the-capabilities-question). |
| 14 | **Database driver** | `database-d1` or `database-postgres`. You recommend one. See [The driver question](#the-driver-question). |
| 15 | **Preview deploy** | Whether to put the finished build on a preview address. Always the last question. See [The preview question](#the-preview-question). |

Then give the [read-back](#the-read-back). It is not a sixteenth question: it shows everything at once and asks for one confirmation.

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

An entity the owner wants that needs a module the MVP lacks, such as an entity of the organization, adds that module to question 13's recommendation (`teams` and `multitenant` for `the organization`).

### The capabilities question

Question 13 offers the optional modules. Take the choices from the `modules[]` you read in Step 0, never from memory. When `saasaloy list --json` failed, tell the owner its message, which names the fix (such as `GITHUB_TOKEN` for the rate limit), and ask again once it runs.

Build the choices in four steps:

1. **Leave out the MVP set** the build always adds: `database`, `api`, `logger`, `validators`, `shell`, `auth`, `app`, `admin`, `email`, and their drivers and providers.
2. **Leave out the drivers and providers.** A driver or provider is a module that another module's `requiresOneOf` names, or a `<capability>-<vendor>` module that depends on its capability, such as `email-plunk` or `payment-console`. The build picks those.
3. **Leave out the tooling modules** `ci`, `infra-ci-deploy` and `e2e`. They change how the project is built and checked, not what the product does.
4. **Offer the rest**, each with its `description`, grouped by `stage`. Recommend the ones the earlier answers call for, and say which answer each comes from: paid tiers in question 9 call for `subscription` or `payment`; an audience that is a team calls for `teams`; an entity of the organization calls for `teams` and `multitenant`; a waitlist destination in question 10 calls for `waitlist`.

Ask with three samples: the recommended set, nothing beyond the MVP, and a different set the owner names.

When a pick depends on a capability with providers, write that capability's local provider beside the pick in the spec: the provider whose name ends in `-console`, or in `-memory` when no `-console` provider exists. `subscription` pulls in `queue`, so it brings `subscription-console` and `queue-memory`.

**A picked module that needs an account.** A module with a non-empty `needs` (`stripe`, `vendor-account`, `cloudflare-paid`, `domain`) needs a person with that account. Never put it in the spec's `## Modules`. Put its capability's local provider there instead, and add the vendor step to `## Left for the owner`: "Create a Stripe account, then run `saasaloy add subscription-stripe`; the build installed `subscription-console`." Say so in the read-back.

**A wish that no module covers.** When the owner asks for something no module and no entity does, such as "import from Goodreads", write it under `## Not in this build`, in the owner's words. Do not promise it, and do not stretch an entity to hold it.

### The driver question

Question 14 recommends one driver, and the owner confirms or changes it. Recommend from the picks, in this order:

1. **`database-postgres`** when a pick depends on it in `dependsOn` (`ecommerce` does). Say that D1 cannot run that module.
2. **`database-d1`** in every other case. It runs on the Cloudflare free tier with no server, and it needs nothing on the owner's machine.

Offer three samples: the recommendation with its reason, the other driver with what it costs, and "you choose". Say what `database-postgres` costs locally: `pnpm db:setup` starts it in Docker, so the machine needs Docker. Say that the tool moves no data between drivers, so the choice holds for the life of the project.

### The preview question

Question 15 is always the last question, and it goes on its own. It records `deploy: preview` or `deploy: none` in the brief's frontmatter.

> **15. Put the finished build on a preview address?**
> a. No — keep it on my machine (`deploy: none`).
> b. Yes — deploy a preview to `workers.dev` addresses when the build is done (`deploy: preview`). I will put a Cloudflare API token in `~/.config/<project>/cloudflare-preview.env` myself.
> c. Not now — ask me again after I have looked at the local app (`deploy: none`).

Say these facts with it:

- **The token never enters this conversation.** The owner writes it into the file, with mode 0600. Never ask for its value.
- **With `database-postgres`, the preview runs on a temporary database**, a neon.new database that deletes itself a few days after it is made. The build log states the day it ends.
- **The build records the choice.** A build with no Preview stage lists the preview deploy under `## Left for a human`.

### The read-back

After question 15, show everything in one message, and ask for one confirmation. Write the brief and the spec to disk first, so the owner can open them. The read-back has these parts, in this order:

1. **The brief.** Each of the ten answers in one line. Mark each `weak:` answer and say what the copy leaves out because of it.
2. **The module list.** The MVP set the build always adds, then each pick from `## Modules` with the driver and each local provider.
3. **Each entity with its screens**, in the owner's order. Name each screen: the app list, the app detail, the app create and update form, and the admin read-only list.
4. **Not in this build.** Each wish from `## Not in this build`, or "nothing".
5. **Left for the owner.** The vendor steps from `## Left for the owner`, the preview token when `deploy: preview`, and the steps no build takes: review and merge `build/mvp`, push it, and deploy to production.
6. **What happens next.** "On yes, I start the build now and ask you nothing more. It ends at a local app on the `build/mvp` branch, and `docs/build-log.md` records each stage."

Then ask, with three samples:

> **Build it?**
> a. Yes, build it unattended — I accept each weak answer as written, and I approve these screens.
> b. Yes, but ask me before each stage — I will stay at the keyboard.
> c. Change something first — name it.

What each answer does:

- **a.** Set `autonomy: afk` in the brief's frontmatter. Rewrite each `weak:` tag as `weak-accepted:`, keeping the answer verbatim. The screens in the spec count as approved. Then [start the build](#start-the-build).
- **b.** The same as a, but write no `autonomy` field, and remove one an earlier run wrote. The build then asks before each stage.
- **c.** Change what the owner names, write the files again, and show the read-back again. A change to an answer is not a new question: ask a follow-up only when the change itself is unclear.

An answer tagged `weak-accepted:` counts as filled, and every skill that writes copy still leaves its claim out. Ask nothing after the confirmation.

## Step 2 — write the brief and the spec

### The brief

`docs/product-brief.md` is the first file. It is human-editable, it is the source of truth on every re-run, and it is what every other skill reads instead of interviewing again.

```md
---
autonomy: afk
deploy: none
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

- **`autonomy: afk`** only after the owner answered a at the read-back. Leave it out otherwise.
- **`deploy: preview`** or **`deploy: none`**, from question 15. A brief with no `deploy` field reads as `deploy: none`.

Three rules about this file:

- **Keep every `weak:` and `weak-accepted:` tag verbatim.** It is the thread the next run picks up.
- **Write it before you touch any code.** Write it after question 10, and again after the read-back. If the owner walks away after question 6, a brief with six answers in it is worth having; six answers held in a conversation are not.
- **Write no frontmatter before the read-back**, except `deploy` once question 15 is answered.

### The spec

`docs/product-spec.md` is the second file. Copy `product-spec-template.md` from this skill's folder and fill it. Its `##` headings are fixed, in this order: `## Modules`, `## Database driver`, `## Entities`, `## Not in this build` and `## Left for the owner`. Each entity is a `### <n>. <Entity name>` heading under `## Entities`, in the owner's order, with one table whose rows are `Table`, `Fields`, `Who may see it`, `Actions` and `Screens`. `saasaloy-build` and `saasaloy-feature` read these names, so never rename one, drop one, or add another `##` heading.

- **`## Modules`** lists each pick of question 13 and each local provider it brings, one row each, with its `stage` from `saasaloy list --json` and the answer it comes from. It does not list the MVP set. With no picks, write one row: `| None. | | |`.
- **`## Database driver`** names the driver of question 14 in a code span, and the reason.
- **`## Not in this build`** and **`## Left for the owner`** hold one list item each, or `- None.`

Write the spec after question 14, and again after the read-back.

## Step 3 — set the two facts that are code

Both are leaves of the `app` section in `packages/config/src/project.ts`, the one file in `packages/config` a project owner edits.

1. **`app.name`**: the brand as it appears in the header, the footer, the browser tab and every email. `siteName` in `@repo/ui` re-exports it, so nothing else needs editing. It is not translated. It ships commented out: uncomment the line and set it.
2. **`app.locale`**: the brief's language code. `apps/web`'s shared layout reads it as `<html lang>`. Set it whenever it differs from the brief, including back to `en` on a re-run that returns to English. Getting this wrong tells screen readers to pronounce Bangla with English phonetics.

```ts
export const project: ProjectOverride = {
  app: { name: "Ledgerly", locale: "en-GB" },
};
```

When the build starts from this session, its Brand stage sets both through [Unattended run](#unattended-run) step 3, so skip this step here. Run it here only on a re-run with no build to follow: show the change, confirm it, then check it still builds, because every page reads that object:

```sh
pnpm typecheck
pnpm build
```

## Start the build

After the owner confirms the read-back with a or b, read `.agents/skills/saasaloy-build/SKILL.md` and follow it, in this session. Say one line first: "Starting the build now." Do not ask the owner to start a new session, to run a command, or to copy a file.

## Re-running

A brief on disk means the interview already happened.

1. **Summarise it back** in a few lines, with the spec's entities and picks, and ask what changed.
2. **Ask only about what moved**, plus every `weak:` and `weak-accepted:` tag, which is exactly the thread a second pass should pick up. "Last time 'it's faster' had no number behind it. Do you have one now?" Carry samples on those questions too.
3. **A brief with no spec** comes from before the product part existed. Ask questions 11 to 15 to write one.
4. **Update `Last updated`** in each file you change, and rewrite only the sections that changed.
5. **If a file was hand-edited**, that wins. Do not tidy someone's prose back into your own phrasing.
6. **End with the read-back** when anything in the spec or the frontmatter changed, so the owner confirms it once more.

## Unattended run

`autonomy: afk` in the brief's frontmatter means a person confirmed the read-back and is not at the keyboard now. Ask nothing in this run: no question, no confirmation, no preview that waits for an answer. The attended interview above never runs here, because only a person can answer it.

1. **Check that the brief is complete.** It is complete when all ten answers are present and filled: Name, Language, Audience, Problem, Current alternative, Differentiator, Proof, Tone, Pricing, and Where "sign up" goes. An honest empty answer ("no proof yet", "no pricing yet") counts as filled, and so does an answer tagged `weak-accepted:`. An answer tagged `weak:`, a missing section, or an empty one does not. `Known gaps` and any extra section are not checked.
2. **With an incomplete brief, stop.** Append each missing, empty or weak section to `docs/build-log.md` under `## Blocked`, one list item each, naming the section and what is wrong (`- Product brief: Proof is empty`). Create the file with a `# Build log` title when it does not exist, and add the `## Blocked` heading when it is not there. End the list with `- Product brief: fill these sections with /saasaloy-setup, or delete the autonomy line to work attended`. Write nothing else, and stop the run. An unattended build does not start the first module with a brief that is not complete.
3. **With a complete brief, set the two facts that are code.** Set `app.name` from Name and `app.locale` from Language's code in `packages/config/src/project.ts`, exactly as [Step 3](#step-3--set-the-two-facts-that-are-code) says, with no confirmation. Leave either one alone when it already matches the brief. Run `pnpm typecheck`.
4. **Log what you did** in `docs/build-log.md`: the name and the locale you set, or that both already matched, and the `pnpm typecheck` result. Add the lines under the current stage's `##` section when a build is running, and under a new `## Setup` section when none is. Write no hex string other than a commit hash, because the log's reader takes the first one in a section as its commit. The stage that commits adds its commit hash to that section.

Never edit the brief or the spec in this run. A wrong answer in either one is the owner's to fix.

## What happens next

The build starts in this session after the read-back, so nothing else is left to say. On a re-run with no build to follow, say so explicitly when you finish, because the brief on its own changes nothing the owner can see:

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

`saasaloy-build` runs after the read-back, in the same session. On a re-run with no build, `saasaloy-landing-copy` writes the landing page from the brief.
