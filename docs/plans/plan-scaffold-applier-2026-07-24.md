# Plan — scaffold applier (`add` materializes `scaffolds[]`)

*Drafted 2026-07-24.*

## Context

`saasaloy add` today applies a module's `files[]`, `agent.skills[]`, `dependencies[]`, and
`envVars`, but **defers `scaffolds[]`** — the field a *capability* uses to birth a whole new
workspace (ADR 0005 / ADR 0013). The consequence is concrete: `add api` lands only the
`saasaloy-api` skill; the `apps/api` workspace it exists to create never appears, and the module's
QA has to fake it with a throwaway `.dev/` harness. This plan closes that gap so
`saasaloy add api` materializes `apps/api` — copies the scaffold's files to their workspace-root
targets, registers the `@api → apps/api/src` alias into `saasaloy.json`, and records every file in
the manifest — exactly as the existing `files[]` path does for feature drops.

Success = `./saasaloy add api` in `.dev/playground` produces a real `apps/api/` (entry, health
route, `package.json`, `vite.config.ts`, `wrangler.jsonc`, `tsconfig.json`), writes `@api` into the
project's `saasaloy.json`, tracks all six files in `.saasaloy/manifest.json`, and the deferred-scaffolds
warning is gone. The scaffolded worker boots on `workerd` (`vite dev`) and `GET /health` is green.

