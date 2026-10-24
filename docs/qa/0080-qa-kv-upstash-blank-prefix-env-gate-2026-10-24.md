# QA Plan: kv-upstash blank KV_KEY_PREFIX env gate

_Generated 2026-10-24 · against `376fa3f1` (clean) · covers issue #249: the kv preset split, the kv-upstash `KV_KEY_PREFIX` declaration, the applier's blank-on-purpose rule, and the kv docs_

## Summary
- With kv-upstash installed, a blank `KV_KEY_PREFIX` now fails `pnpm env:setup` and the api's `createEnv`, not the first KV call.
- Working means kv-upstash refuses a blank prefix at both gates, and kv-memory and kv-cloudflare still accept it.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-249-fail-a-blank-kv-key-prefix-at-env-time` at `376fa3f1`.
- Target: `.dev/playground`, the disposable project from CONTRIBUTING.md. `pnpm play:restore` resets it.
- No dev server, no credentials. The Upstash URL and token are fake values, because no check sends a request.

Build the CLI and make the playground:

```sh
pnpm --filter saasaloy build && pnpm play:init
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: fresh playground, kv-upstash added | a blank prefix fails both gates | 🔴 Critical |
| TC-2.1 | 2: fresh playground, kv-memory added | a blank prefix passes both gates | 🔴 Critical |
| TC-3.1 | 3: fresh playground, kv then kv-upstash in two runs | the second run drops the marker | 🟡 Normal |
| TC-4.1 | 4: the branch diff | the error text and the docs read clearly | 🟡 Normal |

## Scenario 1: fresh playground, kv-upstash added · run by the agent on .dev/playground at 376fa3f1

**Setup.** Run once, for every case in this scenario.

1. Reset the playground and add kv-upstash. kv is not installed yet, so the same run adds kv.

```sh
pnpm play:restore && cd .dev/playground && ./saasaloy add kv-upstash -y && pnpm install
```

2. Fill every key except `KV_KEY_PREFIX`.

```sh
./saasaloy env --set KV_PROVIDER=upstash --set LOGGER_PROVIDER=console --set LOG_LEVEL=info --set UPSTASH_REDIS_REST_URL=https://x-1.upstash.io --set UPSTASH_REDIS_REST_TOKEN=tok
```

3. Add the two base web keys by hand. `saasaloy env --set` refuses them, because no installed module declares them. `main` has the same behaviour.

```sh
printf 'PUBLIC_API_URL=http://localhost:4000\nPUBLIC_SITE_URL=http://localhost:3000\n' >> packages/env/.env
```

- [x] Setup complete

### TC-1.1: a blank prefix fails both gates  ·  🔴 Critical

**Goal.** kv-upstash refuses a blank `KV_KEY_PREFIX` before any KV call.

**Steps**

1. Read the key list.
   - [x] `packages/env/.env.example` has no `# Blank on purpose` line above `KV_KEY_PREFIX`, and it carries kv-upstash's required wording.
   - [x] `packages/kv/src/env-preset.ts` reads `extends: [kvCorePreset, upstashEnv()]`.
2. Run the setup gate with the prefix blank.

   ```sh
   pnpm env:setup
   ```

   - [x] The command exits 1 and names `KV_KEY_PREFIX` for api.
3. Run the api's `createEnv` with a blank prefix, then with `app:`. The agent used a throwaway `apps/api/afk-env-check.ts` with `npx tsx`, and deleted it after.
   - [x] A blank prefix throws `KV_KEY_PREFIX (kv-upstash): unset`. `app:` passes.
4. Set the prefix and run the setup gate again.

   ```sh
   ./saasaloy env --set KV_KEY_PREFIX=app: && pnpm env:setup
   ```

   - [x] The command exits 0.

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

```
env:setup blank -> exit 1
api has no value for KV_KEY_PREFIX. Set them at the value source, or mark them "# Blank on purpose" in packages/env/.env.example.
prefix="" -> throws: 1 environment key is missing or invalid:
  KV_KEY_PREFIX (kv-upstash): unset - Prefix put in front of every key, e.g. staging: or the project name. Required with kv-upstash: one Redis database is one flat keyspace.
prefix="app:" -> ok, KV_KEY_PREFIX="app:"
env:setup prefix -> exit 0
```

**Reset.** Run after every case above, before you move to Scenario 2.

```sh
pnpm play:restore && rm -f .dev/playground/packages/env/.env .dev/playground/apps/api/.env .dev/playground/apps/web/.env
```

## Scenario 2: fresh playground, kv-memory added · run by the agent on .dev/playground at 376fa3f1

**Setup.** Run once, for every case in this scenario.

```sh
cd .dev/playground && ./saasaloy add kv-memory -y && pnpm install && ./saasaloy env --set KV_PROVIDER=memory --set LOGGER_PROVIDER=console --set LOG_LEVEL=info
```

```sh
printf 'PUBLIC_API_URL=http://localhost:4000\nPUBLIC_SITE_URL=http://localhost:3000\n' >> packages/env/.env
```

