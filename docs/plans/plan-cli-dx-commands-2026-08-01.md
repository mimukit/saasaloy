# Plan — CLI quality-of-life: `env`, `outdated`, `new module`, and descriptor compatibility

> Tracked in [#50](https://github.com/mimukit/saasaloy/issues/50) (single issue — all phases folded).
> The `outdated` phase is blocked by [#48](https://github.com/mimukit/saasaloy/issues/48).

## Context

Four small gaps in the command layer, none currently filed. Individually each is a papercut;
together they are most of the distance between "the applier works" and "the CLI is pleasant".

- **Declared environment variables go nowhere.** `registry-item.json` has an `envVars` map, the
  applier aggregates it into the plan, and `add.ts:126` **prints it and stops.** A module that needs
  `PUBLIC_API_URL` (as `waitlist` does) tells the user about it once, in terminal output they will
  scroll past, and leaves them to find the right file themselves. The base template ships no
  `.dev.vars` at all.
- **There is no way to ask "has anything moved?"** `saasaloy-lock.json` records the exact resolved
  SHA per module, so answering it is nearly free — but nothing does. Without it, `update` is a
  command you'd have to run speculatively.
- **Authoring a module is Claude-Code-only.** The `create-module` skill is good and encodes real
  design judgment, but it is the *only* path. Every contributor not using Claude Code is locked out
  of the ecosystem the third-party registry work (#39) is meant to open up.
- **Nothing stops an old CLI from half-applying a new descriptor.** Descriptors have gained
  `devDependencies[]` (ADR 0017) and a flat `patches` array (ADR 0019) already, and will gain more.
  A CLI that predates a field silently ignores it and produces a subtly wrong install — the worst
  possible failure mode, because it looks like success.

**Success:** declared env vars land in a real file; `saasaloy outdated` answers the update question
in one line; a contributor with any editor can scaffold a valid module; and a descriptor using a
field your CLI doesn't understand fails loudly instead of quietly.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Scope** | Four mechanical additions in the command layer. Module **stacks** are a separate plan — they need a genuine design decision about what a stack *is*, which these don't. |
| **`env` writes `.dev.vars`** | Cloudflare's convention for local Worker variables, so it's the file `wrangler dev` already reads. The command prompts for each declared-but-unset variable using the descriptor's own description as the prompt text. |
| **Never write a secret to a committed file** | `env` verifies `.dev.vars` is gitignored before writing, and refuses if it isn't. For production it *prints* the `wrangler secret put` invocations rather than running them — deploying a secret is not something a scaffolding tool should do on the user's behalf. |
| **`outdated` is a thin caller, not a reimplementation** | Comparing each lock entry's `resolved` SHA against a freshly re-resolved ref is exactly what `update` must do first. That comparison is built in `plan-update-and-ai-merge-2026-08-01.md` Phase 1; `outdated` is its read-only front end. **This orders the two plans** — update's detection lands first. |
| **`new module` scaffolds, `create-module` guides** | The CLI writes the deterministic part — folder skeleton, a schema-valid `registry-item.json`, a `saasaloy-`-prefixed skill stub (ADR 0014). The skill keeps the judgment: which capability conventions to extend, whether it's a capability or a feature, what the vertical slice is. The skill can call the CLI rather than hand-writing files, so there's one scaffolder, not two. |
| **`requires` is added now, while `modules/` holds three modules** | Same reasoning ADR 0017 used for the `devDependencies` bucket — decide the descriptor shape while almost nothing needs retrofitting. Every month this waits, more third-party descriptors exist without it. |
| **A `requires` mismatch is fatal, not a warning** | The whole point is to prevent a silent half-apply. It fails before any write, naming the required range and the installed version, and telling the user to upgrade. |
| **Presentation reuses what exists** | `@clack/prompts` + `picocolors` throughout, per ADR 0009. |

## Approach

Ordered cheapest-first, with the one dependency last.

### Phase 1 — Descriptor compatibility (`requires`)

The cheapest change and the one that gets more expensive to add every day.

- Add an optional `requires.saasaloy` semver-range field to `registry-item.schema.json` and to the
  `RegistryItem` type in `lib/schema.ts`.
- Check it in the applier **before planning any write**, comparing against the CLI's own version.
  Note this only becomes meaningful once the CLI ships a real version — see
  `plan-ship-the-cli-2026-08-01.md`, which moves it off `0.0.0`.
- Fail with a message naming the module, the required range, the installed version, and the upgrade
  command.
- Teach `create-module` and the new `saasaloy new module` to emit it.
- Extend `saasaloy doctor` (from `plan-applier-test-harness-2026-08-01.md`) to validate it.

### Phase 2 — `saasaloy env`

- `saasaloy env` reads every installed module's declared `envVars` from its descriptor and compares
  against the project's existing `.dev.vars`.
- Prompt for each unset variable, using the descriptor's description as the prompt hint.
- Confirm `.dev.vars` is gitignored before writing; refuse and explain if not. Add it to the base
  template's `_gitignore` if it isn't already there.
- Resolve **which** `.dev.vars` — the base ships `apps/web/wrangler.jsonc`, and `api` scaffolds
  another Worker. See Open questions.
- `saasaloy env --check` reports missing variables without prompting, so it can gate a deploy.
- Print (never run) the corresponding `wrangler secret put` lines for production.
- Have `add` point at `saasaloy env` in its summary instead of only listing the variables.

### Phase 3 — `saasaloy new module`

- `saasaloy new module <name>` scaffolds `modules/<name>/` with a schema-valid
  `registry-item.json`, a `files/` directory, and `skills/saasaloy-<name>/SKILL.md`.
- Prompt for the two-tier type (`saasaloy:capability` vs `saasaloy:feature`) and `dependsOn`, since
  those drive everything else about the module's shape.
- Emit pinned `dependencies[]` per ADR 0017 and the deps workflow, and a `requires` range from
  Phase 1.
- Run `saasaloy doctor` on the result so a freshly scaffolded module is provably valid.
- Update the `create-module` skill to invoke this rather than hand-writing the skeleton, keeping its
  guidance about conventions and vertical slices.

### Phase 4 — `saasaloy outdated`

**Blocked on** `plan-update-and-ai-merge-2026-08-01.md` Phase 1.

- Call the shared SHA-comparison function for every module in `saasaloy-lock.json`.
- Table output: module, current SHA (short), latest SHA, ref, and whether it moved.
- Skip `local` entries with a note — they have no remote to compare against.
- Handle unreachable sources (deleted repo, network down) as a reported row, not a crash.
- Non-zero exit when anything is outdated, so it can be a CI or pre-deploy check.

## Open questions

Targets for grillkit before this is filed as issues.

- **Which `.dev.vars`?** A generated project can have several Workers (`apps/web`, and `apps/api`
  once installed). Does `env` write one per app, infer the target from which alias the declaring
  module wrote files to, or ask? The descriptor's `envVars` map has no app-scoping field today.
- **Should `envVars` gain a `secret: true` flag,** so `env` can distinguish a public build-time
  variable (`PUBLIC_API_URL`) from a real secret and route them differently?
- **Does `env` ever rewrite an existing value,** or only fill blanks? Rewriting risks clobbering
  something the user set deliberately.
- **Is a fatal `requires` mismatch right for a *transitive* dependency?** Failing the whole install
  because a dependency-of-a-dependency wants a newer CLI is correct but blunt.
- **Should `requires` also constrain the other direction** — a maximum version, for a descriptor
  known to break on a future CLI?
- **Does `new module` belong in the shipped CLI at all,** or is it a maintainer/authoring command
  that should live behind a separate entry point? It's the only command here that operates on a
  *registry* repo rather than a generated project.
- **`outdated` exit code** — non-zero on any drift makes it a useful gate but a noisy one, the same
  tension already open for `deps:check` in the shipping plan.

## Non-goals

- **Module stacks / recipes** — `plan-module-stacks-2026-08-01.md`.
- **The update flow and AI merge** — `plan-update-and-ai-merge-2026-08-01.md`, which also owns
  Drizzle migration regeneration.
- **`saasaloy doctor`** — `plan-applier-test-harness-2026-08-01.md`. This plan extends it, doesn't
  build it.
- **Running `wrangler secret put` or any deploy action.** The CLI prints; the user runs.
- **Reading env values from a secret manager or `.env` files.** `.dev.vars` only.
