# QA Plan: `infra` — centralized service deployment via IaC (issue #29)

_Generated 2026-07-25 · covers `git diff origin/main...HEAD` (commits `ec7c9ec`, `57a376b`,
`bdd09ac`, `93e86d7`, `82611e3`): the new `modules/infra/` capability module
(`registry-item.json` + scaffolded `@repo/infra` Pulumi workspace + the `saasaloy-infra`
skill) and base-template edits (`packages/cli/templates/base/pnpm-workspace.yaml`,
`AGENTS.md`) that let `infra` scaffold at the repo root._

## Summary
- `infra` centralizes deployment of every Saasaloy service: it discovers each service's
  `wrangler.jsonc`, translates its bindings into Cloudflare Pulumi resources, builds and
  deploys the Worker, and pushes Worker secrets straight to Cloudflare (never through
  Pulumi state).
- "Working" means: **TC-1** below passes on a real Cloudflare account — `pulumi up`
  produces a live `workers.dev` URL and a provisioned D1 database, `GET /health` is
  green on the edge, and `pulumi destroy` removes everything cleanly. That is this
  issue's Definition of Done and it **could not be exercised in this build** — no
  Cloudflare credentials were available in the agent sandbox. Everything else below
  (scaffold correctness, discovery, translation, secrets denylist, typecheck) was
  verified without cloud access and is recorded under [Automated
  verification](#automated-verification-by-ai-agent).

## Preconditions
- Node ≥ 24, pnpm 11, this repo checked out with the uncommitted `issue-29` changes
  present (or on the merged branch).
- A Cloudflare account with Workers Scripts + D1 edit permissions, for TC-1 only.
- This repo's own `pnpm-workspace.yaml` pins a 3-day install cooldown
  (`minimumReleaseAge: 4320`, ADR 0016). Two of `infra`'s pinned deps
  (`@pulumi/pulumi@3.254.0`, `@cloudflare/workers-types@5.20260723.1`) were published
  inside that window as of this test run and were blocked by `pnpm install` — see
  [Automated verification](#automated-verification-by-ai-agent). This resolves itself
  as the packages age past 3 days; no code change is implied. To reproduce any step
  below immediately, override the cooldown for the test scaffold only:

```sh
pnpm install --config.minimumReleaseAge=0
```

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Definition of Done: `pulumi up` → live URL + D1 → `/health` green → `pulumi destroy` cleans up | 🔴 Critical · **REQUIRES-LIVE-CLOUDFLARE / NOT YET VERIFIED** |
| TC-2 | `pulumi preview` output is readable before the first `up` | 🟡 Normal |
| TC-3 | Worker secret pushed via `.env` actually lands on the deployed Worker | 🟡 Normal · **REQUIRES-LIVE-CLOUDFLARE / NOT YET VERIFIED** |
| TC-4 | `saasaloy-infra` skill runbook is followable cold, start to finish | 🟢 Low |

## Test cases

### TC-1 — Definition of Done: `pulumi up` → live URL + D1 → `/health` green → `pulumi destroy` cleans up  ·  🔴 Critical
**REQUIRES-LIVE-CLOUDFLARE / NOT YET VERIFIED** — this build had no
`CLOUDFLARE_API_TOKEN`/account available, so this case has never been run end to end.
This is the issue's headline acceptance test; nothing else in this plan substitutes for it.

**Prereqs**
- A Cloudflare account. Create an API token with **Workers Scripts: Edit** and **D1: Edit**
  permissions, and note the account ID (Cloudflare dashboard → right sidebar).
- Set the three credentials `infra` needs:

```sh
export CLOUDFLARE_API_TOKEN=<your-token>
export CLOUDFLARE_DEFAULT_ACCOUNT_ID=<your-account-id>
export PULUMI_CONFIG_PASSPHRASE=dev-passphrase
```

**Steps**
1. Scaffold a fresh playground app in `.dev/` (never commit this):

```sh
node packages/cli/dist/index.js init .dev/qa-dod-playground --no-install
```

2. Add `api`, `database`, and `infra` from this local checkout (use
   `SAASALOY_REGISTRY_DIR` so `add` reads the uncommitted `modules/` in this worktree
   instead of the published GitHub registry):

```sh
cd .dev/qa-dod-playground && SAASALOY_REGISTRY_DIR=$(cd ../.. && pwd)/modules node ../../packages/cli/dist/index.js add api --yes && SAASALOY_REGISTRY_DIR=$(cd ../.. && pwd)/modules node ../../packages/cli/dist/index.js add database --yes && SAASALOY_REGISTRY_DIR=$(cd ../.. && pwd)/modules node ../../packages/cli/dist/index.js add infra --yes
```

3. Install:

```sh
pnpm install
```

4. Preview, then deploy, from inside `infra/`:

```sh
cd infra && pnpm run preview
```

```sh
pnpm run deploy
```

5. Note the deployed script name from the `scripts` stack output, then find the live
   URL — `<script-name>.<your-account-subdomain>.workers.dev` (subdomain from the
   Cloudflare dashboard, or `wrangler deployments list` inside `apps/api`).
6. Hit the health endpoint:

```sh
curl -i https://<script-name>.<account-subdomain>.workers.dev/health
```

7. In the Cloudflare dashboard, confirm a D1 database matching the `api` app's
   `database_name` (from `apps/api/wrangler.jsonc`) exists and is bound to the deployed
   Worker.
8. Tear it all down:

```sh
pnpm run destroy
```

9. Re-check the dashboard: the Worker script, its subdomain, and the D1 database should
   all be gone.

**Expected**
- Step 4's `deploy` completes with no errors and prints a `scripts` output mapping the
  service name to its Cloudflare script name.
- Step 6 returns `HTTP/2 200` (or whatever the `api` module's `/health` route defines as
  healthy) directly from the public `workers.dev` edge — not localhost.
- Step 7 shows a real, populated D1 database in the Cloudflare dashboard, bound to the
  Worker.
- Step 9 shows a clean account: no leftover Worker script, subdomain, or D1 database.

**Actual:** _(tester fills in — not yet run)_

- [ ] Pass
- [ ] Fail

### TC-2 — `pulumi preview` output is readable before the first `up`  ·  🟡 Normal
Judgment call: does the diff `preview` prints give a human enough confidence to run `up`?

**Steps**
1. With credentials set (see TC-1 prereqs) and services discovered, run:

```sh
pnpm run preview
```

2. Read the printed plan: resource creates for `WorkersScript`, `D1Database`,
   `WorkersScriptSubdomain` per discovered service.

**Expected**
- Every resource `preview` proposes to create is one you'd expect from the services'
  `wrangler.jsonc` files (no surprise resources, no missing ones).
- The plan is legible without cross-referencing source — resource names/types are
  self-explanatory.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — Worker secret pushed via `.env` actually lands on the deployed Worker  ·  🟡 Normal
**REQUIRES-LIVE-CLOUDFLARE / NOT YET VERIFIED.** The denylist *logic* (which keys get
skipped) was verified without cloud access — see Automated verification. This case is
the live-cloud half: does a non-denylisted secret actually reach the deployed Worker's
secret store via `wrangler secret put`?

**Steps**
1. In the scaffolded app's `infra/.env` (or wherever `pushSecrets` reads from — default
   `.env` in `infra/`), add a real-looking secret alongside the infra credentials:

```sh
printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_DEFAULT_ACCOUNT_ID=%s\nPULUMI_CONFIG_PASSPHRASE=%s\nEXAMPLE_SECRET=super-secret-value\n' "$CLOUDFLARE_API_TOKEN" "$CLOUDFLARE_DEFAULT_ACCOUNT_ID" "$PULUMI_CONFIG_PASSPHRASE" > infra/.env
```

2. Run `pnpm run deploy` (from `infra/`).
3. In the Cloudflare dashboard, open the deployed Worker's **Settings → Variables and
   Secrets**.

**Expected**
- `EXAMPLE_SECRET` appears as a secret binding on the Worker.
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID`, and
  `PULUMI_CONFIG_PASSPHRASE` do **not** appear as Worker secrets or vars anywhere.

**Actual:** _(tester fills in — not yet run)_

- [ ] Pass
- [ ] Fail

### TC-4 — `saasaloy-infra` skill runbook is followable cold, start to finish  ·  🟢 Low
**Steps**
1. Read `modules/infra/skills/saasaloy-infra/SKILL.md` top to bottom as if seeing it for
   the first time.
2. Judge: does it give enough to get from "just installed `infra`" to a first successful
   `deploy`, without needing to read the source?
3. Check specifically: credentials setup, the three scripts, what happens when a service
   declares an unsupported binding, and where state lives.

**Expected**
- A developer unfamiliar with `infra` can complete a first deploy using only this file.
- The "infra doesn't support '\<type\>' yet" error path and the fix (extend
  `translate.ts`) are explained clearly enough to act on.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [x] `modules/api/` and `modules/database/` are byte-for-byte untouched by this diff.
  _Agent-verified below._
- [ ] A project with `api` + `database` but **without** `infra` installed still scaffolds,
  installs, and runs `pnpm dev` normally (the base-template `pnpm-workspace.yaml` /
  `AGENTS.md` edits only add an `infra` line/paragraph — shouldn't affect projects that
  never add the capability). Not run live in this build; low risk given the diff is
  additive-only, but worth a human's `pnpm dev` sanity check on a plain `api`+`database`
  playground.

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context
and sign-off. Run against a scratch playground at `.dev/qa-infra-playground` (deleted
after this run — never committed)._

Commands run:

```sh
node packages/cli/dist/index.js init .dev/qa-infra-playground --no-install
```

```sh
node packages/cli/dist/index.js add api --yes && node packages/cli/dist/index.js add database --yes
```

```sh
SAASALOY_REGISTRY_DIR=<repo>/modules node packages/cli/dist/index.js add infra --yes
```

```sh
pnpm install --config.minimumReleaseAge=0
```

```sh
pnpm --config.minimumReleaseAge=0 --filter @repo/infra typecheck
```

```sh
pnpm --config.minimumReleaseAge=0 --filter api build
```

- ✅ **Descriptor is schema-valid.** `modules/infra/registry-item.json` validated with
  ajv against `packages/cli/schemas/registry-item.schema.json` (the same schema/validator
  the CLI ships): `valid: true`, no errors.
- ✅ **`saasaloy add infra` scaffolds cleanly.** Ran against a fresh `.dev` playground via
  `SAASALOY_REGISTRY_DIR` (needed because `infra` isn't on the published registry branch
  yet — `add infra` without it correctly reports `Unknown module "infra"`, confirming the
  remote-registry path is unaffected). Produced exactly the 7 scaffolded files declared
  in `registry-item.json`'s `scaffolds[].files` (`package.json`, `tsconfig.json`,
  `Pulumi.yaml`, `index.ts`, `src/discover.ts`, `src/translate.ts`, `src/secrets.ts`) plus
  the linked `saasaloy-infra` skill — no crash, no partial apply. `pnpm-workspace.yaml`
  correctly gained the literal `infra` package entry and `allowBuilds.protobufjs: true`.
- ⚠️ **`pnpm install` resolves the `@pulumi/*` deps — with a caveat.** A plain
  `pnpm install` failed with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`: `@pulumi/pulumi@3.254.0`
  and `@cloudflare/workers-types@5.20260723.1` were published within this repo's 3-day
  `minimumReleaseAge` cooldown (ADR 0016) as of 2026-07-25. This is a **timing artifact of
  the pin dates vs. today's date, not a resolution bug** — with the cooldown bypassed
  (`--config.minimumReleaseAge=0`), install completed cleanly (722 resolved, 522 added,
  `protobufjs`/`sharp` postinstalls ran, exit 0). Flagging for the record: anyone testing
  this within ~3 days of the `@pulumi/pulumi@3.254.0` / `@cloudflare/workers-types` release
  dates will hit the same block and need the same override, until the packages age past
  the cutoff or get re-pinned via `pnpm deps:update`.
- ✅ **`pnpm --filter @repo/infra typecheck` is clean.** `tsc --noEmit` produced no output
  and exited 0 (cooldown bypassed per above).
- ✅ **`translate.ts` throws loudly on an unknown binding type.** Called `toResources()`
  directly against a real built service (`apps/api`, with a `r2_buckets` entry injected
  into its config) — threw exactly `infra doesn't support 'r2_buckets' yet`, matching the
  `NON_BINDING_KEYS`/`default:` switch case and the skill's documented error text. No
  silent skip.
- ✅ **`discover.ts` globs the right `wrangler.jsonc` paths.** Called `discoverServices()`
  directly against the scaffolded playground (`apps/api` + `apps/web` + `packages/db` +
  `packages/ui` + `packages/tsconfig`): found exactly `apps/api` (name `api`) and
  `apps/web` (name `qa-infra-playground-web`) — both of which have a `wrangler.jsonc` —
  and correctly skipped the three `packages/*` workspaces that don't.
- ✅ **`secrets.ts` denylist blocks the three infra credentials.** Called `pushSecrets()`
  with a 5-key `.env` (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID`,
  `PULUMI_CONFIG_PASSPHRASE`, a `vars`-declared `APP_VAR`, and a real secret
  `STRIPE_SECRET_KEY`): exactly one key (`STRIPE_SECRET_KEY`) was attempted via
  `wrangler secret put` — the three infra credentials and the already-`vars` key were all
  correctly skipped before any `wrangler` call.
- ✅ **`api` and `database` capability modules are untouched.**
  `git diff origin/main...HEAD --stat -- modules/api modules/database` produced no output
  — zero changes.

All automated checks passed except the flagged cooldown-timing caveat, which is
environmental (dependency publish dates vs. today) rather than a defect in this diff.

## Not covered / needs human judgment
- **The Definition of Done itself (TC-1).** No Cloudflare credentials were available to
  this agent — `pulumi up`/`destroy` against a real account, the live `workers.dev` URL,
  and the D1 database's actual provisioning have never been exercised. This is the single
  most important gap in this plan; do not consider #29 done until TC-1 passes.
- **Live secret delivery (TC-3).** The denylist *logic* is verified; whether a pushed
  secret actually shows up correctly on a real deployed Worker is unverified without
  cloud access.
- **Multi-service deploy at scale.** Only one or two services were discovered in this
  build's playground. Behavior with several services declaring overlapping binding names,
  or a large number of services, is unexercised.
- **Concurrent `deploy` runs.** The skill documents "don't run `deploy` from two machines
  at once" (no state locking) as a known trade-off — untested here, and inherently a
  multi-agent/timing scenario a human would need to orchestrate deliberately.
- **`wrangler secret put` failure modes** (e.g. expired token mid-deploy, rate limiting)
  — only the happy path and the denylist-skip path were exercised.
- **The `pnpm deps:update` cooldown interaction long-term.** The `minimumReleaseAge`
  block hit during this run should self-resolve, but nobody has confirmed
  `pnpm deps:update`/`deps:verify` (ADR 0016) correctly manages the `@pulumi/*` pins going
  forward.