The design goal is **reuse, not a parallel engine**: a scaffold file is just a `PlannedFile` whose
target is workspace-root-relative instead of alias-resolved, so it flows through the same
classify → execute → manifest machinery (`buildPlan`/`executePlan` in `packages/cli/src/lib/applier.ts`).

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where scaffolds land in the pipeline | **Fold into `plan.files`.** For each `scaffolds[].files[] {path, target}`, emit a `PlannedFile` with project-relative target `posix.join(scaffold.workspace, file.target)` (e.g. `apps/api` + `src/index.ts` → `apps/api/src/index.ts`). No new writer, classifier, or manifest path — `executePlan` already writes files and records `manifest.managed[target]`. |
| Alias registration | Carry the union of scaffold-declared aliases in a new `plan.aliases: Record<string,string>`. **`executePlan` merges them into `config.aliases`** (symmetric with how it already does `config.installed.push`). `buildPlan` stays side-effect-free; `saveConfig` at the end of `add` persists them. |
| Same-run alias resolution | **Support now** (per decision). `buildPlan` first collects all scaffold aliases across the `install` set into a merged view `{ ...config.aliases, ...scaffoldAliases }`, then resolves `files[]` targets against that merged view — so a capability + a feature that drops `@api/routes/x.ts` installed in the same run both resolve. Topo order already lands capabilities before their dependents; the pre-pass makes it order-independent. |
| Scaffold target semantics | Workspace-root-relative, **no `@alias`** (the alias root doesn't exist yet — ADR 0013). Schema enforces: no leading `/`, no `@` prefix. Distinct from `files[].target`, which stays alias-prefixed. |
| Classification / safety | Scaffold files get the same `create`/`overwrite`/`unchanged`/`drift`/`conflict` treatment. A pre-existing untracked `apps/api/package.json` classifies as `conflict` and is held back — never clobbered. `--force` re-applies the module; the alias merge is idempotent. |
| Deferred-scaffolds removal | Drop `plan.deferredScaffolds`, the `buildPlan` branch that populates it, and the scaffold half of the `summarizePlan` warning. The warning becomes **patches-only** (`patch engine — issue #7`). |
| Typed shape | Promote `RegistryItem.scaffolds` from `Record<string,unknown>[]` to `RegistryScaffold[] = { workspace: string; aliases?: Record<string,string>; files: RegistryFile[] }` in `schema.ts`. Reuse `RegistryFile` (`{path,target}`) for scaffold files. |
| Schema tightening | Tighten `registry-item.schema.json` `scaffolds.items` from bare `{ "type": "object" }` to `{ required: [workspace, files], workspace, aliases, files }` — the shape ADR 0013 committed to. `aliases` mirrors `saasaloy.schema.json` (`@`-prefixed keys → POSIX rel paths); scaffold `files[].target` forbids leading `/` and `@`. |
| Alias conflict | Merge (last-write-wins). If a scaffold alias would **redefine an existing alias to a different path**, `log.warn` it rather than fail — surfaced, not silent. |
| `remove` | **Out of scope** — no `remove` command exists yet. Manifest recording is the enabler; the command is separate work. |
| Skill hosting *(added 2026-07-24, ADR 0015)* | `agent.skills` folders install as **real files under `.agents/skills/<name>/`** (cross-agent canonical, git-tracked) with a per-folder **`.claude/skills/<name>` symlink** (junction on Windows) pointing at them for Claude Code — not copied into `.claude/skills/`. The symlink is git-ignored and regenerated per-machine; `executePlan` creates it and records `source → link` in `manifest.links`. A pre-existing non-symlink there is a held-back `conflict`. Reverses ADR 0007's copy-and-don't-symlink call. |

## Approach

### Phase 1 — Typed shape + schema
- `schema.ts`: add `RegistryScaffold`; change `RegistryItem.scaffolds` to `RegistryScaffold[]`.
- `registry-item.schema.json`: tighten `scaffolds.items` to `{ workspace, aliases, files }` with the
  patterns above. Confirm `modules/api/registry-item.json` still validates (`validateRegistryItem`).

### Phase 2 — Applier (`packages/cli/src/lib/applier.ts`)
- `Plan`: remove `deferredScaffolds`; add `aliases: Record<string,string>`.
- `buildPlan`:
  - Pre-pass over `install` modules → collect `scaffold.aliases` into `scaffoldAliases`; build the
    merged alias view; resolve `files[]` against it (replaces the direct `config.aliases` read).
  - For each module's `scaffolds[]`, emit a `PlannedFile` per scaffold file via a small helper
    (reuse `planModuleFile`, passing the joined workspace-root target; `isSkill: false`).
  - Return `aliases: scaffoldAliases`; drop the `deferredScaffolds.push` branch.
- `executePlan`: after writing files, merge `plan.aliases` into `config.aliases` (warn on a
  conflicting redefinition).

### Phase 3 — Command surface (`packages/cli/src/commands/add.ts`)
- `summarizePlan`: warning becomes patches-only; fix the wording/issue ref (scaffolds no longer
  deferred). Optionally surface registered aliases and a "new workspace → run `pnpm install`" hint
  when `plan.aliases` is non-empty.

### Phase 4 — Tests + QA
- Unit: `applier.test.ts` — a scaffold descriptor produces `PlannedFile`s at
  `apps/api/<target>`, `plan.aliases` carries `@api`, and `executePlan` writes the alias into config
  + records the files in the manifest. Cover the same-run capability+feature alias-resolution case
  and the `conflict` hold-back.
- Manual QA (`.dev/playground`, per CONTRIBUTING): `./saasaloy add api` creates `apps/api`, writes
  `@api` to `saasaloy.json`, tracks files in the manifest; then `pnpm install` + `vite dev` boots on
  `workerd` and `GET /health` is green. Update `docs/qa/qa-api-capability-module-2026-07-23.md` to
  drop the "scaffolds aren't applied by add yet" throwaway-harness precondition.

## Open questions

- **Root `package.json`/workspace globs.** The scaffolded `apps/api` is only discovered by pnpm/Turbo
  if the base's `pnpm-workspace.yaml` uses `apps/*` globs (the plan-api assumption). If a base instead
  pins explicit members, scaffolding a workspace also needs a patch to the members list — that's the
  patch engine (issue #7), out of scope here, but worth confirming the base uses globs during QA.
- **Alias-conflict policy.** Warn-and-overwrite is the draft. Is a hard error ever wanted (e.g. two
  capabilities claiming `@api`)? Left for grillkit.
- **`pnpm install` after a scaffold.** Should `add` offer to run it (like `init` does) when a new
  workspace lands, or just hint? Draft: hint only.

## Non-goals

- **The patch engine** (`patches`, issue #7) — still deferred; only the scaffolds half of the warning changes.
- **A `remove` command** — no such command yet; manifest recording is the only forward-looking piece.
- **Feature-tier dep-target inference** — which workspace's `package.json` gets a feature's
  `dependencies[]` (ADR 0013 open item); belongs to the feature-module plans.
- **Base template changes** — this consumes whatever `pnpm-workspace.yaml` the base ships.
