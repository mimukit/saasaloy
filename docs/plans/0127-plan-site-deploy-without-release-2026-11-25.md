# Plan: deploy the site without a CLI release

Grilled: 2026-11-25

## Context

saasaloy.com deploys only with a CLI release. The release-it `after:release` hook in `packages/cli/.release-it.js` runs `deploy:release` at the `v*` tag, and `apps/web/scripts/deploy-release.ts` refuses to run when `HEAD` is not at that tag. `CONTRIBUTING.md` line 598 says "Production has no other deploy path. A site-only fix ships with the next patch release." That rule comes from plan 0114, grill Q14.

The rule has one real reason. The CLI ships the modules inside its npm package, so the docs must describe the published CLI. On 2026-11-25, `main` was 42 commits after `v0.12.0`, with 73 files changed under `docs/wiki/` and 48 under `modules/`. A deploy of `main` would describe modules and commands that `npx saasaloy` does not have.

The problem: a change to the site itself waits for a CLI release too. The SEO fixes in `a3a4891c` (noindex on the `.md` copies) and `3acefa83` (longer titles and descriptions) touch only `apps/web/`, and they cannot go live today.

The goal: a site change ships when it is ready, and the docs still describe the published CLI.

Target: the SEO fixes are live on saasaloy.com with no new CLI release. `curl -sI https://saasaloy.com/docs/cli.md` shows `x-robots-tag: noindex`, `/docs/cli` has the title `CLI commands | Saasaloy docs: SaaS starter kit`, and the docs header still says `saasaloy v0.12.0`.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| The split | Site code comes from `main`. Content comes from the latest release tag. The owner picked this over a plain `main` deploy and over versioned docs on 2026-11-25. |
| Content paths | `docs/wiki/`, `modules/`, `packages/cli/package.json` and `llms.txt`. These are the only paths outside `apps/web` that the site reads: `src/content.config.ts`, `src/lib/docs.ts`, `src/lib/module-registry.ts`, `src/lib/cli-version.ts` and `src/pages/llms.txt.ts`. One exported list in the deploy script names them. |
| Overlay direction | The build tree is `main`, and the content paths come from the tag with `git checkout <tag> -- <paths>`. The reverse (a tag tree with `apps/web` from `main`) mixes `main`'s `apps/web/package.json` with the tag's `pnpm-lock.yaml`, and a frozen install fails. |
| Which commits | The site commit is `origin/main` after `git fetch origin --tags`, so only pushed code ships. When local `main` differs from `origin/main`, the script prints a warning and still builds `origin/main` (grill Q7, defaulted). |
| Which release supplies the content | The npm `latest` version: `npm view saasaloy version` gives `X`, and the content is tag `vX`. The script fails when tag `vX` does not exist. The docs then match what `npx saasaloy` installs, also in the window between a release tag and the owner's npm approval (grill Q1, asked). |
| Prerelease tags | Never content. npm `latest` is a stable version, and the script fails if the version has a `-` (grill Q3, defaulted). |
| Where it builds | A temporary detached worktree under the OS temp folder. The script runs `pnpm install --frozen-lockfile --filter @saasaloy/web...` (grill Q5, defaulted), builds and deploys there, and it removes the worktree in a `finally`, on failure too. The owner's checkout stays as it is. |
| Trigger | A manual root script, `pnpm site:deploy`, with `--dry-run`. No CI deploy job, so `site.yml` keeps no secrets. A push-to-deploy workflow is a non-goal. |
| Wrangler version metadata | `wrangler deploy --tag site-<sha7> --message "site <sha7> with content <tag>"`. A release deploy keeps `--tag v<version>`, so the Cloudflare version list shows which path made each version. |
| Version label | No UI change. The docs header reads the version from `packages/cli/package.json`, which comes from the tag. The footer commit comes from `git log -1` on `HEAD`, which is the site commit. So the page shows the content release and the site commit, as the owner asked. |
| Analytics token | The script passes `PUBLIC_CF_ANALYTICS_TOKEN` from the shell to the build, as `deploy:release` does, and prints whether it is set. A worktree has no gitignored env file. No build sets the token today, so the live site has no beacon (grill Q6, defaulted). |
| A site change that needs newer content | The build fails. The script then prints the site commit, the content tag and "this change waits for the next release" (grill Q4, defaulted). |
| Rollback | `pnpm --filter @saasaloy/web exec wrangler rollback`, documented in `CONTRIBUTING.md`. The `site-<sha7>` and `v<version>` tags identify each version (grill Q8, defaulted). |
| Release deploys | The `after:release` hook and `deploy:release` stay as they are. At a tag, the site commit and the content tag are the same commit. |
| Drift guard | A node:test file scans `apps/web/src` and `apps/web/astro.config.mjs` for each path that leaves `apps/web`, and it fails when that path is not under a content path or a listed code path. A new read that nobody adds to the list then fails the test, not the deploy. Runner: `node --test`, beside the script, as `deploy-release.test.ts` does. |
| Outward actions | Phase 4 is the only production deploy, and it waits for the owner. The grill commits this plan to `main` and pushes it. No issues are filed now (grill Q2, asked). |
| Record | ADR 0071 records the split and supersedes plan 0114 grill Q14. Plan 0114 gets no edit (grill Q9, defaulted). `CONTRIBUTING.md` and the header comment in `.github/workflows/site.yml` describe both deploy paths. |

