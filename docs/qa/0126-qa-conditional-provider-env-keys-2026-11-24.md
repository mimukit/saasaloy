# QA Plan: Conditional provider env keys

_Generated 2026-11-24 · updated 2026-11-24 · against `609e7f02` (clean) · covers issue #390, plan 0124: the env core, the CLI key list, the email capability and five provider modules_

## Summary
- A provider's env keys are required only while `<CAP>_PROVIDER` selects that provider.
- "Working" means a local provider runs with blank vendor keys, and a selected vendor with a blank key stops at setup, deploy and the runtime gate.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-390-require-email-from-and-plunk-api-key-only-for-a` at `609e7f02`.
- You need a Plunk account with a secret `sk_...` key and a verified sender domain.
- You need a Cloudflare account that `wrangler login` can reach.
- No screenshots: the change has no UI.

Build the CLI from the worktree root:

```sh
pnpm --filter saasaloy build
```

Scaffold a throwaway project with the email modules:

```sh
SAASALOY_REGISTRY_DIR=$PWD/modules node packages/cli/dist/index.js init .dev/qa-390 --force && cd .dev/qa-390 && SAASALOY_REGISTRY_DIR=$OLDPWD/modules node $OLDPWD/packages/cli/dist/index.js add email email-console email-plunk --yes
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Project on Plunk with real credentials | A real mail arrives through Plunk | 🟡 Normal |
| TC-1.2 | 1: Project on Plunk with real credentials | The deploy check refuses a blank Plunk key | 🔴 Critical |

## Scenario 1: Project on Plunk with real credentials

**Setup.** Run once, for every case in this scenario.

1. In `.dev/qa-390/packages/env/.env`, set `EMAIL_PROVIDER=plunk`, your `PLUNK_API_KEY` and an `EMAIL_FROM` on your verified domain.
2. Write each service's `.env`:

```sh
pnpm install && pnpm env:setup
```

- [ ] Setup complete

### TC-1.1: A real mail arrives through Plunk  ·  🟡 Normal

**Goal.** The conditional keys still reach the Plunk provider when Plunk is selected.

**Steps**

1. Start the api:

   ```sh
   pnpm dev
   ```

2. Trigger a password-reset mail or any route that sends mail, to an inbox you can read.
   - [ ] The mail arrives in the inbox from the `EMAIL_FROM` address

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The deploy check refuses a blank Plunk key  ·  🔴 Critical

**Goal.** A production env that selects Plunk with a blank key stops before deploy.

**Steps**

1. In the production value source, set `EMAIL_PROVIDER=plunk` and leave `PLUNK_API_KEY` blank.
2. Run the deploy check:

   ```sh
   pnpm deploy:production
   ```

   - [ ] The command stops before any upload and names `PLUNK_API_KEY (required: EMAIL_PROVIDER=plunk)`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
cd ../.. && rm -rf .dev/qa-390
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm test --concurrency=4
```

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm docs:check
```

```sh
pnpm --filter saasaloy build && SAASALOY_REGISTRY_DIR=$PWD/modules node packages/cli/dist/index.js init .dev/qa-390 --force --no-install
```

```sh
cd .dev/qa-390 && SAASALOY_REGISTRY_DIR=$OLDPWD/modules node $OLDPWD/packages/cli/dist/index.js add email email-console email-plunk --yes
```

```sh
node packages/env/scripts/env-setup.ts
```

All results are at `609e7f02`, clean tree, unless a line names another revision. The fix commit `609e7f02` changed only `packages/env/src/define.ts` and its test. The gate ran again on it; the `.dev` runs (C6, C9, C16) are from `6232c01d` and do not touch that file's runtime path.

