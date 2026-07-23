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
| **Module dep pinning** | Module descriptors carry **pinned** versions using the existing `name@version` string form (`"dependencies": ["zod@4.0.5"]`). The applier already parses this — `parseDep` in `packages/cli/src/lib/pkg-json.ts:14` splits `name@version` and only bare names fall back to `"latest"`. So this is a **convention + optional schema tightening**, not an applier or descriptor-shape change. Decided now while `modules/` is empty, so no descriptors need retrofitting. |
| **Version format** | **Exact pins everywhere.** The workflow rewrites template deps from `^`-ranges to exact numbers, and enforces exact `name@version` in descriptors. Consistent with the repo's `saveExact`; makes scaffolds reproducible; gives the update command a crisp, testable target (the maintainer blesses a specific version, not a floating range). |
| **Cooldown source** | The script reads `minimumReleaseAge` from `pnpm-workspace.yaml` (currently 4320 min / 3 days) and refuses to bump to a version published more recently — the same quarantine the repo already applies to its own installs. |
| **Scope boundary** | The workflow covers only the "invisible" files (template package.jsons + module descriptors). The tool repo's own workspace deps (root, `packages/cli`) stay on `pnpm outdated`/`pnpm update` — not re-implemented here. |
| **Verify** | Reuses existing `play:*` scripts rather than new infra: after a bump, re-scaffold `.dev/playground` and build/typecheck the *generated* project. Included as an optional local gate (honoring the "local, not a CI/bot gate" choice) because a bad bump breaks consumers' apps, not this repo's build. |

## Approach

### Phase 1 — Pin-versions convention for descriptors
Establish that module descriptors declare exact npm versions, without changing the descriptor shape or applier (both already support `name@version`).

- Update the descriptor example `packages/cli/schemas/examples/registry-item.example.json` to use `"zod@<exact>"` instead of bare `"zod"`.
- Tighten `packages/cli/schemas/registry-item.schema.json` `dependencies[]` — narrow the item `description`/`pattern` to require a pinned `name@version` (reject bare names), so `ajv` validation catches an un-pinned dep at author time. Update the matching JSDoc on `RegistryItem.dependencies` in `packages/cli/src/lib/schema.ts:114`.
- Update the `create-module` skill so scaffolded descriptors emit pinned deps and tell the author to run `pnpm deps:update` to fill/refresh versions.
- Sync the descriptor-shape doc: build-spec §3.3 (`docs/plans/plan-saasaloy-build-spec-2026-07-21.md`) and `modules/README.md` where they show `["zod"]`.
- Confirm (test) the applier path: `parseDep` + `planDeps` already write pinned versions into a consumer `package.json` — add/extend a `pkg-json` test asserting an exact `name@version` descriptor dep lands verbatim, and that a bare name is now a validation error.

### Phase 2 — `deps:check` (read-only drift report)
The core scanner + npm resolver, no writes.

- New `scripts/update-deps.mjs` (zero-dep, Node 24, `node:fs`/`fetch`, matching `watch-template.mjs` style).
- **Discover manifests:** glob `packages/cli/templates/base/**/package.json` (read `dependencies` + `devDependencies`) and `modules/*/registry-item.json` (read `dependencies[]`, parse via the same `name@version` rule as `parseDep`).
- **Skip** non-registry specs: `workspace:*`, `{{PROJECT_NAME}}`, internal `@repo/*`, and anything already `catalog:`/`link:`.
- **Resolve latest eligible version** per package from `https://registry.npmjs.org/<name>` — the highest stable (non-prerelease) semver whose `time[version]` is older than `minimumReleaseAge` (read from `pnpm-workspace.yaml`).
- **Report** a grouped table (file → dep → current → latest-eligible → status), where status distinguishes `up-to-date`, `outdated`, `range→exact` (a floating range that needs migrating), `bare→pinned` (an un-pinned descriptor dep), and `within-cooldown (skipped)`.
- Exit non-zero when any actionable drift exists, so the maintainer (or a future manual pre-push hook) can gate on it.
- Wire `"deps:check": "node scripts/update-deps.mjs --check"` into root `package.json` scripts.

