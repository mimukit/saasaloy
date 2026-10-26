# QA Plan: infra-ci-deploy module

_Generated 2026-10-26 · against `a4922960` (clean except this plan) · covers issue #199, the `infra-ci-deploy` module, its workflow and its skill_

## Summary
- The module writes `.github/workflows/deploy.yml`, which runs `pnpm deploy:production` on every push to `main`.
- Working means a push to `main` in a real repository deploys every Worker and pushes a deploy tag.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- A throwaway GitHub repository you own, and a Cloudflare account you can deploy test Workers to.
- A Cloudflare API token with Workers Scripts edit (plus D1, KV, R2 and Queues edit for the bindings you install), and the account id.
- The CLI built from branch `issue-199-deploy-on-push-to-main-through-github-actions`.

Build the CLI from the worktree root with:

```sh
pnpm --filter saasaloy build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: New project pushed to a throwaway repository | A push to `main` deploys | 🔴 Critical |
| TC-1.2 | 1: New project pushed to a throwaway repository | A missing `ENV_PROD` fails with a clear message | 🟡 Normal |
| TC-1.3 | 1: New project pushed to a throwaway repository | The skill reads clearly | 🟢 Low |

## Scenario 1: New project pushed to a throwaway repository

**Setup.** Run once, for every case in this scenario.

1. Create a project in `.dev` and add the module.

```sh
node packages/cli/dist/index.js init .dev/qa199 --force && cd .dev/qa199 && cp ../../scripts/saasaloy-shim.sh saasaloy && ./saasaloy add infra-ci-deploy --yes
```

2. Fill `packages/env/.env.prod` with the production values of every key in `packages/env/.env.example`.
3. Commit, create the repository, and set the secrets.

```sh
git add -A && git commit -m "chore: first commit" && gh repo create <you>/qa199 --private --source . --push
```

```sh
gh secret set CLOUDFLARE_API_TOKEN && gh secret set CLOUDFLARE_ACCOUNT_ID && gh secret set ENV_PROD < packages/env/.env.prod
```

- [ ] Setup complete

### TC-1.1: A push to `main` deploys  ·  🔴 Critical

**Goal.** A push to `main` runs the workflow, deploys the landing page Worker, and pushes a deploy tag.

**Steps**

1. Push an empty commit to `main`, then watch the run.

   ```sh
   git commit --allow-empty -m "chore: trigger deploy" && git push && gh run watch
   ```

   - [ ] The `deploy` run is green, and its log shows every gate pass, the Worker upload and the smoke checks
2. Fetch the tags and open the Worker URL from the run log.

   ```sh
   git fetch --tags && git tag --list 'deploy-*'
   ```

   - [ ] One `deploy-<UTC time>` tag exists, and the Worker URL serves the landing page

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A missing `ENV_PROD` fails with a clear message  ·  🟡 Normal

**Goal.** A run with no production values stops before any upload and says which secret to set.

**Steps**

1. Delete the secret, push an empty commit, and watch the run.

   ```sh
   gh secret delete ENV_PROD && git commit --allow-empty -m "chore: no values" && git push && gh run watch
   ```

   - [ ] The run fails at "Write packages/env/.env.prod" with the message that names `ENV_PROD` and `ENV_SOURCE`
2. Set the secret again.

   ```sh
   gh secret set ENV_PROD < packages/env/.env.prod
   ```

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: The skill reads clearly  ·  🟢 Low

**Goal.** A project owner can set up CI deploys from the skill alone.

**Steps**

1. Read `.agents/skills/saasaloy-infra-ci-deploy/SKILL.md` in the project.
   - [ ] The secrets table and the migration steps are clear enough to follow without other docs

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
gh repo delete <you>/qa199 --yes && npx wrangler delete --name qa199-web
```

```sh
cd ../.. && rm -rf .dev/qa199
```

## Automated verification (by AI agent)
_Checks the agent ran itself at `a4922960`; lint, typecheck, CLI suite and scripts ran at `12f03688`, and the fix commit reran the module test, prettier and oxlint on the changed files. No action needed from the tester._

Commands run (one per block):

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
cd packages/cli && npx vitest run --coverage --maxWorkers=2
```

```sh
pnpm test:scripts
```

```sh
node packages/cli/dist/index.js init .dev/p199 --force --no-install && cd .dev/p199 && cp ../../scripts/saasaloy-shim.sh saasaloy && ./saasaloy add infra-ci-deploy --yes
```

```sh
./saasaloy remove infra-ci-deploy --yes
```

- ✅ `pnpm lint` → all four passes clean
- ✅ `pnpm typecheck` → exit 0
- ✅ CLI vitest → 71 files, 1822 tests passed, including `infra-ci-deploy-module.test.ts` (descriptor valid, `@root` target, push trigger, secrets, skill table)
- ✅ `pnpm test:scripts` → exit 0
- ✅ C6 · a fresh project with no module has no `.github/workflows/deploy.yml`
- ✅ C1 · `add infra-ci-deploy` writes `.github/workflows/deploy.yml` at the project root, byte-identical to the module file
- ✅ C2 · the written file parses as YAML with `on.push.branches: ["main"]`, and its last step runs `pnpm deploy:production`
- ✅ C3 · job `env` reads `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ENV_SOURCE`, `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` from `secrets.*`; the values step reads `secrets.ENV_PROD`
- ✅ C4 · the skill table lists all six secrets the workflow reads (test asserts it)
- ✅ C6 · `remove infra-ci-deploy` deletes the workflow and prunes `.github`
- ✅ B1 fix · the workflow sets `user.name` and `user.email` for `github-actions[bot]` before `pnpm deploy:production`; `infra-ci-deploy-module.test.ts` asserts it at a4922960 (4 tests passed)

### Browser checks
_No UI in this change. No driver ran._

## Not covered / needs human judgment
- A real GitHub Actions run (TC-1.1). The agent has no throwaway GitHub repository or Cloudflare account. This is acceptance criterion C5.
- The Infisical path (`ENV_SOURCE=infisical`) in a real run, and the CI wait step with the `ci` module (PR #279, not merged).
- The `workflow_dispatch` run with `migrate` checked.
- No `actionlint` on this box, so the workflow expressions are checked only by YAML parse and review.
- Accessibility, compatibility, performance: no UI and no runtime code.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
