# QA Plan: Deploy the site without a CLI release

_Generated 2026-11-25 · updated 2026-11-25 · against `495cd015` (clean apart from this plan) · covers issue #401: the content-path drift guard, `pnpm site:deploy`, ADR 0071 and the deploy docs_

## Summary
- `pnpm site:deploy` builds the site code from `origin/main` with the content of the npm `latest` tag, and deploys it with wrangler.
- Working means a site-only change goes live while the docs still describe the published CLI.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-401-deploy-the-site-without-a-cli-release`, merged to `main` and pushed.
- Wrangler is logged in to the Brainaloy Labs account. Check it with the command below.
- Screenshots: none. The change adds no page, so the cases judge command output and live HTTP responses.

```sh
pnpm --filter @saasaloy/web exec wrangler whoami
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Clean, pushed `main` | The first site deploy ships the SEO fixes with `v0.12.0` content | 🔴 Critical |

## Scenario 1: Clean, pushed `main`

**Setup.** Run once, for every case in this scenario.

1. Switch to `main` in the main checkout and update it.

```sh
git switch main && git pull --ff-only
```

- [ ] Setup complete

### TC-1.1: The first site deploy ships the SEO fixes with `v0.12.0` content  ·  🔴 Critical

**Goal.** A production site deploy serves `main`'s site code and only the `v0.12.0` docs.

**Steps**

1. Run the deploy.

   ```sh
   pnpm site:deploy
   ```

   - [ ] The output names the `origin/main` commit and `content tag v0.12.0`, and wrangler reports a deployed version tagged `site-<sha7>`
2. Read the response headers of a raw docs page.

   ```sh
   curl -sI https://saasaloy.com/docs/cli.md
   ```

   - [ ] The headers include `x-robots-tag: noindex`
3. Read the title and the version of the CLI docs page.

   ```sh
   curl -s https://saasaloy.com/docs/cli | grep -o -e '<title>[^<]*</title>' -e 'saasaloy v0\.[0-9.]*' | sort -u
   ```

   - [ ] The title is `CLI commands | Saasaloy docs: SaaS starter kit`, and the version is `saasaloy v0.12.0`
4. Request a docs page that `main` added after `v0.12.0`, if one exists. Find the candidates with the first command, then request one slug.

   ```sh
   git diff --name-only --diff-filter=A v0.12.0 origin/main -- docs/wiki
   ```

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://saasaloy.com/docs/<slug>
   ```

   - [ ] The page returns `404`, or the first command lists no page
5. Open the Cloudflare version list.

   ```sh
   pnpm --filter @saasaloy/web exec wrangler versions list
   ```

   - [ ] The newest version carries the tag `site-<sha7>` and the message `site <sha7> with content v0.12.0`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Not needed. To return production to the earlier version, run the rollback.

```sh
pnpm --filter @saasaloy/web exec wrangler rollback
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm --filter @saasaloy/web test
```

```sh
pnpm lint
```

```sh
pnpm docs:check
```

```sh
grep -c "no other deploy path" CONTRIBUTING.md
```

```sh
pnpm site:deploy --dry-run
```

- ✅ C1 · `apps/web/scripts/site-content.ts` exports `CONTENT_PATHS` (`docs/wiki`, `modules`, `packages/cli/package.json`, `llms.txt`) and an empty `CODE_PATHS` → `site content paths` suite passes
- ✅ C2 · the drift guard passes on the current tree and finds the six known reads → `pnpm --filter @saasaloy/web test`: 114 tests, 0 fail; `pnpm test` exit 0 on the tree of `495cd015`
- ✅ C3 · a temporary `../../../../README.md?raw` import in `src/pages/llms.txt.ts` fails the guard → message `apps/web/src/pages/llms.txt.ts:8 reads README.md`; the file was restored, and `git status --porcelain` is empty
- ✅ C4 · `contentTag` maps `0.12.0` to `v0.12.0` and throws on `""` and `0.13.0-beta.1` → `contentTag` suite passes
- ✅ C5 · `siteDeployPlan` returns the five steps, with the content step `git checkout --no-overlay <tag> -- <paths>`, `--tag site-<sha7>` and `--message "site <sha7> with content <tag>"` → `siteDeployPlan` suite passes. At `af1cfd09` the content step had no `--no-overlay` (blocker B1); `495cd015` fixes it
- ✅ C6 · the worktree is removed on success, on a failed build and on a thrown step → `runDeploy` suite passes; the dry run below left `git worktree list` at 9 entries before and after
- ✅ C7 · the script fetches tags, checks the tag, warns on a local `main` that differs, and prints the site commit, the tag and the token state → dry run printed `site commit b8c975be… (origin/main)`, `content tag v0.12.0`, `PUBLIC_CF_ANALYTICS_TOKEN is not set`
- ✅ C8 · a failed build prints "this change waits for the next release" → `messages` and `runDeploy` suites pass
- ✅ C9 · `pnpm site:deploy --dry-run` → exit 0 on the tree of `495cd015`; wrangler `--dry-run: exiting now`; `git worktree list` at 9 entries before and after. A rebuild of the same steps had `/docs/*.md` with `X-Robots-Tag: noindex` in `dist/client/_headers`, `saasaloy v0.12.0` and the title `CLI commands | Saasaloy docs: SaaS starter kit` in `/docs/cli`
- ✅ B1 · the build tree equals `v0.12.0` under every content path → `git -C <tree> diff --quiet v0.12.0 -- docs/wiki modules packages/cli/package.json llms.txt` exit 0; `modules/admin/update-notes/0007-preview-port.md`, added on `main` after the tag, is absent
- ✅ C10 · ADR 0071 records the split, the content paths, the overlay direction and the drift guard, and its Status says it supersedes plan 0114 grill Q14
- ✅ C11 · `CONTRIBUTING.md` has "Deploying a site-only change", says a docs change still waits for a release, and gives `pnpm --filter @saasaloy/web exec wrangler rollback` → `grep -c "no other deploy path"` prints `0`
- ✅ C12 · the `.github/workflows/site.yml` header names the `after:release` hook and `pnpm site:deploy`
- ✅ C13 · `pnpm docs:check` exit 0 (60 generated pages are current), `pnpm lint` exit 0, both on the tree of `495cd015`

## Not covered / needs human judgment
- The production deploy and the live site (C14). It is attended, and only the owner runs it.
- A real `wrangler deploy` upload. The agent ran `--dry-run` only.
- A build with `PUBLIC_CF_ANALYTICS_TOKEN` set. No build sets the token today.
- TC-1.1 step 4 on the live site. `main` adds no wiki page after `v0.12.0` today, so the step has no page to request. The agent check B1 above covers the rule.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
