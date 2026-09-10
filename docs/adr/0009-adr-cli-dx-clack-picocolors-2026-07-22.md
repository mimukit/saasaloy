# 0009 — CLI DX stack: `@clack/prompts` + `picocolors`

The CLI's interactive UI is built on `@clack/prompts` (intro/outro, spinner, `select`/`multiselect`, `note`, `isCancel`) + `picocolors`, while argument parsing stays on native Node `util.parseArgs`. This reverses the earlier deliberate "zero-dependency, hand-rolled dispatcher" stance now that Phase 1's interactive flows (`--dry-run`/`--diff`, `dependsOn` confirmation) justify the dependency, and it adopts the Astro/Vercel CLI aesthetic. Settled in session `c9f4e2d4` (2026-07-22), filed as issue #18 / PR #20.

## Status
accepted

## Considered Options
- Keep the CLI zero-dependency with a hand-rolled dispatcher — reversed: acceptable for Phase 0 scaffolding, but interactive prompts and spinners are not worth hand-rolling once real flows arrive.
- The older shadcn stack (`prompts` + `ora` + `kleur` + `execa` + `zod`) — rejected as heavier and dated versus the clack pairing.
- `commander` — deferred (only if auto-`--help` is later wanted); `citty` (pre-1.0), `consola`/`ink` (more than a scaffolder needs), `oclif`/`listr2` (heavy framework) — all rejected.

## Consequences
- Arg parsing stays native (`parseArgs`), so the dependency footprint is just the two UI libs.
