# Make the project yours

A freshly scaffolded project runs, but it knows nothing about your product: the site name is your directory name, the landing page sells a placeholder, and the theme is shadcn's `neutral`. Three agent skills ship with the base to fix that, as real files in `.agents/skills/` with `.claude/skills/` symlinks, so any agent that reads skills can run them. In Claude Code they are slash commands.

Run the first two in order. The third runs whenever you want the look changed.

## 1. Tell the project what it is: `/saasaloy-setup`

The setup skill interviews you once — ten questions, starting with the product's name, each with sample answers you can take, edit, or ignore — and writes the answers to `docs/product-brief.md`. That brief is the shared context every other skill reads instead of interviewing you again.

It also sets the two facts that live in code rather than prose: `siteName` in `packages/ui/src/index.ts` and the page's `lang` attribute in `apps/web/src/layouts/Layout.astro`. It writes no landing copy.

Re-running it is how you update the brief later: it summarises what it has, asks only about what changed, and re-asks anything it recorded as weak.

## 2. Write the landing page: `/saasaloy-landing-copy`

The copy skill turns the brief into the landing page's words. It drafts everything into `docs/landing-copy-draft.md` first — every key, current value beside proposed — so you review a readable page, not thirty terminal messages. Edit the draft in place if you want different wording; once you approve, it writes `packages/ui/src/content/landing.ts`, verifies the build, and deletes the draft.

It needs the brief. Run without one and it offers to run `/saasaloy-setup` first rather than guessing.

## 3. Theme it, and keep the design contract true: `/saasaloy-design`

The design skill owns `DESIGN.md`, the design contract at the project root. It records the design system; it writes no components and no pages. Three modes:

- **`theme`** — pick a shadcn `registry:style` preset (from [ui.shadcn.com/create](https://ui.shadcn.com/create) or [tweakcn.com](https://tweakcn.com)), apply it to `packages/ui/src/styles/globals.css`, and re-derive `DESIGN.md` from the result. It reads the product brief for tone, so it too works better after step 1.
- **`update`** — re-derive the contract after you (or a module) change the design layer. `saasaloy add` reminds you to run this when an install writes into `packages/ui/`.
- **`audit`** — report where the code and the contract disagree, writing nothing.

## What arrives later

Every module you install brings its own `saasaloy-<name>` skill into the same `.agents/skills/` directory — the runbook for working inside that module. See [Add a module](add-a-module.md#the-skill-that-comes-with-it).

## Related

- [Getting started](../getting-started.md) — scaffold and run the project first.
- [Add a module](add-a-module.md) — install the API, database, auth and features.

_Verified against `main`@`a21fcce` on 2026-08-31._