- ✅ `pnpm test --concurrency=4` → exit 0 at `609e7f02`. Module tests 1725/1725, base env tests 182/182, scripts tests 1058/1058, plus the CLI package tests.
- ✅ `pnpm lint`, `pnpm typecheck`, `pnpm docs:check` → exit 0 each.
- ✅ C1 · `modules/email-plunk/files/env.test.ts` "passes on console with EMAIL_FROM and PLUNK_API_KEY blank" → pass.
- ✅ C2 · same file, "names both keys on plunk with both blank" → pass.
- ✅ C3 · same file, "names EMAIL_FROM only on cloudflare with both blank" → pass.
- ✅ C4 · same file, plunk with both keys set → pass.
- ✅ C5 · base `define.test.ts`: "leaves a conditional key optional while its condition is false", "names the key, its module and the condition while it is true", "reports a conditional key beside a key that failed its own schema", "skips a condition on a server key on the client", "matches a name in a comma list, and any one of several conditions", "requires a key two presets make conditional when either condition holds", "keeps a key required when one preset requires it and another makes it conditional, in either order" (acceptance blocker B1) → pass.
- ✅ C6 · `.dev/qa-390` with `EMAIL_PROVIDER=console`, `EMAIL_FROM` and `PLUNK_API_KEY` blank: `env:setup` → exit 0, and `apps/api/.env` holds both keys blank.
- ✅ C6 · same project with `EMAIL_PROVIDER=plunk`: `env:setup` → exit 1, `api has no value for EMAIL_FROM (required: EMAIL_PROVIDER!=console), PLUNK_API_KEY (required: EMAIL_PROVIDER=plunk)`.
- ✅ C7 · base `deploy.test.ts` / `check.test.ts`: "refuses a blank conditional key while its condition holds", "prints each conditional key with the condition that holds" → pass. The live deploy check needs Cloudflare credentials: TC-1.2.
- ✅ C8 · `modules/email/files/src/define.test.ts` "falls back to the provider's defaultFrom when EMAIL_FROM is unset", "prefers EMAIL_FROM to defaultFrom, and the message's from to both"; `modules/email-console/files/console.test.ts` "logs a mail from dev@localhost when EMAIL_FROM is unset", "logs the sender consoleEmail({ from }) names instead" → pass.
- ✅ C9 · rendered `.dev/qa-390/packages/env/.env.example` → `# @required-when EMAIL_PROVIDER!=console` above `EMAIL_FROM`, `# @required-when EMAIL_PROVIDER=plunk` above `PLUNK_API_KEY`. Stability on a second render: `packages/cli/src/lib/env-example.test.ts` → pass.
- ✅ C10 · `packages/cli/src/engine/render.test.ts` kv + kv-upstash merge case → pass.
- ✅ C11 · `packages/cli/src/lib/doctor.test.ts` `envRequiredWhen` cases → pass.
- ✅ C12 · one `files/env.test.ts` per provider: "names every blank khudebarta key on khudebarta", "… bkash key on a list that names bkash", "… sslcommerz key on a list that names sslcommerz", "… upstash key on upstash", "… stripe key on stripe", and the matching "passes on <local provider>" cases → pass.
- ✅ C13 · `scripts/env-presets.test.ts`: "<module>'s requiredWhen matches its envRequiredWhen" for email, email-plunk, sms-khudebarta, payment-bkash, payment-sslcommerz, kv-upstash, subscription-stripe → pass.
- ✅ C14 · `pnpm docs:check` → exit 0. `pnpm docs:stale` → exit 0 at G3 (log `.afkkit/g3-docs-stale.log`).
- ✅ C15 · ADR `docs/adr/0070-*`, update note `packages/cli/update-notes/0011-conditional-env-keys.md`, `saasaloy-env`, `create-provider`, `create-module` and `saasaloy-email` skills carry the conditional key → files present; `pnpm --filter saasaloy test` validates the note.
- ✅ C16 · same as the C6 console run.
- The agent removed `.dev/qa-390` after the run.

## Not covered / needs human judgment
- A real Plunk send and a live deploy check need real credentials. TC-1.1 and TC-1.2 cover them.
- The runtime `apiEnv()` gate in a scaffolded project needs `pnpm install` there. The module test runs the same `createEnv` over the same presets.
- Accessibility, compatibility and performance: the change has no UI and no hot path.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
