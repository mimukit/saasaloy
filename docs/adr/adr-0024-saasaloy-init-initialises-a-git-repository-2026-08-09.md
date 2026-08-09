# 0024 — `saasaloy init` initialises a git repository

`saasaloy init` runs `git init` in the scaffolded project, after the template copy and before the install prompt. It is guarded so it never nests a repository inside one that tracks the target, and it never throws — a missing `git` warns and init carries on, matching how `runPnpmInstall` already behaves. `pnpm play:init` dropped its own `git init` as a result, so the playground now gets its repository the same way a user's project does.

## Status
accepted

## Considered Options
- **Leave it to the user and document it** — rejected. The very next thing `init` offers is `pnpm install`, which runs the template's `prepare: "husky"`. Installing hooks with no `.git` is husky's documented failure case, so the default path would ship a project whose commit hooks silently did not exist. A README line does not fix a default.
- **Run `git init` only when the user opts in with a flag** — rejected for the same reason: the failure lands on whoever does not read the flag, and there is no case where a scaffolded project is better off without a repository.
- **Also make the first commit** — rejected, out of scope. `init` produces a working tree; what gets committed, and under whose name and email, is the user's call.
- **Guard on `git rev-parse --is-inside-work-tree` alone** — rejected after it was measured against this repo. `.dev/playground` sits inside the tool repo, so that guard alone would refuse to initialise the playground and quietly regress the three things below. See the consequence.
- **Keep `git init` in `pnpm play:init` as well** — rejected. Two code paths that both create the playground's repository is exactly the divergence between the maintainer path and the user path this change exists to remove.

## Consequences
- **Three things downstream need a repository, and all three degrade quietly without one.** husky refuses to install hooks outside a work tree. Turborepo hashes task inputs through git, and without `.git` the playground's `@repo/web:build` never invalidates when `packages/ui` changes — so `deps:verify` happily validates a cached build of the *previous* template. Tailwind's scanner honours `.gitignore` only through an ignore walker that needs a real `.git`, and without one it scans `node_modules` and the emitted stylesheet grows roughly 5x. None of the three produces an error.
- **The guard asks two questions, not one.** `git init` is skipped when the target is inside a work tree **and not ignored by it**. `saasaloy init ./apps/my-app` inside an existing project must not create a nested repository — but an *ignored* path is by definition not the outer repository's business, which is what makes `saasaloy init .dev/playground` inside this repo do the right thing. `git check-ignore --quiet .` is the second question.
- **It never throws.** A missing `git`, or a `git init` that fails for any reason, prints a warning naming the consequence (run it yourself before `pnpm install`, or the hooks will not install) and the scaffold still completes. Nothing about the generated project is invalid without a repository; it is only degraded.
- **CONTRIBUTING.md's "why `play:init` runs `git init`" section became a "why the playground is a git repository" section.** The reasons did not disappear, they moved into the CLI.
- **This is a CLI product decision on its own axis.** It fixes a linting prerequisite, but it also fixes Turborepo cache invalidation and Tailwind over-scanning, which nobody would think to look for inside a record about linting — which is why it is its own ADR.

## References
Issue [#71](https://github.com/mimukit/saasaloy/issues/71), Phase 5. Plan: [`plan-linter-adoption-2026-08-08.md`](../plans/plan-linter-adoption-2026-08-08.md). Manual QA: [`docs/qa/qa-init-git-init-2026-08-09.md`](../qa/qa-init-git-init-2026-08-09.md). Sibling record: [ADR 0023](adr-0023-generated-projects-ship-a-lint-and-hook-toolchain-2026-08-09.md).