### Phase 3 — `deps:update` (write + migrate to exact)
The mutating pass, reusing Phase 2's discovery/resolution.

- Rewrite each template `package.json` dep/devDep to the resolved **exact** version, preserving key order and JSON formatting (trailing newline, 2-space, like `writeDeps`).
- Rewrite each descriptor `dependencies[]` entry to exact `name@version`.
- **First-run migration is implicit:** `^5` → `5.14.1` and bare `zod` → `zod@4.0.5` are just the "resolve to exact" path — no separate migration mode.
- Leave `engines`, `packageManager`, and `workspace:*` refs untouched.
- Support `--dry-run` (print the diff without writing) for parity with the applier's own `--dry-run`/`--diff` ethos.
- Wire `"deps:update": "node scripts/update-deps.mjs"` into root `package.json` scripts.

### Phase 4 — Verify gate (optional, local)
Prove a bump doesn't break a generated project before it reaches consumers.

- Add `"deps:verify"` that chains the existing flow: `play:init` (build CLI → `init .dev/playground --force` → `pnpm install`) then build + typecheck the *generated* project (`pnpm -C .dev/playground build` / `... typecheck`).
- Document it as the recommended post-`deps:update` step. Keep it optional (the maintainer chose a local workflow, not a mandatory CI gate).

### Phase 5 — Document the workflow
- Add a short "Updating dependencies" section to `CONTRIBUTING.md` / `AGENTS.md` describing `deps:check` → `deps:update` → `deps:verify` and the exact-pin + cooldown rules.
- Note the scope boundary (workspace deps use `pnpm outdated`; these commands own template + descriptors).

## Open questions

- **Shared-dep lockstep.** `turbo` and `typescript` appear in *both* the template and the tool repo's own manifests (repo uses `typescript 7.0.2`; template says `^5`). Should the workflow keep shared deps in lockstep with the repo's pinned version, or resolve the template independently from npm? (They can legitimately diverge — e.g. the generated project may want a different TS major than the CLI's build toolchain.)
- **Major-version bumps.** Should `deps:update` auto-cross a major (`astro 5 → 6`), or flag majors for manual review (majors most often break the template)? A `--allow-major` gate vs. default-conservative.
- **Cooldown exclusion parity.** `pnpm-workspace.yaml` documents a `minimumReleaseAgeExclude` escape hatch. Should `deps:check`/`update` honor the same exclusion globs, or is the cooldown non-negotiable for shipped template deps?
- **Scaffolded workspace manifests.** Capability modules will eventually ship *new* workspace `package.json` files inside `modules/<name>/files/**` (via descriptor `scaffolds`). Those are a third class of invisible manifest — in scope for this scanner later, or a follow-up?
- **`@types/*` / peer deps.** How are type-only and peer deps in descriptors resolved and pinned (they still need the cooldown + exact treatment, but shouldn't be duplicated across dep/devDep buckets in the consumer).
- **Prerelease / `dist-tag` handling.** Confirm the resolver always tracks `latest` dist-tag stable and never a `next`/`beta`, even when a package's newest published version is a prerelease.

## Non-goals

- **No dependency bot.** No Renovate, Dependabot, or scheduled CI PR automation — explicitly a local, maintainer-run command.
- **Not managing the tool repo's own deps.** Root and `packages/cli` workspace deps stay on `pnpm outdated`/`pnpm update`; this workflow does not re-implement that.
- **No applier or descriptor-shape change.** The `name@version` form and `parseDep`/`planDeps` merge logic already exist; this plan uses them, it doesn't rewrite them.
- **No auto-commit / auto-merge.** `deps:update` edits the working tree and stops; the maintainer reviews and commits (per repo convention).
- **Not a consumer-facing `saasaloy update` command.** This is the *maintainer's* tool for keeping the registry fresh; the consumer's copy-in update path (`--diff`, ADR 0006) is separate and unchanged.
