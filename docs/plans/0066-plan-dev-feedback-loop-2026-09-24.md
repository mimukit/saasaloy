# Plan: a faster dev and test feedback loop for modules and UI

## Context

Testing a module change today means building the CLI, running `pnpm play:init` into `.dev/playground`, running `saasaloy add` for each module through the shim (`scripts/saasaloy-shim.sh`), installing, migrating, signing up a user, and then clicking through the landing page, the customer panel and the admin panel. Any edit under `modules/*/files/` needs another `add` or a reset before it shows up. The loop takes minutes per change, and it grows with every module in the registry (39 today).

What exists already:

- `pnpm play:init`, `play:reset` and `play:destroy` scaffold and remove the playground.
- `pnpm play:watch` (`scripts/watch-template.ts`) re-runs `init --force` when `packages/cli/templates/base` changes. It does not watch `modules/`.
- `pnpm deps:verify` runs a full install, build, lint and typecheck on the playground.
- `packages/cli/test/e2e` and `packages/cli/test/matrix` test the CLI's apply logic against fixture registries.
- `pnpm test:modules` runs unit tests that live beside module files.
- `scripts/qa-tenant-scoping.sh` is one runnable HTTP QA script with PASS and FAIL lines. Most QA in `docs/qa/` (50+ files) is still manual.

Success means an edit to a module file shows in a running, populated app within a few seconds, a full reset to a clean app with every module installed takes one command, and the common QA checks run as scripts.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Hand-maintained example app or generated one | Generated. A hand-maintained copy duplicates every module file and drifts from `modules/`. It also stops testing the CLI, which is half of what the repo ships. |
| Does the example app fix the edit loop | No. It is a showcase and a review aid. The edit loop comes from live file sync into the playground (Phase 1). |
| Where fast iteration happens | In `.dev/playground`, as today. The repo convention says CLI runs go in `.dev`. |
| Which providers and drivers the full preset uses | The local ones: `-console` and `-memory` providers, so the stack needs no vendor account and no network. |
| Build order | Sync and reset first, then one-command bring-up and seed data, then the committed example, then smoke scripts and the gallery. |

## Approach

Keep the playground as the place to iterate, and make it cheap to create, reset and update. Add a generated, committed `examples/full` as the showcase and as a golden output that CI checks. Reuse `scripts/watch-template.ts`, the shim, the CLI's own `init` and `add`, `.saasaloy/manifest.json` and the `qa-tenant-scoping.sh` pattern rather than building parallel machinery.

Rejected alternatives, one line each:

- Hand-written `examples/` app: drifts, and it does not exercise the CLI.
- Storybook for module UI: a heavy dependency set for a need a dev-only route covers.
- Browser end-to-end tests as the main check: the dev box has no browser, and HTTP smoke scripts cover the API side at lower cost.

### Phase 0: measure the current loop (#178)

- Time one full cycle on the playground: `play:init`, `add` for every module, `pnpm install`, migrations, first sign-in.
- Record the time per step in this plan. The numbers confirm or change the phase order below.

### Phase 1: live module file sync and pull-back (#178)

- Extend `scripts/watch-template.ts` (or add `scripts/watch-modules.ts`) to watch `modules/*/files/**` as well as the base template.
- On a change, resolve the source file to its target path in the playground and copy that one file. The resolution uses the module descriptor's `files[]` and `scaffolds[].files[]` plus the playground's alias map in `saasaloy.json`.
- Update the file's hash in `.saasaloy/manifest.json` so `saasaloy doctor` and `outdated` do not report drift after a sync.
- Skip modules that are not installed in the playground, and skip conditional entries whose condition does not match.
- Add `pnpm play:pull`. It lists playground files whose content differs from the manifest hash and copies them back to their module source, with a confirmation step.
- Verify: edit a component under `modules/admin/files/src/`, see HMR update the running admin app without a re-add.

### Phase 2: git baseline reset (#178)

- After `play:init` and install, run `git init` in the playground and commit a baseline.
- Add `pnpm play:snap` to commit the current state as the new baseline and `pnpm play:restore` to run `git reset --hard && git clean -fd` against it, which keeps `node_modules` in place.
- Use `git diff` in the playground to review exactly what an `add` wrote.
- Verify: `play:restore` after a full `add` returns to a clean app in seconds with no install.

