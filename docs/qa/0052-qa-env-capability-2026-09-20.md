# QA Plan: the `env` capability

_Generated 2026-09-20 · against `28417e9` plus the uncommitted working tree · covers `packages/env` in the base template, the `envServices`/`envOptional` descriptor fields, the retirement of `.dev.vars`, and the `env-infisical` provider._

## Summary

- A scaffolded project keeps every environment key in one tracked list, distributes the values into each service's `.env` with `pnpm env:setup`, and validates them through a typed `createEnv` gate.
- Working means: the key list carries a `# @services` line per reader set, `pnpm env:setup` writes each service only the keys it reads, an unset key fails the build naming every failing key at once, and no command writes `.dev.vars`.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-153-add-an-env-capability-for-typed-validated`.
- Repository root: the worktree at `/home/dev/worktrees/saasaloy/issue-153-add-an-env-capability-for-typed-validated`.
- The scaffolded project under test is `.dev/playground`, created by `pnpm run play:reset`.
- No account, no network and no credential is needed. Every source in this plan is the built-in `local` one.
- This change touches no database. `DB_CMD` is not set, and no query appears below.

Build the CLI first. Every scenario runs the binary this command writes.

```sh
pnpm --filter saasaloy build
```

One note on `pnpm lint` inside the playground: the repository root ignores `.dev/`, so oxlint finds no file there until the playground is its own repository. Each scenario's setup runs `git init` for that reason.

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: fresh scaffold, no module | The base ships a readable key list | 🔴 Critical |
| TC-1.2 | 1: fresh scaffold, no module | An unset key fails the build naming every key | 🔴 Critical |
| TC-1.3 | 1: fresh scaffold, no module | `saasaloy env` prompts into one gitignored file | 🟡 Normal |
| TC-2.1 | 2: scaffold with api, email and a provider | `add` groups the key list by reader set | 🔴 Critical |
| TC-2.2 | 2: scaffold with api, email and a provider | `env:setup` writes each service only its own keys | 🔴 Critical |
| TC-2.3 | 2: scaffold with api, email and a provider | An optional key stays blank and the run still passes | 🟡 Normal |
| TC-2.4 | 2: scaffold with api, email and a provider | `doctor` names a leftover `.dev.vars` | 🟡 Normal |
| TC-2.5 | 2: scaffold with api, email and a provider | `env:setup` carries a `.dev.vars` across and deletes it | 🔴 Critical |
| TC-2.6 | 2: scaffold with api, email and a provider | A checkout-owned key survives a second run | 🟡 Normal |
| TC-3.1 | 3: scaffold with env-infisical installed | The provider registers and fails closed with no CLI | 🟢 Low |

## Scenario 1: fresh scaffold, no module

**Setup.** Run once, for every case in this scenario.

1. Recreate the playground from the template.

```sh
pnpm run play:reset && git -C .dev/playground init -q && pnpm -C .dev/playground install
```

2. Install a wrangler the Cloudflare vite plugin accepts. The template pins an older one, which is unrelated to this change and blocks the build.

```sh
pnpm -C .dev/playground/apps/web add -D wrangler@4.135.0
```

- [ ] Setup complete

### TC-1.1: The base ships a readable key list · 🔴 Critical

**Goal.** A person who has never seen this project can tell, from the key list alone, which service reads each key and what the key is for.

**Steps**

1. Open `.dev/playground/packages/env/.env.example`.
   - [ ] The header explains the file, the `# @services` rule and the gitignore split
   - [ ] Each key sits under a `# @services` line and carries a comment saying what it is for
     - `# @services web` names the only service the base ships
     - `PUBLIC_SITE_URL` and `PUBLIC_API_URL` both appear, each with a local default
2. List the environment files the scaffold wrote.

   ```sh
   find .dev/playground -name '.dev.vars*' -not -path '*/node_modules/*'
   ```

   - [ ] The command prints nothing

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: An unset key fails the build naming every key · 🔴 Critical

**Goal.** A build with two unset keys names both in one message, with each key's own description, so it takes one round trip to fix.

**Steps**

1. Confirm no service `.env` exists yet.

   ```sh
   ls .dev/playground/apps/web/.env
   ```

   - [ ] The command reports the file does not exist