- [x] Setup complete

### TC-2.1: a blank prefix passes both gates  ·  🔴 Critical

**Goal.** A provider that allows a blank prefix keeps the old behaviour.

**Steps**

1. Read the key list.
   - [x] `# Blank on purpose: this key may stay empty.` stays above `KV_KEY_PREFIX`.
2. Run the setup gate with the prefix blank.

   ```sh
   pnpm env:setup
   ```

   - [x] The command exits 0, and `apps/api/.env` holds `KV_KEY_PREFIX=`.
3. Run the api's `createEnv` with a blank prefix.
   - [x] It returns `KV_KEY_PREFIX=""`.

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

```
env:setup memory blank -> exit 0
apps/api/.env: KV_KEY_PREFIX= / KV_PROVIDER=memory
prefix="" -> ok, KV_KEY_PREFIX=""
```

**Reset.**

```sh
pnpm play:restore && rm -f .dev/playground/packages/env/.env .dev/playground/apps/api/.env .dev/playground/apps/web/.env
```

## Scenario 3: fresh playground, kv then kv-upstash in two runs · run by the agent on .dev/playground at 376fa3f1

**Setup.** None beyond the reset above.

- [x] Setup complete

### TC-3.1: the second run drops the marker  ·  🟡 Normal

**Goal.** A project that adds kv first and kv-upstash later ends with a required prefix.

**Steps**

1. Add kv alone.

   ```sh
   cd .dev/playground && ./saasaloy add kv -y
   ```

   - [x] `# Blank on purpose` sits above kv's "Optional prefix" description.
2. Add kv-upstash in a second run.

   ```sh
   ./saasaloy add kv-upstash -y
   ```

   - [x] The marker is gone, and kv-upstash's required wording sits above `KV_KEY_PREFIX=`.

**Result**

- [x] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** The first attempt stopped with exit 134 and `fork failed: resource temporarily unavailable`, because other sessions loaded the box. The second attempt passed. The agent reset the playground after the case.

**Reset.**

```sh
pnpm play:restore
```

## Scenario 4: the branch diff

**Setup.** Open the diff against `origin/main`.

```sh
git diff origin/main...issue-249-fail-a-blank-kv-key-prefix-at-env-time -- modules docs/wiki
```

- [ ] Setup complete

### TC-4.1: the error text and the docs read clearly  ·  🟡 Normal

**Goal.** A developer who meets the new failure knows what to set and why.

**Steps**

1. Read the `createEnv` message in TC-1.1 Notes and the `KV_KEY_PREFIX` description in `modules/kv-upstash/registry-item.json`.
   - [ ] The text tells a developer to set a prefix, and it gives an example value.
2. Read the "Set `KV_KEY_PREFIX`" step and the upgrade note in `modules/kv/skills/saasaloy-kv/SKILL.md`.
   - [ ] An owner of an older kv-upstash project knows which line to delete, and where.
3. Read the new `removeWarnings` line in `modules/kv-upstash/registry-item.json`.
   - [ ] The warning tells an owner what to do with the prefix after a switch to kv-memory or kv-cloudflare.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run at `376fa3f1`, clean tree:

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
pnpm --filter saasaloy build
```

- ✅ `pnpm lint` → exit 0, all four passes (oxlint type-aware, oxlint plain, Stylelint, Prettier).
- ✅ `pnpm typecheck` → exit 0.
- ✅ `pnpm test` → exit 0. CLI vitest 1816 passed; test:modules 931 passed; test:base 91 passed; test:tooling 147 passed; test:scripts 455 passed; 0 failed.
- ✅ `define.test.ts` · "lets a later preset in extends override an earlier one" → passes. It failed when `collect()` was changed to keep the first declaration.
- ✅ `applier.test.ts` · "drops the key when a module in the run requires it" and "keeps the key when every declaring module calls it optional" → pass. Each failed under a matching break in the new filter.
- ✅ `env-example.test.ts` · "drops the marker when a later run declares the key required" → passes. It failed when the renderer kept a marker from the old comment.
- ✅ `scripts/env-presets.test.ts` · "kv-upstash's preset names exactly its envVars" → passes with `KV_KEY_PREFIX` in both.
- ✅ `pnpm --filter saasaloy build` → exit 0. Scenarios 1 to 3 ran on this build.

## Not covered / needs human judgment
- A real Upstash deploy. No check sends a request, and the provider's own first-call check did not change.
- Existing projects that added kv-upstash before 0.8.0. Their `.env.example` keeps the marker until the owner deletes it, as the upgrade note says. `createEnv` still refuses a blank prefix for them.
- `saasaloy update` on an existing kv project. The patched `env-preset.ts` goes to the merge plan, and the plan does not test that resolution.
- UI, accessibility, compatibility, performance, concurrency: the change has no screen and no runtime path beyond env validation.
- Data and state: the change touches no database, schema, or stored records.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