### Phase 3: one-command bring-up with presets (#178)

- Add `pnpm play:up --preset <name> [--db d1|postgres]`.
- The script builds the CLI, runs `init`, runs `add` for the preset's module list, installs, runs migrations, seeds (Phase 4), snapshots (Phase 2) and starts dev.
- Start with three presets: `minimal` (base only), `saas` (api, auth, database, admin, billing, teams) and `full` (every module, local providers).
- Keep preset definitions in one data file so `examples/full` (Phase 5) and CI read the same list.
- Verify: `pnpm play:up --preset full --db d1` ends with the web, api and admin apps running.

### Phase 4: seed data and a dev sign-in (#178)

- Add a seed step that creates an admin user, a customer user, two organizations, a subscription on the console billing provider, and waitlist rows.
- Decide where each module's seed lives (see Open questions).
- Add a dev-only sign-in path that skips the sign-up form, guarded so it cannot ship in a production build.
- Verify: the admin panel and the customer panel show content on first load.

### Phase 5: generated `examples/full` with a CI check (#178)

- Add `pnpm example:build`. It runs the `full` preset into `examples/full` without starting dev.
- Commit the output.
- Add a CI job that runs `example:build` and fails when the result differs from the committed copy.
- Exclude `examples/` from the root pnpm workspace globs, `pnpm lint`, `prettier --check .` and Stylelint, and give it its own ignore rules where needed.
- Verify: a PR that changes a module file shows the matching change under `examples/full`.

### Phase 6: module smoke scripts (#178)

- Let a module ship an optional smoke script that prints one PASS or FAIL line per check against a live API, in the style of `scripts/qa-tenant-scoping.sh`.
- Add `pnpm play:smoke`. It runs the smoke script of every installed module and prints a total.
- Convert the manual checks from the most recent `docs/qa/` files first.
- Verify: `play:smoke` on the `full` preset passes on a clean seed.

### Phase 7: UI gallery route (#178)

- Add a dev-only `/_dev` route to `apps/web` and `apps/admin` that renders each module's components with fixture data.
- Exclude the route from production builds.
- Verify: every installed module's UI blocks render on the gallery page with no backend call.

### Phase 8: scoped checks (#178)

- Add scripts that run typecheck and tests only for the workspaces a change touches, through `turbo --filter`.
- Verify: a change in one module's files runs checks for its workspaces only.

## Open questions

- Which step of the current loop costs the most time? Phase 0 answers it, and the answer may reorder the phases.
- Does live sync resolve targets from the descriptor at sync time, or from a source path recorded in the manifest? The manifest records target and hash today, not the source path.
- What does live sync do with a patch (`chained-route`, `plugin-array`, `nav-entry`) as opposed to a copied file? Re-run `add` for that module, or print a warning and skip?
- What happens when a synced file has local edits in the playground? Overwrite, refuse, or back up first?
- Should `play:pull` exist at all, or does it encourage editing in the wrong place?
- Where does seed data live? One seed file per module under `modules/<name>/files/`, a single repo-level dev seed, or a new descriptor field?
- How is the dev sign-in route guarded so a generated project never ships it? Env flag, build-time exclusion, or a playground-only file outside the module?
- Should `examples/full` include `node_modules`-free lockfiles (`pnpm-lock.yaml`), and how large is the committed diff per module change?
- One example (`full`) or one per preset? Postgres and D1 variants of `full` cannot both install, since the drivers conflict.
- Does the CI golden check run on every PR or only when `modules/` or `packages/cli/templates/` change?
- Do smoke scripts stay shell plus `curl` and `jq`, or move to a Node runner that can share helpers?
- Does the gallery route ship to generated projects as a feature, or stay in the playground only?
- Is Phase 8 worth its own work, or does turbo's cache already give most of the gain?

## Non-goals

- Browser-driven end-to-end tests. The dev box has no browser.
- Changes to how `saasaloy add` applies modules for end users. The sync is a dev tool for this repo only.
- A hosted demo deployment of `examples/full`.
- Replacing the CLI's existing e2e and matrix tests.
