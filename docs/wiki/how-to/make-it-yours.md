# Make the project yours

A freshly scaffolded project runs, but it knows nothing about your product: the site name is `Saasaloy`, the landing page describes Saasaloy itself, and the theme uses shadcn's `neutral` base color. The page has thirteen sections; remove the ones you don't need by deleting their line in `apps/web/src/pages/index.astro` (the project README has the recipe). Three of the eleven agent skills that ship with the base fix that. They live as real files in `.agents/skills/` with `.claude/skills/` symlinks, so any agent that reads skills can run them. In Claude Code they are slash commands.

Run the first two in order. The third runs whenever you want the look changed.

## 1. Tell the project what it is: `/saasaloy-setup`

The setup skill interviews you once, in about fifteen questions, starting with the product's name. Each question has sample answers you can take, edit, or ignore. The first ten go to `docs/product-brief.md`: the landing page's audience, problem, proof, tone, pricing and sign-up link. The last five go to `docs/product-spec.md`: the entities your product keeps (the agent proposes a table for each and you correct it), their order, the optional modules, the database driver, and whether to deploy a preview. Every other skill reads these two files instead of interviewing you again.

It also sets the two facts that live in code rather than prose: `app.name` and `app.locale` in `packages/config/src/project.ts`. `siteName` and the page's `lang` attribute read them. It writes no landing copy.

The interview ends with one read-back: the brief, the module list, each entity with its screens, the wishes this build leaves out, and the steps that stay yours. You confirm it once. That confirmation accepts each thin answer as written (it is tagged `weak-accepted:`, and the copy leaves its claim out), approves the screens, and writes `autonomy: afk` into the brief's frontmatter. Then the skill starts `saasaloy-build` in the same session, and [Build with an agent](build-with-an-agent.md) takes over. To build attended instead, say so at the read-back. To work attended later, delete the `autonomy` line, or ask the skill for the interview.

Re-running it is how you update the brief later: it summarises what it has, asks only about what changed, and re-asks anything it recorded as weak.

## 2. Write the landing page: `/saasaloy-landing-copy`

The copy skill turns the brief into the landing page's words. It drafts everything into `docs/landing-copy-draft.md` first — every key, current value beside proposed — so you review a readable page, not thirty terminal messages. Edit the draft in place if you want different wording; once you approve, it writes `packages/ui/src/content/landing.ts`, verifies the build, and deletes the draft.

It needs the brief. Run without one and it offers to run `/saasaloy-setup` first rather than guessing.

## 3. Theme it, and keep the design contract true: `/saasaloy-design`

The design skill owns `apps/web/DESIGN.md`, the web app's design contract. It records the design system; it writes no components and no pages. Three modes:

- **`theme`** — pick a shadcn `registry:style` preset (from [ui.shadcn.com/create](https://ui.shadcn.com/create) or [tweakcn.com](https://tweakcn.com)), apply it to `packages/ui/src/styles/brand.css`, and re-derive `apps/web/DESIGN.md` from the result. It reads the product brief for tone, so it too works better after step 1.
- **`update`** — re-derive the contract after you (or a module) change the design layer. `saasaloy add` reminds you to run this when an install writes into `packages/ui/`.
- **`audit`** — report where the code and the contract disagree, writing nothing.

## What arrives later

Every module you install brings its own `saasaloy-<name>` skill into the same `.agents/skills/` directory — the runbook for working inside that module. See [Add a module](add-a-module.md#the-skill-that-comes-with-it).

## Related

- [Getting started](../getting-started.md) — scaffold and run the project first.
- [Add a module](add-a-module.md) — install the API, database, auth and features.

_Verified against `main`@`928b4f03` on 2026-11-19._