## Approach

The approach adds a second deploy path for site-only changes. It reuses the shape of `apps/web/scripts/deploy-release.ts`: pure functions that plan the commands, a `runAll` that stops at the first failure, a `main` that does the git reads, and a test file for the pure part. `readBuildInfo` in `apps/web/src/lib/build-info.ts` and `cliVersion` in `apps/web/src/lib/cli-version.ts` need no change, because the overlay puts the right files and the right `HEAD` under them.

Rejected: a plain `main` deploy, because a reader copies a command for a module the published CLI does not have. Rejected: versioned docs (`/docs` and `/docs/next`), because two builds, a version switcher and per-version canonical URLs cost too much for this problem.

### Phase 1: the content-path list and its drift guard (#401)

- Add `apps/web/scripts/site-content.ts`. It exports `CONTENT_PATHS` (the four paths above) and `CODE_PATHS` (paths outside `apps/web` that are code and come from `main`; empty today).
- Add `apps/web/scripts/site-content.test.ts`. It finds each relative path in `apps/web/src/**` and `apps/web/astro.config.mjs` that leaves `apps/web`. It resolves the path against its file, and it fails when the result is under neither list. Test fixtures inside `*.test.ts` files do not count.

Done when: `pnpm --filter @saasaloy/web test` passes, and a temporary `import x from "../../../../README.md?raw"` in `src/pages/llms.txt.ts` makes the new test fail with the path in the message.

### Phase 2: the site deploy script (#401)

- Add `apps/web/scripts/deploy-site.ts` with pure functions:
  - `contentTag(npmVersion)` returns `v<version>`, and it throws on an empty value or a prerelease version.
  - `siteDeployPlan(siteSha, contentTag, worktree, dryRun)` returns the commands in order: `git worktree add --detach <worktree> <siteSha>`, `git -C <worktree> checkout <contentTag> -- <CONTENT_PATHS>`, `pnpm install --frozen-lockfile --filter @saasaloy/web...`, `pnpm --filter @saasaloy/web run build`, and `pnpm --filter @saasaloy/web exec wrangler deploy --tag site-<sha7> --message "site <sha7> with content <tag>"` (plus `--dry-run`).
  - `cleanupCommand(worktree)` returns `git worktree remove --force <worktree>`.
- `main` runs `git fetch origin --tags` and `npm view saasaloy version`. It checks that the content tag exists, warns when local `main` differs from `origin/main`, and prints the site commit, the content tag and whether `PUBLIC_CF_ANALYTICS_TOKEN` is set. It runs the plan through `runAll` and always runs the cleanup. On a build failure it prints "this change waits for the next release".
- Add `"deploy:site": "node scripts/deploy-site.ts"` to `apps/web/package.json` and `"site:deploy": "pnpm --filter @saasaloy/web run deploy:site"` to the root `package.json`.
- Add `apps/web/scripts/deploy-site.test.ts` for the content tag (a prerelease and an empty version throw), the plan, the wrangler tag and message, the `--dry-run` flag and the cleanup.

Done when: the tests pass, and `pnpm site:deploy --dry-run` prints the site commit and `v0.12.0`, builds, runs `wrangler deploy --dry-run`, and leaves no extra entry in `git worktree list`. A build from that run has the `noindex` rule in `dist/client/_headers` and `saasaloy v0.12.0` in the header of `/docs/cli`.

### Phase 3: the record (#401)

- Write `docs/adr/0071-adr-the-site-deploys-from-main-with-content-from-the-release-tag-2026-11-25.md`. It records the split, the content paths, the overlay direction and the drift guard, and it supersedes plan 0114 grill Q14.
- Edit `CONTRIBUTING.md` near line 598: keep the release deploy, add `pnpm site:deploy` for site-only changes, say that a docs change still waits for a release, and name the `wrangler rollback` command.
- Edit the header comment in `.github/workflows/site.yml` to name both deploy paths.
- Run `pnpm docs:generate` for the ADR index, and run `pnpm docs:stale` for the pages that cover the changed paths.

Done when: `pnpm docs:check` and `pnpm lint` pass, and `grep -n "no other deploy path" CONTRIBUTING.md` prints nothing.

### Phase 4: the first site deploy (#401)

Attended: a production deploy, which the owner approves and runs.

- Run `pnpm site:deploy` from a clean, pushed `main`.
- Check the live site with the commands in the target line.

Done when: `curl -sI https://saasaloy.com/docs/cli.md` shows `x-robots-tag: noindex`, `curl -s https://saasaloy.com/docs/cli` contains `<title>CLI commands | Saasaloy docs: SaaS starter kit</title>` and `saasaloy v0.12.0`, and a docs page added after `v0.12.0` returns 404.

## Open questions

None. The grill on 2026-11-25 settled every question.

## Non-goals

- A CI or push-to-deploy workflow. `site.yml` keeps no deploy job and no Cloudflare secret.
- Versioned docs or a `/docs/next` preview.
- Any change to the CLI release flow, `deploy:release` or the `after:release` hook.
- Preview deploys for pull requests.
