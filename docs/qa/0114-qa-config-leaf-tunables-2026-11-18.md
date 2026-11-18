# QA Plan: config leaf tunables (#162)

_Generated 2026-11-18 · against `bc47054e` (clean) · covers plan 0111: three env keys and two leaf tunables moved into config sections_

_Refreshed 2026-11-18 at `8d5cf278`: that commit changes two Markdown sentences in the subscription update note and skill. No code changed, so every result below still holds._

_Rebased 2026-11-18 onto `origin/main` at `6474c25a`, new head `c26bbbb1`: `pnpm lint`, `pnpm typecheck` and `pnpm test` exit 0 again. The playground results were taken before the rebase, at `bc47054e`._

## Summary
- Three env keys and two literals become `config` section leaves, and `doctor` reports a retired key that a `.env` still sets.
- Working means each reader uses its leaf, nothing reads a retired key, and a scaffold with every touched module builds and boots.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-162-move-the-four-misplaced-env-keys-and-the-seven` at `bc47054e`.
- Target: `.dev/playground`, the declared disposable target. `pnpm play:destroy` removes it.
- Screenshots: none. The change has no visible UI difference (plan Q15), so no browser driver ran.

Launch with:

```sh
pnpm play:init
```

```sh
.dev/playground/saasaloy add subscription feature-flags storage file-uploads cms api-keys api-keys-organization admin subscription-console storage-memory kv-memory queue-memory email-console --with database-d1 --yes
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Playground with every touched module | The api key form caps the expiry at 365 days | 🟡 Normal |
| TC-1.2 | 1: Playground with every touched module | The upload picker refuses a file over the cap | 🟡 Normal |
| TC-2.1 | 2: The repo at the branch head | The leaf comments and update notes read clearly | 🟡 Normal |

## Scenario 1: Playground with every touched module

**Setup.** Run once, for every case in this scenario.

1. Write `packages/env/.env` in the playground with the `full` preset values from `scripts/play-presets.json`.
2. Copy the values into each service `.env`.

```sh
cd .dev/playground && pnpm env:setup && pnpm db:setup && pnpm db:seed
```

```sh
cd .dev/playground && pnpm dev
```

- [ ] Setup complete

### TC-1.1: The api key form caps the expiry at 365 days  ·  🟡 Normal

**Goal.** The create form and the server use the same ceiling, `config["api-keys"].maxExpiryDays`.

**Steps**

1. Sign in to the admin at `http://localhost:3001` as the seeded admin. Open the API keys screen and start a new key.
   - [ ] The expiry hint says "One to 365 days", and the field does not take 366
2. Create a key with an expiry of 365 days.
   - [ ] The key is created, and its row shows an expiry date about one year from today

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The upload picker refuses a file over the cap  ·  🟡 Normal

**Goal.** The file-uploads picker takes its default cap from `config.storage.maxUploadBytes`.

**Steps**

1. Stop `pnpm dev`. In `.dev/playground/packages/config/src/project.ts`, add `storage: { maxUploadBytes: 1_048_576 },` to `project`. Start `pnpm dev` again.
2. Open the files screen in the admin. Drop a file larger than 1 MiB.
   - [ ] The picker refuses the file and names a 1 MiB limit
