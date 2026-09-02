# Plan — CLI quality-of-life: `env`, `outdated`, `new module`, and descriptor compatibility

Grilled: 2026-09-02

> Tracked in [#50](https://github.com/mimukit/saasaloy/issues/50) (single issue — all phases folded).
> Was blocked by [#48](https://github.com/mimukit/saasaloy/issues/48) for the `outdated` phase; #48 merged 2026-08-30 and `compareInstalled` (`packages/cli/src/lib/updater.ts:118`) exists, so nothing blocks this plan.
> Re-grounded 2026-09-02: `add` now generates `apps/api/.dev.vars.example` via `lib/dev-vars.ts` (#98), the base `_gitignore` already covers `.dev.vars` and `.env`, descriptors reject unknown fields (`additionalProperties: false`), and `modules/` holds 19 modules, not three.

## Context

Four small gaps in the command layer. Individually each is a papercut; together they are most of the distance between "the applier works" and "the CLI is pleasant".

- **Declared environment variables stop at an example file.** `registry-item.json` has an `envVars` map and `add` renders `apps/api/.dev.vars.example` from it (`lib/dev-vars.ts`), but nothing fills the real files: the user still copies, hunts descriptions, and guesses which app each var belongs to. Public build-time vars (`PUBLIC_API_URL` in `admin` and `waitlist`) target the Astro app, which reads `.env`, not `.dev.vars` — today they land nowhere.
- **There is no way to ask "has anything moved?"** `saasaloy-lock.json` records the exact resolved SHA per module, and `compareInstalled` in `lib/updater.ts` already answers the question per module — but no command surfaces it. Without one, `update` is a command you'd have to run speculatively.
- **Authoring a module is Claude-Code-only.** The `create-module` skill is good and encodes real design judgment, but it is the *only* path. Every contributor not using Claude Code is locked out of the ecosystem the third-party registry work (#39) is meant to open up.
- **An old CLI fails a new descriptor with a raw schema error.** Descriptors set `additionalProperties: false`, so an unknown field is rejected loudly, not silently ignored — but the error is an Ajv dump, not "upgrade your CLI". And a *changed meaning* of an existing field would still half-apply silently. `requires` turns both into one clear, fatal message.

**Success:** declared env vars land in the real files the right app reads; `saasaloy outdated` answers the update question in one line; a contributor with any editor can scaffold a valid module; and a descriptor needing a newer CLI fails with the upgrade command instead of a schema dump.

## Design decisions (settled)

The rows dated 2026-09-02 were settled at that grill.

| Decision | Resolution |
|----------|-----------|
| **Scope** | Four mechanical additions in the command layer. Module **stacks** are a separate plan — they need a genuine design decision about what a stack *is*, which these don't. |
| **`env` writes `.dev.vars`** | Cloudflare's convention for local Worker variables, so it's the file `wrangler dev` already reads. The command prompts for each declared-but-unset variable using the descriptor's own description as the prompt text. |
| **Never write a secret to a committed file** | `env` verifies the target file is gitignored before writing, and refuses if it isn't. For production it *prints* the `wrangler secret put` invocations rather than running them — deploying a secret is not something a scaffolding tool should do on the user's behalf. |
| **`outdated` is a thin caller, not a reimplementation** | It renders `compareInstalled` (`lib/updater.ts:118`, landed with #48) per lock entry. Pure presentation. |
| **`new module` scaffolds, `create-module` guides** | The CLI writes the deterministic part — folder skeleton, a schema-valid `registry-item.json`, a `saasaloy-`-prefixed skill stub (ADR 0014). The skill keeps the judgment: which capability conventions to extend, whether it's a capability or a feature, what the vertical slice is. The skill calls the CLI rather than hand-writing files, so there's one scaffolder, not two. |
| **`requires` is kept, on the corrected rationale** (2026-09-02) | Unknown fields already fail loudly via `additionalProperties: false`; `requires` exists for the friendly "upgrade your CLI" message and for semantic changes to existing fields, which no schema catches. Still cheapest now, before third-party descriptors exist without it. |
| **A `requires` mismatch is fatal, not a warning** | It fails before any write, naming the module, the required range, the installed version, and the upgrade command. |
| **Transitive `requires` mismatches are equally fatal** (2026-09-02) | A dependency-of-a-dependency that wants a newer CLI aborts the whole plan pre-write — a skipped dependency would ship a knowingly incomplete install, the defect #49 exists to stop. The message names the offending module in the chain. |
| **`requires` is any semver range** (2026-09-02) | Upper bounds come free from range syntax (`>=0.3 <2`); no separate max field and no validation forbidding one. Documented in the schema description. |
| **`env` target inference from file targets** (2026-09-02) | A variable's target app is inferred from where its declaring module writes files (the alias, as `lib/dev-vars.ts` already does for `@api`). No app-scoping field in `envVars`. `env` prompts only when inference finds no target. |
| **Public vs secret splits on the `PUBLIC_` prefix** (2026-09-02) | No `secret: true` field. `PUBLIC_*` vars are public build-time values and go to the target app's `.env` (what the Astro build reads); everything else is a secret and goes to the target Worker's `.dev.vars`. `devVars` keeps supplying non-secret dev defaults. |
| **`env` fills blanks only** (2026-09-02) | A variable already set in the target file is never rewritten; the user edits the file to change a value. `--check` reports it as set. |
| **`env` extends `lib/dev-vars.ts`, replaces nothing** (2026-09-02) | `add` keeps generating `.dev.vars.example`; `env` fills the real files and reuses the same alias/target resolution, extended to per-module inference. |
| **`new module` ships in the CLI** (2026-09-02) | One binary, discoverable by the third-party authors #39 targets. It guards its context: it refuses to run inside a generated project (presence of `saasaloy.json`). |
| **`outdated` exits 0 by default; `--check` gates** (2026-09-02) | Interactive runs stay quiet in a slightly stale project; CI passes `--check` for a non-zero exit on any drift. Mirrors `env --check`. The issue's "exits non-zero when anything moved" criterion is amended to the flag-gated form. |
| **Presentation reuses what exists** | `@clack/prompts` + `picocolors` throughout, per ADR 0009. |

## Approach

Ordered cheapest-first. No phase is blocked.

### Phase 1 — Descriptor compatibility (`requires`)

The cheapest change and the one that gets more expensive to add every day.

- Add an optional `requires.saasaloy` semver-range field to `registry-item.schema.json` and to the `RegistryItem` type in `lib/schema.ts`. Any valid range is accepted, upper bounds included.
- Check it in the applier **before planning any write**, for every module in the plan including transitive dependencies, comparing against the CLI's own version (`readVersion()` in `cli.ts`). Note this only becomes meaningful once the CLI ships a real version — see `plan-ship-the-cli-2026-08-01.md`, which moves it off `0.0.0`.
- Fail with a message naming the module (and its place in the dependency chain when transitive), the required range, the installed version, and the upgrade command.
- Teach `create-module` and the new `saasaloy new module` to emit it.
- Extend `saasaloy doctor` (`lib/doctor.ts`) to validate it.

### Phase 2 — `saasaloy env`

- `saasaloy env` reads every installed module's declared `envVars` from its descriptor and infers each variable's target app from the declaring module's file-target aliases, reusing and extending `lib/dev-vars.ts`. It prompts for a target only when inference finds none.
- Route by kind: `PUBLIC_*` variables go to the target app's `.env`; all others go to the target Worker's `.dev.vars`.
- Prompt for each unset variable, using the descriptor's description as the prompt hint; `devVars` values prefill dev defaults. Existing values are never rewritten.
- Confirm the target file is gitignored before writing; refuse and explain if not. (The base `_gitignore` already covers `.env`, `.env.*`, `.dev.vars`, and `.dev.vars.*` — verify, don't re-add.)
- `saasaloy env --check` reports missing variables without prompting, so it can gate a deploy, and exits non-zero when any are missing.
- Print (never run) the corresponding `wrangler secret put` lines for production secrets.
- Have `add` point at `saasaloy env` in its summary instead of only listing the variables; the `.dev.vars.example` generation stays.

### Phase 3 — `saasaloy new module`

- `saasaloy new module <name>` scaffolds `modules/<name>/` with a schema-valid `registry-item.json`, a `files/` directory, and `skills/saasaloy-<name>/SKILL.md`. It refuses to run inside a generated project (`saasaloy.json` present).
- Prompt for the two-tier type (`saasaloy:capability` vs `saasaloy:feature`) and `dependsOn`, since those drive everything else about the module's shape.
- Emit pinned `dependencies[]` per ADR 0017 and the deps workflow, and a `requires` range from Phase 1.
- Run `saasaloy doctor` on the result so a freshly scaffolded module is provably valid.
- Update the `create-module` skill to invoke this rather than hand-writing the skeleton, keeping its guidance about conventions and vertical slices.

### Phase 4 — `saasaloy outdated`

- Call `compareInstalled` (`lib/updater.ts:118`) for every module in `saasaloy-lock.json`.
- Table output: module, current SHA (short), latest SHA, ref, and whether it moved — rendering the existing `outdated | pinned | local | unresolvable` statuses.
- Skip `local` entries with a note — they have no remote to compare against.
- Handle unreachable sources (deleted repo, network down) as a reported row, not a crash.
- Exit 0 by default; `--check` exits non-zero when anything is outdated, for CI and pre-deploy gates.

## Non-goals

- **Module stacks / recipes** — `plan-module-stacks-2026-08-01.md`.
- **The update flow and AI merge** — landed with #48; this plan only renders its comparison.
- **`saasaloy doctor`** — landed with #47. This plan extends it, doesn't build it.
- **Running `wrangler secret put` or any deploy action.** The CLI prints; the user runs.
- **Reading env values from a secret manager.** `env` writes `.dev.vars` and `.env` only.
