# QA Plan: Maintainer dependency-update workflow (issue #31)

_Generated 2026-07-24 · covers the uncommitted work on branch `issue-31-deps-check-deps-update-maintainer-workflow`: the pinned-`dependencies[]` convention + new `devDependencies[]` descriptor bucket (schema, `RegistryItem`, applier, `pkg-json`, `add` TUI), the new `scripts/update-deps.mjs` scanner, the `deps:check` / `deps:update` / `deps:verify` scripts, and the docs (`CONTRIBUTING.md`, `AGENTS.md`, create-module skill, build-spec, `modules/README`)._

## Summary
- A maintainer runs one command to see every outdated dep across the pnpm-invisible files (base template + module descriptors), and a second to bump them to **exact** versions honoring the repo's 3-day cooldown, with an optional verify step that re-scaffolds and builds a generated project.
- "Working" means: `deps:check` reports drift honestly and fails only on actionable drift; `deps:update` writes exact pins the maintainer can bless; descriptors now carry a `devDependencies[]` bucket that lands in the consumer's `devDependencies`.

This feature is **mostly machine-verifiable** — schema enforcement, dep-bucket routing, the scanner's exit codes, the writer's diff, and the full `deps:verify` chain were all run by the agent and are recorded under [Automated verification](#automated-verification-by-ai-agent). What genuinely needs a human is **judgment**: is the drift report readable, are the resolved version bumps ones the maintainer wants to bless, and does the interactive `add` TUI surface `devDeps` correctly. Those are the manual cases below.

## Preconditions
- Node ≥ 24, pnpm 11, this repo checked out on branch `issue-31-deps-check-deps-update-maintainer-workflow` with the uncommitted changes present.
- **Network access** — the scanner queries `https://registry.npmjs.org`. On an air-gapped machine, skip TC-1..TC-4 (they need the registry) and say so.
- Working tree clean of unrelated edits, so a `deps:update` diff is easy to read and revert:

```sh
git status --short
```

- For TC-5 (the `add` TUI), build the CLI and scaffold a playground:

```sh
pnpm cli:dev            # terminal 1: rebuild CLI on change — leave running
pnpm play:init          # scaffold .dev/playground + the ./saasaloy shim
```

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | `deps:check` report is readable and every status is justified | 🔴 Critical |
| TC-2 | Bless a real `deps:update` diff — exact pins, nothing collateral touched | 🔴 Critical |
| TC-3 | `--allow-major` surfaces and crosses a major only on purpose | 🟡 Normal |
| TC-4 | `--allow-fresh` overrides the cooldown for a within-cooldown dep | 🟡 Normal |
| TC-5 | `saasaloy add` shows `devDeps` and lands them in `devDependencies` | 🟡 Normal |
| TC-6 | create-module guidance reads correctly for a descriptor author | 🟢 Low |

## Test cases

### TC-1 — `deps:check` report is readable and every status is justified  ·  🔴 Critical
The report is the maintainer's whole view into drift; a confusing or misleading line defeats the tool.

**Steps**
1. Run:

```sh
pnpm run deps:check
```

2. Read the grouped output file-by-file. For each row judge: does `current → latest [status]` tell you plainly what will happen?
3. Sanity-check a couple of statuses against reality — e.g. pick a `within-cooldown` dep and confirm on npm that its newest version really is < 3 days old; pick a `range→exact` dep and confirm the template really ships a `^`/`~` range.

**Expected**
- Rows are grouped under each manifest path (template package.jsons, `modules/*/registry-item.json`, `modules/*/files/**/package.json`).
- `devDependencies` entries are tagged ` (dev)`.
- `within-cooldown` / `major-available` rows point the arrow at the **held-back** version (the one being waited on), not a lower one — no line reads like a phantom downgrade.
- The `typescript` divergence `note:` line appears (template major 5 vs repo's 7) and reads as informational, not an error.
- The command exits non-zero (there is real `range→exact` drift in the template today).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — Bless a real `deps:update` diff — exact pins, nothing collateral touched  ·  🔴 Critical
This is the core maintainer act: the tool proposes exact versions and the human decides whether to ship them. A human must eyeball the diff — the agent can confirm the *shape* of the write but not that the chosen versions are acceptable to release.

**Steps**
1. Run the real update (writes to the working tree):

```sh
pnpm run deps:update
```

2. Review the resulting diff:

```sh
git --no-pager diff packages/cli/templates modules
```

3. Judge each bump: is this a version you're willing to ship to downstream projects? Cross-check anything surprising against the package's changelog.
4. When done judging, restore the files (blessing/committing them is a separate, deliberate act):

```sh
git checkout -- packages/cli/templates modules
```

**Expected**
- Every rewritten value is an **exact** version (no `^`/`~`/ranges remain in touched entries).
- `workspace:*`, `@repo/*`, `{{PROJECT_NAME}}`, and `engines`/`packageManager` are **untouched**.
- Key order and formatting (2-space, trailing newline) are preserved — the diff shows only the version strings changing.
- `within-cooldown` and `major-available` deps are **not** written (no `--allow-*` flags given).
- The console summary count matches the number of changed lines in the diff.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — `--allow-major` surfaces and crosses a major only on purpose  ·  🟡 Normal
Majors are where the template breaks; the maintainer must consciously opt in and judge the blast radius.

**Steps**
1. Preview major bumps without writing:

```sh
node scripts/update-deps.mjs --dry-run --allow-major
```

2. Compare against a plain `--dry-run` (no `--allow-major`) and confirm the difference is only that majors are now crossed.
3. Judge whether any surfaced major (e.g. `astro`, `wrangler`) is one you'd actually take — this is the human call the flag exists to force.

**Expected**
- Without `--allow-major`, a newer major shows as `major-available` and is **not** in the "would update" list.
- With `--allow-major`, the same dep's "would update" target jumps to the newer major.
- The report header shows the `[--allow-major]` tag so the run's mode is unambiguous.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — `--allow-fresh` overrides the cooldown for a within-cooldown dep  ·  🟡 Normal
The audited escape hatch for a security fix that must land inside the 3-day window.

**Steps**
1. From TC-1, note a dep reported `within-cooldown (skipped)` (e.g. a `wrangler` or `@cloudflare/*` devDep). If none exists today, mark this case N/A and say so.
2. Dry-run with the override:

```sh
node scripts/update-deps.mjs --dry-run --allow-fresh
```

**Expected**
- The previously `within-cooldown` dep now appears in the "would update" list, targeting the freshest within-major version.
- The report header shows the `[--allow-fresh]` tag.
- Without the flag, that same dep stays skipped (re-run plain `--dry-run` to confirm).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — `saasaloy add` shows `devDeps` and lands them in `devDependencies`  ·  🟡 Normal
The applier half of the feature. No shipped module declares `devDependencies[]` yet, so author a throwaway fixture to exercise the path end-to-end in the playground.

**Steps**
1. In this checkout, temporarily add a `devDependencies[]` line to a local module descriptor — e.g. edit `modules/api/registry-item.json` to include:

```sh
# add this key alongside "dependencies": []
#   "devDependencies": ["@types/node@26.1.1"]
```

2. From the playground, add the module through the shim:

```sh
cd .dev/playground
./saasaloy add api
```

3. Read the plan summary the TUI prints, then inspect the resulting root `package.json`:

```sh
cat package.json
```

4. When done, discard the fixture edit:

```sh
git checkout -- modules/api/registry-item.json
```

**Expected**
- The plan summary shows a `devDeps:` line listing `@types/node@26.1.1` (distinct from the `deps:` line).
- After apply, `@types/node` lands in the playground root's **`devDependencies`**, pinned to `26.1.1` — not in `dependencies`.
- If you instead put the same package name in **both** buckets, it lands in `dependencies` only (no duplicate in `devDependencies`).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — create-module guidance reads correctly for a descriptor author  ·  🟢 Low
Docs UX — an author following the skill should end up with a valid pinned descriptor.

**Steps**
1. Read the `dependencies` / `devDependencies` field notes and example in:

```sh
.agents/skills/create-module/SKILL.md
```

2. Judge: is it clear that both buckets are exact-pinned, that `@types/*` go in `devDependencies[]`, and that `pnpm deps:update` fills versions?

**Expected**
- The example descriptor shows `zod@4.0.5` and a `devDependencies` entry (not a bare `zod`).
- The field note and authoring checklist both state the exact-pin rule and point at `pnpm deps:update`.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [ ] `saasaloy add` for a module with only `dependencies[]` (no dev bucket) still lands them in `dependencies` exactly as before.
- [ ] A descriptor with **no** dep buckets applies with no dep-related output and no crash.
- [ ] Existing schema validation for `scaffolds[]` / `files[]` still passes (unchanged by this work).
- [ ] `pnpm play:init` / `pnpm play:reset` still scaffold a buildable playground.

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
cd packages/cli && pnpm exec vitest run
pnpm run typecheck
pnpm run build
pnpm run deps:check            # expect non-zero exit on real drift
node scripts/update-deps.mjs --dry-run
node scripts/update-deps.mjs --dry-run --allow-major
git status --porcelain packages/cli/templates modules   # confirm dry-run writes nothing
pnpm run deps:verify
```

- ✅ `vitest run` → **8 files, 65 tests passed**, including the new `pkg-json.test.ts` (bucket routing, cross-bucket dedup, verbatim exact pin) and the `applier.test.ts` additions (schema rejects bare/range deps, accepts pinned; `buildPlan` aggregates both buckets).
- ✅ `typecheck` → 1 task successful, no errors (the parameterized `planDeps`/`writeDeps` and new `Plan.devDependencies`/`RegistryItem.devDependencies` typecheck clean).
- ✅ `build` → tsup ESM build success.
- ✅ `deps:check` → **exit 1** with 4 `range→exact` rows (`astro`, `wrangler`, `turbo`, `typescript`), plus `up-to-date` / `within-cooldown` rows and the `typescript` divergence note — non-zero exactly because a default `deps:update` would change something.
- ✅ `deps:update --dry-run` → "4 dependencies would be updated" to exact versions; **no `--allow-major`/`--allow-fresh` deps written**.
- ✅ `deps:update --dry-run --allow-major` → same 4 rows but `astro ^5 → 7.1.3`, `typescript ^5 → 7.0.2` (majors crossed), header tagged `[--allow-major]`.
- ✅ `git status --porcelain packages/cli/templates modules` after dry-runs → clean (dry-run wrote nothing); a real `deps:update` was run once, its diff verified (exact pins, key order + `workspace:*` preserved), then reverted with `git checkout`.
- ✅ `deps:verify` → **exit 0** end-to-end: `play:init` → `pnpm -C .dev/playground install` → build (Astro built 3 pages) → typecheck.

## Not covered / needs human judgment
- Whether a specific resolved version is **safe to ship** to downstream projects — the tool proposes; the maintainer blesses (TC-2/TC-3).
- The visual readability / scannability of the `deps:check` report in a real terminal (TC-1).
- The interactive `add` TUI rendering of the `devDeps:` line — the agent can assert the data but not the on-screen presentation (TC-5).
- Registry-error / offline behavior: rows surface as `unresolved (registry error)` on a failed fetch, but a real DNS/registry outage wasn't simulated.
- Very large `versions` maps (thousands of releases) resolve fine in practice (`wrangler` has ~4900) but no pathological-size perf test was run.
