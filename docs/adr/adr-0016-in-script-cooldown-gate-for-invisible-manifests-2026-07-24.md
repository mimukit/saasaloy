# 0016 — Maintainer dep-updates: an in-script cooldown gate and within-major default for pnpm-invisible manifests

The base-template package.jsons (`packages/cli/templates/base/**/package.json`) and module descriptors (`modules/*/registry-item.json`) ship **exact-pinned** versions but are not pnpm workspace members, so the repo's own supply-chain protections never reach them. Exact pins also **bypass pnpm's install-time `minimumReleaseAge` filter entirely** — there's no range to resolve, so nothing gets quarantined — and a too-fresh pin can even make a *consumer's* `pnpm install` fail under their own cooldown. Therefore the maintainer script `scripts/update-deps.mjs` (exposed as `pnpm deps:check` / `deps:update`) is the **only** place a cooldown can gate these files, and it enforces it at version-**selection** time: per package, enumerate the npm `versions` map, **drop prereleases, ignore `dist-tags`**, cap at the **highest eligible version within the current major**, and require the publish `time[version]` to clear `minimumReleaseAge` (read as the single number from `pnpm-workspace.yaml`). Each manifest resolves **independently** (no lockstep with the repo's own pins). Majors are never crossed without `--allow-major`; the cooldown is overridden only with an explicit `--allow-fresh`. Settled while grilling the dep-update workflow plan.

## Status
accepted — establishes the version-selection policy for the `deps:check`/`deps:update`/`deps:verify` workflow. Applies the repo's `saveExact` + `minimumReleaseAge` philosophy (`pnpm-workspace.yaml`) to the files pnpm can't see.

## Considered Options
- **Ship floating ranges and lean on pnpm's consumer-side cooldown** — rejected: contradicts `saveExact` and scaffold reproducibility, and a range resolves at the *consumer's* install where the maintainer no longer controls (or has verified) the chosen version. Exact pins are what make the in-script gate necessary *and* sufficient.
- **Honor pnpm's `minimumReleaseAgeExclude` globs** — rejected: that escape hatch mostly serves pnpm's *transitive install* behavior and would add name/version glob-matching for a rarely-populated list. A manual maintainer tool deserves a manual override, so `--allow-fresh` (global for the run) replaces it.
- **Auto-cross majors (highest eligible overall)** — rejected: majors are where the template most often breaks (`astro 5→6`, `wrangler 4→5`); each is blessed deliberately via `--allow-major`, surfaced as a `major-available` status until then.
- **Lockstep shared deps with the repo's own pins** — rejected: the repo runs `typescript 7.0.2` (native compiler) while the template stays on the `5.x` line — a legitimate divergence between the CLI's build toolchain and the generated project. Resolve independently; only print an informational note when a shared dep's major diverges from the repo's pin.
- **Trust the `latest` dist-tag** — rejected: a package whose maintainer moved `latest` to a prerelease (or hasn't updated it) would mislead the resolver; scanning the stable `versions` set is robust regardless.

## Consequences
- **`deps:check` exit code is meaningful, not flaky:** non-zero only on what a default `deps:update` would change (`outdated` within major, `range→exact`, `bare→pinned`); exit zero (but still reported) on `major-available` (needs `--allow-major`) and `within-cooldown` (transient). A pre-push gate goes red exactly when plain `deps:update` would produce a diff.
- **The cooldown gate and the exact-pin decision are coupled:** exact pins are precisely what removes pnpm's protection and moves responsibility to the maintainer's selection step. Neither can be dropped without re-opening the other.
- **Scope is three invisible manifest classes** — base template, `modules/*/registry-item.json`, and scaffolded `modules/*/files/**/package.json`. The tool repo's own workspace deps stay on `pnpm outdated` / `pnpm update`.
- **`--allow-fresh` is the audited path for security fixes** that must land inside the cooldown window; it's an explicit, per-run maintainer act rather than a config-file entry.

## References
Plan: `docs/plans/plan-dep-update-workflow-2026-07-24.md`. Settings: `pnpm-workspace.yaml` (`saveExact`, `minimumReleaseAge`). Resolver reuses the `name@version` rule of `parseDep` (`packages/cli/src/lib/pkg-json.ts`). Issue: #31.
