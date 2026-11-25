# 0071: The site deploys from main with content from the release tag

saasaloy.com deployed only with a CLI release. The `after:release` hook in `packages/cli/.release-it.js` ran `deploy:release` at the `v*` tag, and plan [0114](../plans/0114-plan-docs-site-2026-11-19.md) grill Q14 ruled out every other path: "No side door deploys `main` to production." The reason is real. The CLI ships the modules inside its npm package, so the docs must describe the published CLI. On 2026-11-25, `main` was 42 commits after `v0.12.0`, with 73 files changed under `docs/wiki/` and 48 under `modules/`. But the rule also held back changes to the site itself: the SEO fixes in `a3a4891c` and `3acefa83` touch only `apps/web/` and could not go live. Settled in the grill of plan [0127](../plans/0127-plan-site-deploy-without-release-2026-11-25.md) on 2026-11-25.

**A site deploy builds the site code from `origin/main` and the content from the tag of the npm `latest` version.** The owner runs `pnpm site:deploy` by hand. `apps/web/scripts/deploy-site.ts` reads `npm view saasaloy version`, fails when the version is a prerelease or when its tag `vX` does not exist, and builds in a detached worktree under the OS temp folder. The worktree goes away on success and on failure. The wrangler version carries the tag `site-<sha7>` and the message `site <sha7> with content vX`, so the Cloudflare version list tells a site deploy from a release deploy, which keeps `--tag vX`.

**The content paths** are `docs/wiki/`, `modules/`, `packages/cli/package.json` and `llms.txt`, listed once as `CONTENT_PATHS` in `apps/web/scripts/site-content.ts`. These are the only paths outside `apps/web` that the site build reads. The docs header reads the version from `packages/cli/package.json`, so it shows the content release, and the footer shows the site commit from `git log -1`.

**The overlay goes one way.** The build tree is `main`, and `git checkout vX -- <CONTENT_PATHS>` puts the content from the tag on top of it. The reverse, a tag tree with `apps/web` from `main`, pairs `main`'s `apps/web/package.json` with the tag's `pnpm-lock.yaml`, and the frozen install fails.

**A drift guard keeps the list true.** `apps/web/scripts/site-content.test.ts` scans `apps/web/src` and `apps/web/astro.config.mjs` for each relative path that leaves `apps/web`, and each repo-relative join on `repoRoot`. It fails when the path is under neither `CONTENT_PATHS` nor `CODE_PATHS`, so a new read that nobody classified fails a test, not a deploy.

## Status

accepted. It supersedes plan 0114 grill Q14. The release deploy of plan 0114 Phase 6 stays as it is: at a tag, the site commit and the content tag are the same commit.

## Considered Options

- **Deploy `main` as it is.** Rejected. A reader copies a command for a module or a flag that the published CLI does not have.
- **Versioned docs, `/docs` for the release and `/docs/next` for `main`.** Rejected. Two builds, a version switcher and canonical URLs per version cost too much for this problem.
- **A tag tree with `apps/web` from `main`.** Rejected. The lockfile and the web app's `package.json` then come from different commits, and a frozen install fails.
- **A CI job that deploys on a push to `main`.** Rejected. It puts a Cloudflare secret into `site.yml` for a deploy the owner runs a few times per release.

## Consequences

- A site-only change ships when it is ready. A docs change, a module change or a new CLI command still waits for a release, because its files are content.
- A site change that needs content newer than the release fails its build, and the script says the change waits for the next release.
- The site build reads `PUBLIC_CF_ANALYTICS_TOKEN` from the shell, because a fresh worktree has no gitignored env file. The script prints whether it is set.
- A new read outside `apps/web` goes on one of the two lists in the same change, or the drift guard fails.
- `pnpm --filter @saasaloy/web exec wrangler rollback` returns production to an earlier version, and the `site-<sha7>` and `v<version>` tags name each one.
