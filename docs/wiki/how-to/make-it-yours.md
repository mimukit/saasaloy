# Make the project yours

A freshly scaffolded project runs, but it knows nothing about your product: the site name is `Saasaloy`, the landing page describes Saasaloy itself, and the theme uses shadcn's `neutral` base color, unless you passed `--theme=<cobalt|ember|moss>` to `saasaloy init`. The page has thirteen sections; remove the ones you don't need by deleting their line in `apps/web/src/pages/index.astro` (the project README has the recipe). Three of the eleven agent skills that ship with the base fix that. They live as real files in `.agents/skills/` with `.claude/skills/` symlinks, so any agent that reads skills can run them. In Claude Code they are slash commands.

Start with setup. When you ask for a full MVP, setup leads to design approval and then the build. You can also run the landing copy and theme skills on their own.

## 1. Tell the project what it is: `/saasaloy-setup`

The setup skill uses your product description and asks for missing details. It writes the landing page facts in `docs/product-brief.md`. It writes the product entities, build order and module choices in `docs/product-spec.md`. Review and approve both before the agent proposes a design.

In the MVP workflow, the agent shows brand values and mockup images after product approval. Design approval authorizes the unattended build in the same session. The Brand stage sets `app.name` and `app.locale` in `packages/config/src/project.ts`. See [Build with an agent](build-with-an-agent.md) for the full workflow.

Re-running it is how you update the brief later: it summarises what it has, asks only about what changed, and re-asks anything it recorded as weak.

## 2. Write the landing page: `/saasaloy-landing-copy`

The copy skill turns the brief into the landing page's words. It drafts everything into `docs/landing-copy-draft.md` first — every key, current value beside proposed — so you review a readable page, not thirty terminal messages. Edit the draft in place if you want different wording; once you approve, it writes `packages/ui/src/content/landing.ts`, verifies the build, and deletes the draft.

It needs the brief. Run without one and it offers to run `/saasaloy-setup` first rather than guessing.

## 3. Theme it, and keep the design contract true: `/saasaloy-design`

The design skill owns `apps/web/DESIGN.md`, the web app's design contract. It records the design system; it writes no components and no pages. Four modes:

- **`review`** proposes colors, typography and mockup images for the approved product. It starts the MVP build after you approve the design.
- **`theme`** — pick a shadcn `registry:style` preset (from [ui.shadcn.com/create](https://ui.shadcn.com/create) or [tweakcn.com](https://tweakcn.com)), apply it to `packages/ui/src/styles/brand.css`, and re-derive `apps/web/DESIGN.md` from the result. It reads the product brief for tone, so it too works better after step 1.
- **`update`** — re-derive the contract after you (or a module) change the design layer. `saasaloy add` reminds you to run this when an install writes into `packages/ui/`.
- **`audit`** — report where the code and the contract disagree, writing nothing.

## What arrives later

Every module you install brings its own `saasaloy-<name>` skill into the same `.agents/skills/` directory — the runbook for working inside that module. See [Add a module](add-a-module.md#the-skill-that-comes-with-it).

## Related

- [Getting started](../getting-started.md) — scaffold and run the project first.
- [Add a module](add-a-module.md) — install the API, database, auth and features.

_Verified against `main`@`e2830008` on 2026-11-22._