2. Build the web app.

   ```sh
   pnpm -C .dev/playground build
   ```

   - [ ] The build fails, and the message names both `PUBLIC_SITE_URL` and `PUBLIC_API_URL`
     - each key carries `unset` and the description the key list also shows
     - the count at the front of the message reads `2 environment keys`
   - [ ] The message is plain ASCII, with no encoding warning printed over it

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: `saasaloy env` prompts into one gitignored file · 🟡 Normal

**Goal.** Every declared value goes to one file, and the command never asks which workspace reads a key.

**Steps**

1. Run the command in the playground.

   ```sh
   cd .dev/playground && SAASALOY_REGISTRY_DIR=../../modules node ../../packages/cli/dist/index.js env
   ```

   - [ ] The command never asks which workspace reads a variable
   - [ ] Each prompt names `packages/env/.env` as the target
2. Answer every prompt, then read the file it wrote.

   ```sh
   cat .dev/playground/packages/env/.env
   ```

   - [ ] The file holds one line per answer
3. Confirm git ignores it.

   ```sh
   git -C .dev/playground check-ignore -v packages/env/.env
   ```

   - [ ] Git reports the `.env` rule matches

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
pnpm run play:destroy
```

## Scenario 2: scaffold with api, email and a provider

**Setup.** Run once, for every case in this scenario.

1. Recreate the playground and install three modules.

```sh
pnpm run play:reset && git -C .dev/playground init -q
```

```sh
cd .dev/playground && for m in api email email-console; do SAASALOY_REGISTRY_DIR=../../modules node ../../packages/cli/dist/index.js add $m --yes; done
```

2. Install the dependencies the modules added.

```sh
pnpm -C .dev/playground install
```

3. Write the local values the `local` source reads.

```sh
printf 'PUBLIC_SITE_URL=http://localhost:3000\nPUBLIC_API_URL=http://localhost:4000\nEMAIL_FROM=dev@localhost\nEMAIL_PROVIDER=console\nLOGGER_PROVIDER=console\n' > .dev/playground/packages/env/.env
```

- [ ] Setup complete

### TC-2.1: `add` groups the key list by reader set · 🔴 Critical

**Goal.** A key the descriptors declare reaches the key list under the services its descriptor names, and the base's own keys keep their explanations.

**Steps**

1. Open `.dev/playground/packages/env/.env.example`.
   - [ ] Two section lines appear, `# @services api` and `# @services web`
   - [ ] The api section holds the keys the installed modules declare
     - `CORS_ORIGINS` from `api`
     - `EMAIL_FROM` and `EMAIL_PROVIDER` from `email`
     - `LOGGER_PROVIDER` and `LOG_LEVEL` from `logger`
   - [ ] The web section still holds `PUBLIC_SITE_URL` and `PUBLIC_API_URL`, with the base's own wording
2. Open `.dev/playground/apps/api/src/env.ts`.
   - [ ] The `extends` array holds `loggerEnv()` and `emailEnv()`, each with an import above
3. Open `.dev/playground/packages/env/src/services.ts`.
   - [ ] `SERVICES` holds a `web` row and an `api` row

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: `env:setup` writes each service only its own keys · 🔴 Critical

**Goal.** One value file feeds two services, and neither service's `.env` carries the other's keys.

**Steps**

1. Distribute the values.

   ```sh
   pnpm -C .dev/playground env:setup
   ```

   - [ ] The command reports it created `apps/web/.env` and `apps/api/.env`
   - [ ] The command prints no warning about extra keys
2. Read the api's file.

   ```sh
   grep -v '^#' .dev/playground/apps/api/.env | grep .
   ```

   - [ ] The api's keys are present and no `PUBLIC_` key appears
3. Read the web app's file.

   ```sh
   grep -v '^#' .dev/playground/apps/web/.env | grep .
   ```

   - [ ] Only `PUBLIC_SITE_URL` and `PUBLIC_API_URL` appear, and no secret does
4. Build the project now that both files exist.

   ```sh
   pnpm -C .dev/playground/apps/web add -D wrangler@4.135.0 && pnpm -C .dev/playground build
   ```

   - [ ] The build succeeds