3. Drop a file smaller than 1 MiB.
   - [ ] The upload completes and the file shows in the list

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
pnpm play:destroy
```

## Scenario 2: The repo at the branch head

**Setup.** Check out the branch at `bc47054e`. No command is necessary.

- [ ] Setup complete

### TC-2.1: The leaf comments and update notes read clearly  ·  🟡 Normal

**Goal.** A project owner can act on each leaf comment and each update note with no other document.

**Steps**

1. Read the five section files: `modules/{subscription,feature-flags,storage,api-keys,admin}/files/config/*.ts`.
   - [ ] Each leaf comment says what the value does and what a change costs, in words an owner can act on
2. Read the three update notes: `modules/subscription/update-notes/0001-lockout-days-in-config.md`, `modules/feature-flags/update-notes/0002-isolate-ttl-in-config.md` and `modules/storage/update-notes/0001-max-upload-bytes-in-config.md`.
   - [ ] Each note tells an owner how to keep a custom value and how to remove the old key
     - the feature-flags note also tells the owner to remove `featureFlagsEnv()` from `apps/api/src/env.ts`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
pnpm play:init
```

```sh
.dev/playground/saasaloy add subscription feature-flags storage file-uploads cms api-keys api-keys-organization admin subscription-console storage-memory kv-memory queue-memory email-console --with database-d1 --yes
```

```sh
cd .dev/playground && pnpm install && pnpm typecheck && pnpm lint && pnpm test
```

```sh
cd .dev/playground && pnpm env:setup && ./saasaloy doctor --json
```

```sh
curl -s http://localhost:4000/health
```

```sh
curl -s -o /dev/null -w '%{http_code}' 'http://localhost:4000/admin/users?limit=101'
```

- ✅ C7 · `pnpm lint` exit 0 and `pnpm typecheck` exit 0 at `465125e7`; `pnpm test` exit 0 at `bc47054e` (CLI 78 files, modules 1634, base 159, scripts 889 pass). The first `pnpm test` run failed in `src/lib/api-keys-module.test.ts`, which pinned the old descriptor; `bc47054e` fixed it.
- ✅ C1 · `grep` for the three keys in every `registry-item.json` and `env-preset.ts` → 0 hits. In the playground, the only hits are skill text and section comments that say the key was retired.
- ✅ C1 · the playground `packages/config/src/sections.ts` registers `adminConfig`, `subscriptionConfigSection`, `featureFlagsConfig`, `storageConfig` and `apiKeysConfig`; `add` refused no key.
- ✅ C2 · with `BILLING_APP_NAME`, `SUBSCRIPTION_LOCKOUT_DAYS`, `FLAGS_ISOLATE_TTL_SECONDS` and `STORAGE_MAX_UPLOAD_BYTES` set in `packages/env/.env`, `doctor --json` returns exactly four findings, `/env/<KEY>` under `subscription`, `subscription`, `feature-flags` and `storage`. Each names its leaf and `packages/config/src/project.ts`. `env:setup` reports the values file only.
- ✅ C3 · three new update notes: `subscription/0001`, `feature-flags/0002`, `storage/0001`.
- ✅ C4 · `api-key-options.ts:76` sets `maxExpiresIn: config["api-keys"].maxExpiryDays`; `api-key-workspace.tsx:82` reads the same leaf; `admin-users.ts:42-43` uses `config.admin.userListLimit` for `max` and `default`. `api-key-options.test.ts` pins the server value.
- ✅ C5 · each of the five section files carries a "What a change costs" paragraph.
- ✅ C6 · no `*_PROVIDER` key is added or removed in `git diff main...HEAD`; the matching lines are table rows that also list a retired key.
- ✅ C8 · playground `pnpm install`, `pnpm typecheck` (20 tasks), `pnpm lint` and `pnpm test` (189 tests) exit 0. A `project.ts` override of all five new leaves typechecks; `userListLimit: "50"` fails with TS2322.
- ✅ C8 · `pnpm dev` in `apps/api` and `apps/admin`: `/health` → `{"status":"ok"}`, admin `/` → 200, `/admin/users?limit=101` → 401 (the gate answers before the validator). Both servers stopped, ports 3001 and 4000 free.
- ✅ C9 · `SUBSCRIPTION_PAST_DUE_LOCKOUT_CRON = "0 3 * * *"` stays a literal with a comment that says why; `modules/ratelimit` and `modules/kv` are unchanged.

### Browser checks
_No browser driver ran. The plan states no visible UI change (Q15), and the two UI cases need a signed-in admin with seeded data, so they stay manual._

## Not covered / needs human judgment
- The page checks for the api key form and the upload picker (TC-1.1, TC-1.2). They need a seeded, signed-in admin.
- `saasaloy update` on a project scaffolded before #162. No old-version project fixture exists in the repo; the update notes describe the steps.
- The lockout sweep on a real cron tick. `past-due-lockout.test.ts` covers the leaf; a deployed tick needs Cloudflare.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
