---
name: release
description: Release a new version of the saasaloy CLI from this repo, from the readiness checks through the tag, the GitHub Release, the docs site deploy, the owner's npm approval and the check that npm and saasaloy.com serve the new version. Use when the maintainer says "release the CLI", "cut 0.10.0", "ship a new version", "publish to npm", "is main ready to release", or "the publish failed", even if they do not name the skill.
---

# release

This skill releases `packages/cli` as [`saasaloy`](https://www.npmjs.com/package/saasaloy) on npm. It holds the order of the steps and the points where the agent stops for the owner. The rules live in one place, `CONTRIBUTING.md`, section "Releasing". Read that section at the start of every run, because this file names its subsections and does not copy them. When the two disagree, `CONTRIBUTING.md` is right, and this file needs a fix.

**Ground truth:** `CONTRIBUTING.md` "Releasing", [ADR 0062](../../../docs/adr/0062-adr-the-default-registry-reads-the-release-tag-of-the-cli-2026-11-17.md) (the CLI reads the registry at its own tag), [ADR 0064](../../../docs/adr/0064-adr-the-cli-publishes-from-a-tag-started-approved-oidc-workflow-2026-11-19.md) (the tag starts `publish.yml`, the owner approves, npm trusted publishing), `packages/cli/.release-it.js`, `scripts/release-preflight.ts`, `.github/workflows/publish.yml`.

## What the release does

One command, `pnpm release`, runs release-it in `packages/cli`:

1. The `before:init` hook runs `pnpm release:preflight`. It checks the token, the sync with origin, the update notes, the stale docs pages (a warning only), the npm state of the last tag, the benchmark suggestion (a warning only) and `llms.txt`. Then it runs the full gate and the tarball smoke. This takes about five minutes.
2. release-it sets the version in `packages/cli/package.json`, writes `packages/cli/CHANGELOG.md`, commits `chore(release): vX.Y.Z`, tags `vX.Y.Z`, pushes, and creates the GitHub Release.
3. The `after:release` hook deploys saasaloy.com at the tag, through `wrangler deploy --tag vX.Y.Z`.
4. The tag push starts `.github/workflows/publish.yml`. Its `publish` job waits in the GitHub environment `npm` for the owner's approval, then publishes with provenance.

Steps 2 to 4 cannot be undone. After the push, the version is spent.

## Stop points

The agent stops and waits for the owner at these points, and at no other:

- **The plan.** Before `pnpm release`, the owner confirms the version and the command (step 4 below).
- **A login, a token or a secret.** The agent asks for it and never starts a browser login (step 3).
- **The npm approval.** The owner approves the `publish` job on GitHub. The agent never approves it, also when its token could (step 6).
- **A decision after the push.** A failure after the tag goes to the owner with the recovery steps from `CONTRIBUTING.md` (step 8).

## Procedure

### 1. Decide whether to release

Read the commits since the last tag:

```sh
git fetch origin main --tags --quiet && tag="$(git describe --tags --match='v*' --abbrev=0 origin/main)" && echo "$tag" && git log --no-merges --format='%h %s' "$tag..origin/main"
```

Apply "When to release" in `CONTRIBUTING.md`. A change under `packages/cli/**` or `modules/**` calls for a release. Commits that are all `docs`, `chore` or `refactor` do not. If nothing calls for a release, say so and stop.

### 2. Pick the version

Read the version in `packages/cli/package.json` on `origin/main`, and compare it with the last tag.

- **The file holds a higher version than the tag.** A PR already set it, as "Modules that need a new CLI" requires. Use that version, with `--only-version`.
- **The file holds the tag's version.** Propose the bump from "Picking the bump": before `1.0.0`, a breaking change or a `feat` is a minor bump, and a `fix` or `perf` is a patch bump. release-it sets the version in the release commit, so no PR is needed. Never propose `1.0.0`. Only the owner decides it.

Always pass the version on the command line. Without it, `--ci` makes release-it pick a bump on its own.

### 3. Check that this box can release

Run these read-only checks, and collect every result before you report. Use the repo checkout on `main`, never a worktree, because the release commit and tag belong on `main`.

| Check | Command | Pass |
|---|---|---|
| Branch | `git branch --show-current` | `main` |
| Clean tree | `git status --short` | no output |
| In sync | `git rev-parse HEAD origin/main` | both lines equal; if behind, run `git pull --ff-only` |
| GitHub | `gh auth status` | logged in to `mimukit`, scopes include `repo` and `workflow` |
| Cloudflare | `pnpm --filter @saasaloy/web exec wrangler whoami` | lists the `account_id` in `apps/web/wrangler.jsonc` |
| Docker | `docker info --format '{{.ServerVersion}}'` | a version; the smoke starts Postgres with `docker compose` |
| Last tag on npm | `npm view saasaloy@<last tag version> version` | prints the version; E404 means the last publish never finished, see step 8 |
| Update notes | `node --input-type=module -e 'import("./scripts/release-preflight.ts").then((m) => m.runUpdateNoteCheck())'` | ends with "every breaking commit since vX has an update note" |
| Stale docs | `pnpm docs:stale` | "every hand-written page is current" |

npm needs no login on this box. `publish.yml` publishes through trusted publishing.

When a login is missing, ask the owner for it. On a headless box a browser login hangs, so ask for a token: a GitHub token with the `repo` and `workflow` scopes for `GITHUB_TOKEN`, or a Cloudflare API token for `CLOUDFLARE_API_TOKEN`. Never write a token into a file in the repo.

Two checks need a decision rather than a fix:

- **Stale docs.** For each listed page, read it against the commits that `docs:stale` names, fix the text that is now wrong, and move its stamp line to the current `main` commit and date. A page whose text is still right gets only the new stamp. These edits go to `main` in their own `docs(wiki)` commit before the release, because the site deploys the pages at the tag. The preflight only warns, so the owner may also release first and fix the pages later.
- **The benchmark.** The benchmark is on demand and never blocks a release. Run the check from "The agent benchmark" in `CONTRIBUTING.md` early: compare `git diff --name-only <last tag>..HEAD` with the gated paths, and read the newest score report in `docs/research/`. When the release touches a gated path and no report covers it, suggest a run to the owner in step 4, with the reason and the cost (about an hour and agent usage). Start a run only when the owner asks for one. Without that request, the release goes on.

### 4. Confirm the plan with the owner

Report the readiness table, the commits since the last tag, the version, and the exact command. When step 3 found that a benchmark run is suggested, say so and name the gated paths, but do not wait for a run. Then ask the owner to confirm. Name what the release does that cannot be undone: the tag, the push to `main`, the GitHub Release and the site deploy.

The command is one of these:

```sh
pnpm release X.Y.Z --ci                  # release-it sets X.Y.Z in the release commit
pnpm release X.Y.Z --only-version --ci   # packages/cli/package.json already holds X.Y.Z
```

The agent adds `--ci` because it has no TTY, and release-it's yes/no prompts would wait for ever. The owner's confirmation in this step takes the place of those prompts. A maintainer at a terminal runs the same command without `--ci` and answers the prompts.

Do not continue without an explicit yes.

### 5. Run the release

Run the command from the repo root, in the background, with the output in a log file in your scratch directory. Wait for it to exit, and do not poll it in a loop.

When it exits 0, read the end of the log. It should show these lines, then `🏁 Done`:

```
✔ Git commit
✔ Git tag
✔ Git push
✔ GitHub create release
✔ pnpm -w run release:deploy vX.Y.Z
```

When it exits non-zero, find the first failed step in the log, and go to step 8.

### 6. Hand the npm approval to the owner

Find the `publish` run for the tag:

```sh
gh run list --workflow publish.yml --limit 1 --json databaseId,headBranch,status,url
```

Wait until its `build` job has passed: `gh run view <run id> --json jobs -q '.jobs[] | .name + " " + .status + " " + (.conclusion // "")'`. Then give the owner the run URL and these steps: select **Review deployments**, tick `npm`, select **Approve and deploy**. Stop until the owner says it is approved.

If the `publish` job ran with no approval, the environment `npm` has lost its required reviewer. Tell the owner, and name the fix in "Approving the publish".

### 7. Check what users get

After the `publish` job passes, npm needs one or two minutes before it serves the version. Ask the registry directly, because the local npm cache can hold the old answer:

```sh
curl -s -H 'Cache-Control: no-cache' https://registry.npmjs.org/saasaloy | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s)["dist-tags"].latest))'
```

Check again every 15 seconds for up to five minutes, until it prints `X.Y.Z`. Then check the rest:

| Check | Command | Pass |
|---|---|---|
| npm version | `npm view saasaloy@X.Y.Z version --prefer-online` | `X.Y.Z` |
| Provenance | `npm view saasaloy@X.Y.Z dist.attestations.provenance --json` | holds `predicateType` |
| Site | `curl -s https://saasaloy.com/docs \| grep -o 'vX.Y.Z' \| head -1` | `vX.Y.Z` |
| GitHub Release | `gh release view vX.Y.Z --json url -q .url` | a URL |
| Local main | `git status -sb` | `## main...origin/main` |

Report each result, the release URL and the publish run URL.

### 8. When something fails

Read the matching section of `CONTRIBUTING.md` before you act. Never rerun `pnpm release` for a version that has a tag, never move or delete a tag, and never rewrite `main`.

| Symptom | Cause | Action |
|---|---|---|
| Preflight: `GITHUB_TOKEN is empty` | no GitHub login | ask the owner for a token, then rerun step 5 |
| Preflight: `main is not in sync with origin` | local `main` is behind | `git pull --ff-only`, then rerun step 5 |
| Preflight: breaking change without an update note | a breaking commit has no note | "Breaking changes need an update note"; the fix is a new commit with `Update-Note-For: <full sha>` |
| Preflight: `vX is not published on npm` | the last publish never finished | finish that publish first, with the rows below |
| Preflight: a gate script or the smoke failed | a real failure on `main` | fix it on `main` with a normal commit, then rerun step 5; `SAASALOY_RELEASE_SKIP_GATE=1` only when the gate just passed on this exact tree |
| `release:deploy` failed after the push | Cloudflare login or build | run the rerun command the hook printed, then `git checkout main` |
| `publish` job: `npm error 404 Not Found - PUT https://registry.npmjs.org/saasaloy` | the trusted publisher on npmjs.com is missing or does not match | the owner opens the package's Access settings on npmjs.com and sets GitHub Actions, `mimukit`, `saasaloy`, `publish.yml`, environment `npm`; then `gh run rerun <run id> --failed` and a new approval |
| `publish` job: any other failure | see the log | `gh run view <run id> --log-failed`, then "If the publish fails" |
| GitHub Release missing after the push | release-it stopped after the push | `gh release create vX.Y.Z --notes-from-tag` |

The token publish in "If the publish fails" is for a GitHub Actions outage only. It has no provenance and needs the owner's npm login with 2FA, so only the owner starts it.

## Hand-off

Close with:

- The version, the release commit, and the GitHub Release URL.
- The site result: the footer shows `vX.Y.Z`, or the deploy failed and its rerun command.
- The npm result: `latest` is `X.Y.Z` with provenance, or the publish run URL and what it waits for.
- Any page that `docs:stale` listed and the owner chose to fix later.
- One next move. When everything passed, there is none.