5. Read the canonical link the layout wrote.

   ```sh
   grep -o '<link rel="canonical"[^>]*>' .dev/playground/apps/web/dist/client/index.html
   ```

   - [ ] The link carries the `PUBLIC_SITE_URL` value, not a hard-coded origin

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: An optional key stays blank and the run still passes · 🟡 Normal

**Goal.** A key the declaring module calls optional carries a blank-on-purpose marker, so `env:setup` writes it empty instead of refusing.

**Steps**

1. Read the marked keys in the key list.

   ```sh
   grep -B1 'CORS_ORIGINS=\|LOG_LEVEL=' .dev/playground/packages/env/.env.example
   ```

   - [ ] Both keys carry a `# Blank on purpose` line above them
2. Confirm the written file left them empty.

   ```sh
   grep 'CORS_ORIGINS=\|LOG_LEVEL=' .dev/playground/apps/api/.env
   ```

   - [ ] Both lines are present with no value, and the setup run in TC-2.2 did not fail

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.4: `doctor` names a leftover `.dev.vars` · 🟡 Normal

**Goal.** The one failure this capability cannot see from the outside — a `.dev.vars` hiding `.env` from wrangler — is reported by name.

**Steps**

1. Confirm a clean project reports nothing.

   ```sh
   cd .dev/playground && node ../../packages/cli/dist/index.js doctor .
   ```

   - [ ] The command reports no problems
2. Plant a leftover file and run it again.

   ```sh
   touch .dev/playground/apps/api/.dev.vars && cd .dev/playground && node ../../packages/cli/dist/index.js doctor .
   ```

   - [ ] The finding names `apps/api/.dev.vars`
   - [ ] The finding explains that wrangler loads `.env` only while no `.dev.vars` sits beside it
   - [ ] The finding names `pnpm env:setup` as the fix

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.5: `env:setup` carries a `.dev.vars` across and deletes it · 🔴 Critical

**Goal.** A project scaffolded before this change migrates with one command, and no hand-typed value is lost.

**Steps**

1. Put a hand-typed value in the leftover file from TC-2.4, and remove the api's `.env` so the migration is the only source.

   ```sh
   printf 'EMAIL_FROM=typed-by-hand@example.com\n' > .dev/playground/apps/api/.dev.vars && rm .dev/playground/apps/api/.env
   ```

2. Run the distribution command.

   ```sh
   pnpm -C .dev/playground env:setup
   ```

   - [ ] The command says it carried the values across and deleted the file
3. Read the result.

   ```sh
   grep 'EMAIL_FROM' .dev/playground/apps/api/.env
   ```

   - [ ] The hand-typed value survived, and it beat the value source's own
4. Confirm the old file is gone.

   ```sh
   ls .dev/playground/apps/api/.dev.vars
   ```

   - [ ] The command reports the file does not exist

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.6: A checkout-owned key survives a second run · 🟡 Normal

**Goal.** A value this checkout set for itself is not overwritten by the value source.

**Steps**

1. Add a checkout-owned key to the key list and to the api's file.

   ```sh
   printf '\n# @services api\n\n# The branch database.\nDATABASE_URL=\n' >> .dev/playground/packages/env/.env.example
   ```

   ```sh
   printf 'DATABASE_URL=postgres://branch\n' >> .dev/playground/apps/api/.env
   ```

2. Put a different value in the source, then distribute again.

   ```sh
   printf 'DATABASE_URL=postgres://shared\n' >> .dev/playground/packages/env/.env && pnpm -C .dev/playground env:setup
   ```

3. Read the result.

   ```sh
   grep 'DATABASE_URL' .dev/playground/apps/api/.env
   ```

   - [ ] The value is `postgres://branch`, the one this checkout set

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 3.

```sh
pnpm run play:destroy
```

## Scenario 3: scaffold with env-infisical installed

**Setup.** Run once, for every case in this scenario.

1. Recreate the playground and install the provider.

```sh
pnpm run play:reset && git -C .dev/playground init -q
```

```sh
cd .dev/playground && SAASALOY_REGISTRY_DIR=../../modules node ../../packages/cli/dist/index.js add env-infisical --yes
```

- [ ] Setup complete

### TC-3.1: The provider registers and fails closed with no CLI · 🟢 Low

