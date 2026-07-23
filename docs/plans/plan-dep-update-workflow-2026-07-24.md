# Plan — Maintainer dependency-update workflow for the base template & module descriptors

> Tracked in [#31](https://github.com/mimukit/saasaloy/issues/31) (single issue — all phases folded).

## Context

Saasaloy ships dependency versions to downstream projects from two sets of files that **pnpm's own tooling can't see**:

- **Base template** — `packages/cli/templates/base/**/package.json` (4 files). These declare deps as loose caret ranges (`astro ^5`, `wrangler ^4`, `turbo ^2`, `typescript ^5`). They are template *asset* files, not pnpm workspace members (`pnpm-workspace.yaml` only globs `packages/*`), so `pnpm outdated` / `pnpm update` never touch them.
- **Module descriptors** — `modules/<name>/registry-item.json` `dependencies[]` (npm). Today authored as bare names (`["zod"]`), which the applier resolves to `"latest"` at the consumer's install time. Also invisible to normal tooling. (`modules/` is currently empty except its README.)

The maintainer has no way to know when these drift behind the npm registry, and the versions they *do* ship are inconsistent with the tool repo's own philosophy: the repo pins **exact** versions (`saveExact: true`) and quarantines new releases for 3 days (`minimumReleaseAge: 4320`), yet the template ships floating ranges and modules ship un-pinned names.

**Success:** the maintainer runs one local command to see every outdated dependency across the template and module descriptors, and a second to bump them — to **exact** versions, honoring the same 3-day supply-chain cooldown the repo already enforces — with an optional local verify step that re-scaffolds and builds a generated project to prove the bump before it ships to consumers.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Mechanism** | Local maintainer command, no bot. A zero-dep Node script under `scripts/`, exposed as `pnpm deps:check` (read-only) and `pnpm deps:update` (writes), mirroring the existing `scripts/watch-template.mjs` + `play:*` precedent. Rejected Renovate/Dependabot: the maintainer wants this to be a repo-owned tool, and the invisible-file problem is exactly what a custom script handles cleanly. |
| **Module dep pinning** | Module descriptors carry **pinned** versions using the existing `name@version` string form (`"dependencies": ["zod@4.0.5"]`). The applier already parses this — `parseDep` in `packages/cli/src/lib/pkg-json.ts:14` splits `name@version` and only bare names fall back to `"latest"`. This is a **convention + schema tightening** for `dependencies[]`. Decided now while `modules/` is empty, so no descriptors need retrofitting. |
| **Version format** | **Exact pins everywhere.** The workflow rewrites template deps from `^`-ranges to exact numbers, and enforces exact `name@version` in descriptors. Consistent with the repo's `saveExact`; makes scaffolds reproducible; gives the update command a crisp, testable target (the maintainer blesses a specific version, not a floating range). |
| **Resolver — latest eligible** | Per package, enumerate the registry `versions` map, **drop prereleases**, and ignore `dist-tags` entirely (never trust `latest`). Pick the **highest eligible version within the current major** (see major policy). Each manifest resolves **independently** — no lockstep with the repo's own pins; the repo legitimately diverges (repo `typescript 7.0.2` vs template `^5`). Print an informational note when a shared dep's major diverges from the repo's pin. |
| **Major-version policy** | **Default-conservative.** The resolver caps at the highest eligible version *within the current major*. A newer major is reported as its own `major-available` status but `deps:update` never crosses it unless run with `--allow-major`. Majors are where the template breaks, so each is blessed deliberately. |
| **Cooldown** | The script's selection step is the **only** supply-chain gate for these files — exact pins bypass pnpm's install-time cooldown (nothing to resolve), and an un-gated too-fresh pin could even make a consumer's `pnpm install` fail under their own `minimumReleaseAge`. So the gate stays here. Read `minimumReleaseAge` (the number) from `pnpm-workspace.yaml` (currently 4320 min / 3 days) as the single source of truth and refuse versions published more recently. **No `minimumReleaseAgeExclude` parsing** — replaced by an explicit `--allow-fresh` CLI override (global for the run) for the knowing security-fix case. |
| **Descriptor `devDependencies[]`** | Add a `devDependencies[]` array to descriptors **now** (while `modules/` is empty), routed to the consumer's `devDependencies` bucket — for `@types/*` and build tooling. Same pinned-`name@version` pattern, same resolver + cooldown as `dependencies[]`. This **flips the earlier "no applier/descriptor-shape change" non-goal into a goal** (own phase). `peerDependencies[]` is **deferred** to a follow-up when a real peer use case exists — that's when its exact-vs-range semantic gets decided. |
| **Scope boundary** | The workflow covers only the "invisible" files. The scanner discovers **three** manifest classes: base template package.jsons, `modules/*/registry-item.json` descriptors, and scaffolded `modules/*/files/**/package.json` (no-op until `create-module` ships one, but wired now). The tool repo's own workspace deps (root, `packages/cli`) stay on `pnpm outdated`/`pnpm update` — not re-implemented here. |
| **Verify** | Reuses existing `play:*` scripts rather than new infra: after a bump, re-scaffold `.dev/playground`, **install** (`play:init` runs `--no-install`), then build/typecheck the *generated* project. Optional local gate (honoring the "local, not a CI/bot gate" choice) because a bad bump breaks consumers' apps, not this repo's build. |
| **`deps:check` exit code** | Non-zero **only on what a default `deps:update` would change**: `outdated` (within major), `range→exact`, `bare→pinned`. Exit **zero** (still reported) on `major-available` (needs `--allow-major`) and `within-cooldown` (transient, clears itself) — so a pre-push gate goes red exactly when plain `deps:update` would produce a diff, and never flakily. |

## Approach

### Phase 1 — Pin-versions convention for `dependencies[]`
Establish that module descriptors declare exact npm versions in `dependencies[]` (the applier already supports `name@version`).

- Update the descriptor example `packages/cli/schemas/examples/registry-item.example.json` to use `"zod@<exact>"` instead of bare `"zod"`.
- Tighten `packages/cli/schemas/registry-item.schema.json` `dependencies[]` — narrow the item `description`/`pattern` to require a pinned `name@version` (reject bare names), so `ajv` validation catches an un-pinned dep at author time. Update the matching JSDoc on `RegistryItem.dependencies` in `packages/cli/src/lib/schema.ts:114`.
- Update the `create-module` skill so scaffolded descriptors emit pinned deps and tell the author to run `pnpm deps:update` to fill/refresh versions.
- Sync the descriptor-shape doc: build-spec §3.3 (`docs/plans/plan-saasaloy-build-spec-2026-07-21.md`) and `modules/README.md` where they show `["zod"]`.
- Confirm (test) the applier path: `parseDep` + `planDeps` already write pinned versions into a consumer `package.json` — add/extend a `pkg-json` test asserting an exact `name@version` descriptor dep lands verbatim, and that a bare name is now a validation error.

### Phase 2 — Descriptor `devDependencies[]` (applier feature)
Give descriptors a second dep bucket routed to the consumer's `devDependencies` (for `@types/*` + build tooling). **This flips the plan's former "no applier/descriptor-shape change" non-goal into a goal** — done now while `modules/` is empty so nothing needs retrofitting. `peerDependencies[]` is intentionally **out of scope** here (deferred until a real peer use case forces the exact-vs-range decision).

- **Schema:** add a `devDependencies[]` array to `registry-item.schema.json` with the same pinned-`name@version` pattern as `dependencies[]`.
- **Type:** add `devDependencies?: string[]` to `RegistryItem` in `packages/cli/src/lib/schema.ts` (with JSDoc noting it lands in the consumer's `devDependencies`).
- **Applier:** `applier.ts:236` currently aggregates only `item.dependencies` into the plan (`applier.ts:76` plan shape) — add a parallel `devDependencies` array.
- **`pkg-json.ts`:** `writeDeps` hardcodes `pkg.dependencies` and `planDeps` reads only `pkg.dependencies`. Parameterize both by bucket. `planDeps` must **dedup across both buckets** — a package can't be in both `dependencies` and `devDependencies`; `dependencies` wins.
- **`add.ts:293`:** apply path + TUI summary handle both buckets.
- **Tests:** extend `pkg-json`/`applier` tests — a `devDependencies[]` entry lands in the consumer's `devDependencies`, and a name present in both descriptor buckets resolves to `dependencies` only.

### Phase 3 — `deps:check` (read-only drift report)
The core scanner + npm resolver, no writes.

- New `scripts/update-deps.mjs` (zero-dep, Node 24, `node:fs`/`fetch`, matching `watch-template.mjs` style).
- **Discover three manifest classes:** glob `packages/cli/templates/base/**/package.json` (read `dependencies` + `devDependencies`), `modules/*/registry-item.json` (read `dependencies[]` + `devDependencies[]`, parse via the same `name@version` rule as `parseDep`), and scaffolded `modules/*/files/**/package.json` (no-op until a `create-module` scaffold ships one). Structure discovery as a list of globs so the third class is already wired.
- **Skip** non-registry specs: `workspace:*`, `{{PROJECT_NAME}}`, internal `@repo/*`, and anything already `catalog:`/`link:`.
- **Resolve latest eligible version** per package from `https://registry.npmjs.org/<name>`: enumerate the `versions` map, **drop prereleases**, ignore `dist-tags`, cap **within the current major**, and require `time[version]` older than `minimumReleaseAge` (the number, read from `pnpm-workspace.yaml`; no `minimumReleaseAgeExclude`). Resolve each manifest independently; emit an informational note when a shared dep's major diverges from the repo's own pin.
- **Report** a grouped table (file → dep → current → latest-eligible → status), where status distinguishes `up-to-date`, `outdated`, `range→exact` (a floating range that needs migrating), `bare→pinned` (a hand-edited un-pinned descriptor dep the scanner offers to fix — schema now rejects bare at author time, so this is a convenience path, not load-bearing), `major-available` (a newer major exists; needs `--allow-major`), and `within-cooldown (skipped)`.
- **Exit non-zero only on what default `deps:update` would change:** `outdated`, `range→exact`, `bare→pinned`. Exit **zero** (still reported) on `major-available` and `within-cooldown`, so a pre-push gate is meaningful and non-flaky.
- Wire `"deps:check": "node scripts/update-deps.mjs --check"` into root `package.json` scripts.

### Phase 4 — `deps:update` (write + migrate to exact)
The mutating pass, reusing Phase 3's discovery/resolution.

- Rewrite each template `package.json` dep/devDep to the resolved **exact** version, preserving key order and JSON formatting (trailing newline, 2-space, like `writeDeps`).
- Rewrite each descriptor `dependencies[]` / `devDependencies[]` entry to exact `name@version`.
- **First-run migration is implicit:** `^5` → `5.14.1` and bare `zod` → `zod@4.0.5` are just the "resolve to exact" path — no separate migration mode.
- **Default-conservative on majors:** never cross a major unless run with `--allow-major`.
- **`--allow-fresh`** (global for the run) overrides the cooldown for a knowing security-fix bump.
- Leave `engines`, `packageManager`, and `workspace:*` refs untouched.
- Support `--dry-run` (print the diff without writing) for parity with the applier's own `--dry-run`/`--diff` ethos.
- Wire `"deps:update": "node scripts/update-deps.mjs"` into root `package.json` scripts.

### Phase 5 — Verify gate (optional, local)
Prove a bump doesn't break a generated project before it reaches consumers.

- Add `"deps:verify"` that chains: `play:init` (build CLI → scaffold `.dev/playground --force --no-install`) → **`pnpm -C .dev/playground install`** (needed because `play:init` is `--no-install`) → `pnpm -C .dev/playground build` → `... typecheck`. The exact pins already cleared cooldown, so the consumer-side install won't be blocked by a copied `minimumReleaseAge`.
- Document it as the recommended post-`deps:update` step. Keep it optional (the maintainer chose a local workflow, not a mandatory CI gate).

### Phase 6 — Document the workflow
- Add a short "Updating dependencies" section to `CONTRIBUTING.md` / `AGENTS.md` describing `deps:check` → `deps:update` → `deps:verify` and the exact-pin + cooldown + within-major rules (plus the `--allow-major` / `--allow-fresh` escape hatches).
- Note the scope boundary (workspace deps use `pnpm outdated`; these commands own template + descriptors).

## Resolved questions

All open questions were settled during a grill session (2026-07-24):

- **Shared-dep lockstep** → **resolve independently** from npm; print an informational note when a shared dep's major diverges from the repo's own pin. The repo legitimately runs `typescript 7.0.2` while the template stays on the `5.x` line.
- **Major-version bumps** → **default-conservative**: cap within the current major, report `major-available`, cross only with `--allow-major`.
- **Cooldown exclusion parity** → reframed. The script's selection step is the *only* gate for these files (exact pins bypass pnpm's install-time cooldown), so the gate stays. **Drop `minimumReleaseAgeExclude` parsing**; add an explicit `--allow-fresh` override instead.
- **Scaffolded workspace manifests** → **in scope now** as a third discovery glob (`modules/*/files/**/package.json`); a no-op until `create-module` ships one, but wired.
- **`@types/*` / peer deps** → add descriptor **`devDependencies[]`** now (applier feature, Phase 2), routed to the consumer's `devDependencies`, exact-pinned like everything else. **Defer `peerDependencies[]`** until a real peer forces the exact-vs-range decision.
- **Prerelease / `dist-tag` handling** → resolver enumerates the `versions` map, **drops prereleases, and ignores `dist-tags` entirely** (never trusts `latest`).

## Non-goals

- **No dependency bot.** No Renovate, Dependabot, or scheduled CI PR automation — explicitly a local, maintainer-run command.
- **Not managing the tool repo's own deps.** Root and `packages/cli` workspace deps stay on `pnpm outdated`/`pnpm update`; this workflow does not re-implement that.
- **No `peerDependencies[]` descriptor bucket (yet).** Phase 2 adds `dependencies[]` pinning + a `devDependencies[]` bucket (an intentional applier/descriptor-shape change), but `peerDependencies[]` is deferred until a concrete peer use case forces its exact-vs-range semantic.
- **No auto-commit / auto-merge.** `deps:update` edits the working tree and stops; the maintainer reviews and commits (per repo convention).
- **Not a consumer-facing `saasaloy update` command.** This is the *maintainer's* tool for keeping the registry fresh; the consumer's copy-in update path (`--diff`, ADR 0006) is separate and unchanged.