**Goal.** Adding the provider registers a second value source, and selecting it with no `infisical` CLI on `PATH` refuses rather than writing a wrong file.

**Steps**

1. Open `.dev/playground/packages/env/src/sources.ts`.
   - [ ] The `sources` array holds `infisical()`, with an import above it
2. Confirm the runtime file landed.

   ```sh
   ls .dev/playground/packages/env/src/providers/infisical.ts
   ```

   - [ ] The file exists
3. Select the source with no CLI installed and no project file.

   ```sh
   cd .dev/playground && ENV_SOURCE=infisical pnpm env:setup
   ```

   - [ ] The command fails and writes no `.env`
   - [ ] The message names what is missing, either `.infisical.json` or the CLI itself
   - [ ] No value and no credential appears anywhere in the output

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.**

```sh
pnpm run play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run, in the tool repository:

```sh
pnpm run lint
```

```sh
pnpm run typecheck
```

```sh
pnpm test
```

```sh
node --test scripts/env-presets.test.ts
```

Commands run against a scaffolded project, after `pnpm run play:reset`, `git init`, `saasaloy add api email email-console database database-d1` and `pnpm install`:

```sh
pnpm -C .dev/playground typecheck
```

```sh
pnpm -C .dev/playground test
```

```sh
cd .dev/playground && node ../../packages/cli/dist/index.js doctor .
```

```sh
pnpm -C .dev/playground build
```

Results:

- ✅ `pnpm run lint` → four passes green: oxlint type-aware over `packages/cli/src scripts`, oxlint over the whole tree, Stylelint, `prettier --check .`.
- ✅ `pnpm run typecheck` → `tsc` clean over the scripts project and the CLI package.
- ✅ `pnpm test` → 1281 CLI tests, 556 module payload tests, 70 base-template tests, 271 maintainer-script tests. No failures.
- ✅ `node --test scripts/env-presets.test.ts` → 111 assertions. Every module's `envVars`, its env preset, its `envServices` and its `envOptional` agree.
- ✅ `pnpm -C .dev/playground typecheck` → six workspaces clean, including `@repo/env` and the patched `apps/api/src/env.ts`.
- ✅ `pnpm -C .dev/playground test` → `packages/env`'s own 70 tests pass under `node --test` inside the scaffolded project, with no resolve hook.
- ✅ `saasaloy doctor .` → no problems on a clean project; one finding naming `apps/api/.dev.vars` once a leftover file is planted.
- ✅ `pnpm -C .dev/playground build` → the Astro build fails naming both unset keys before `pnpm env:setup` runs, and succeeds after it, writing the canonical link from `PUBLIC_SITE_URL`.

One known failure, unrelated to this change:

- ❌ `pnpm -C .dev/playground lint` → three `no-unsafe-type-assertion` errors in `packages/ui/src/lib/theme.ts`, and a wrangler peer-range mismatch (`wrangler@4.129.0` against `@cloudflare/vite-plugin`'s `^4.135.0`) that blocks `pnpm build` until wrangler is bumped. Both reproduce on the base commit with this branch's changes reverted; both belong to template dependency drift and `pnpm deps:update`.

## Not covered / needs human judgment

- **A real Infisical account.** TC-3.1 exercises the failure path only. The success path needs a project, a machine identity and a network, and the plan deliberately opens no connection.
- **`apps/admin` and `infra`.** Both ship an `env.ts` and a service row, and neither is installed in this plan's scenarios. The `admin` SPA's Proxy behaviour and `infra`'s `env-exec` path are untested by hand here.
- **The client-side Proxy throw.** `packages/env`'s own tests prove that client code reading a server key throws. Reproducing it in a browser needs a server key deliberately inlined into a bundle, which the type system and the strict map both refuse to write.
- **Concurrency and timing.** `pnpm env:setup` is a single-process file write with no lock. Two simultaneous runs are out of scope.
- **Accessibility and compatibility.** This change ships no UI. The one rendered change is a `<link rel="canonical">` tag, which has no visual or keyboard surface.
- **Performance.** `createEnv` memoizes per `env` object in a `WeakMap`, and the unit tests prove one validation per object. No load measurement is planned.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
