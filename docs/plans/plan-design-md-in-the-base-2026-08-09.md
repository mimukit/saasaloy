# Plan — `DESIGN.md` ships in the base, and a skill keeps it true

Grilled: 2026-08-09

> Tracked in [#75](https://github.com/mimukit/saasaloy/issues/75). **Blocked by [#61](https://github.com/mimukit/saasaloy/issues/61)** — PR [#74](https://github.com/mimukit/saasaloy/pull/74) already lands the `init` skill-link step this plan used to own, and the product interview this plan now reads from.

## Context

Every Saasaloy project starts with a real design layer — Tailwind 4, shadcn `neutral` tokens in
`packages/ui/src/styles/globals.css`, seven vendored blocks ([ADR 0022](../adr/adr-0022-design-layer-ships-in-the-base-2026-08-06.md)) — and no
statement of what any of it *means*. An agent asked to build a new page in a scaffolded project has
to re-derive the system from the CSS every time, and nothing stops it inventing a shadow scale, a
sixth grey, or a second radius vocabulary on the way.

[`DESIGN.md`](https://github.com/google-labs-code/design.md) is what the ecosystem converged on for
that gap: an Apache-2.0 format from Google Labs pairing machine-readable tokens in YAML front matter
with human-readable rationale, deliberately shaped as the design counterpart to `AGENTS.md`. It is
the file `uikit` reads at rung 1 and treats as *the* palette, type scale, spacing and radii —
"full stop" — and the file any other DESIGN.md-aware agent discovers at the repo root.

The base already ships `AGENTS.md`, `CLAUDE.md` and module skills. It does not ship the design
contract, so the agent-native project is agent-native everywhere except the layer it is most likely
to get wrong.

**Success:** `saasaloy init` produces a project with a `DESIGN.md` at its root that is *true of that
project's actual tokens*, passes the official linter, and **can prove whether it is still true**,
plus a shipped skill that makes it the owner's own — brand interview, theme preset, re-derived
tokens — and keeps it true as `packages/ui` moves.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Base, not a module** | Same argument [ADR 0022](../adr/adr-0022-design-layer-ships-in-the-base-2026-08-06.md) made for the design layer itself and [#71](https://github.com/mimukit/saasaloy/issues/71) reused for the linter: every project wants it, so an opt-in module is a step everyone takes. Inverting it is worse — a module shipping UI would `dependsOn` a documentation artifact with no capability. |
| **The file is seeded, not generated** | `packages/cli/templates/base/DESIGN.md` is derived **once by the maintainer**, reviewed, and committed with `{{PROJECT_NAME}}` in `name:`. `init` stays a pure copy — no interview, no network, no CLI logic. Every project is lint-clean and `uikit`-ready on day one. |
| **Seeding is only defensible because the base is uniform** | The template ships **one** UI, byte-identical in every project. Running an extraction at `init` would produce the same file every time; doing it once upstream is the same output for none of the cost. The moment the owner swaps the preset that stops being true — which is what the fingerprint detects and the skill repairs. |
| **The seed carries a token fingerprint** | *Grilled.* A seed that survives a preset swap unrevised misleads every agent that reads it, and `uikit` rung 1 has no way to tell. The stamp therefore carries a hash of the file the tokens were derived from, so staleness is a **checkable fact** — offline, with no linter and no network. This is what makes the seed defensible rather than merely convenient, and it is the mechanism the drift assertion in [Phase 5](#phase-5--prove-it) always needed and never had. |
| **The fingerprint covers `globals.css` and nothing else** | *Grilled.* It answers exactly one question: *are the tokens still what this file says.* Hashing all of `packages/ui/src` would trip on every ordinary component edit, and a signal that cries wolf on each commit is worth less than no signal. Module UI is covered instead by the `add` nudge below. |
| **The skill is vendored, not delegating** | `designkit` lives in a maintainer's private `~/.claude/skills` and is not published. A shipped skill that defers to it is broken for every user who isn't its author. `saasaloy-design` is a self-contained, **narrowed** descendant (designkit is MIT). |
| **Provenance is a line, not a cadence** | *Grilled.* The skill's front matter records `derived-from: designkit (MIT), narrowed 2026-08-09` and the body states the seam. No review schedule: the spec is alpha, module skills have no update path either, and a promised review nobody runs is worse than an honest "re-derived by hand". |
| **Narrowing is most of the value** | The template deletes designkit's hardest problems: the token home is known, there is no "no system" case, no rung search, no cluster-threshold judgment, and the write surface is one CSS file plus one Markdown file. What it *adds* is Saasaloy-specific and has no generic equivalent — the preset-merge semantics, the fingerprint, and the one-time-gift warning. |
| **Modes are `theme` / `update` / `audit`** | Recast for a base that always has a file. `theme` owns brand interview → pick or generate a `registry:style` preset → `shadcn add` → re-derive from the merged `globals.css` → re-stamp → lint. `update` and `audit` inherit designkit's behaviour, plus re-stamping. designkit's `init` disappears; the seed is the init. |
| **Linter via `pnpm dlx`, nothing pinned** | The skill shells out to `pnpm dlx @google/design.md` (currently `0.4.0`, published 2026-07-27; commands are `lint` / `diff` / `export` / `spec`). No template devDependency, no `design:lint` script, no lint-staged entry. The spec is explicitly alpha and moving, and designkit's own rule is to read it at run time rather than freeze it. `pnpm dlx` is already the template's sanctioned form — `npx` is banned outright, `dlx` is not. |
| **`audit` runs offline and says so** | *Grilled.* With nothing pinned, no network means no structural lint — but the fingerprint check needs neither. `audit` reports drift, then prints one line naming the leg that did not run and why. It never claims validation that didn't happen. "Degrade loudly" is load-bearing here, not decorative. |
| **The seed's stamp is honest about what it is** | designkit's `_Extracted from main@sha_` is a lie in a scaffolded repo — that SHA belongs to *this* repo. The seed carries a distinct line naming the template, `{{CLI_VERSION}}` and the fingerprint, replaced by a real stamp on the first `update`. |
| **Elevation is prose, not `omitted`** | *Grilled, and reversed on evidence.* `omitted: [elevation]` is **invalid** — the linter answers `warning: unknown section name 'elevation' in omitted key` (rule `unknown-omission`), because `omitted` accepts only token-group sections. The spec's own flat-design example is a written `## Elevation & Depth` section, and that is what the seed ships: surfaces here are separated by borders, and saying so is the design statement. A reviewer must not "fix" it by inventing a shadow scale. |
| **`omitted` carries spacing, with a reason** | *Grilled.* The template defines no custom spacing scale — it uses Tailwind's default — and the linter emits an `info` for the gap. `omitted: [{ section: spacing, reason: "Tailwind's default scale is used unchanged" }]` states the choice where the schema accepts it, instead of leaving an unexplained gap for the next reader to fill with invented tokens. |
| **Motion is prose** | The schema has no token home for duration or easing, and both `motion:` at top level and `transitionDuration` on a component produce linter warnings. `## Motion` is prose or absent. |
| **`DESIGN.md` sits at the generated repo root** | The spec's convention and how DESIGN.md-aware tools discover it — even though the tokens live in `packages/ui`. |
| **The tool repo gets no `DESIGN.md` of its own** | *Grilled.* `design.md lint` takes an explicit `<FILE>` argument, so the seed lints from `packages/cli/templates/base/DESIGN.md` without a root file. A second copy at the tool repo's root would document UI this repo never renders and drift from the one that ships. |
| **The brand interview belongs to [#61](https://github.com/mimukit/saasaloy/issues/61)** | *Grilled.* #61 already writes `docs/product-brief.md` into the scaffolded project and is in review. `saasaloy-design theme` **reads that brief first** and asks only the dimensions it doesn't cover — colour mood, preset direction, density — then writes `DESIGN.md`'s Overview and Do's and Don'ts. When no brief exists it asks the product questions itself and writes one in #61's format. Nobody answers "who is this for" twice. |
| **Module UI gets a nudge, not a gate** | *Grilled.* When a module's plan writes any file under `packages/ui/`, `add` prints one line pointing at `saasaloy-design update`. That is a conditional over the applier's existing plan, not new machinery — and it avoids putting a network call inside `add`. `audit` re-derives across module files too, so an introduced value is findable. |
| **Skill housing follows the existing ADRs** | `_agents/skills/saasaloy-design/` in the template → `.agents/skills/` canonical + `.claude/skills/` symlink ([ADR 0015](../adr/adr-0015-module-skills-agents-canonical-claude-symlink-2026-07-24.md)), `saasaloy-` prefix ([ADR 0014](../adr/adr-0014-saasaloy-prefixed-module-skill-names-2026-07-23.md)). |
| **Proof folds into `verify-preset.ts`** | *Grilled.* That script already fetches a real preset and applies it to `.dev/playground` — the exact setup a staleness assertion needs. It gains two assertions rather than spawning a second script that fetches the same preset from the same third party. Still **out** of `deps:verify`. |
| **No pre-commit check yet** | *Grilled.* A fingerprint check needs no network, so a "staged `globals.css` without `DESIGN.md`" warning becomes cheap the moment [#71](https://github.com/mimukit/saasaloy/issues/71)'s lint-staged lands. File it then. Coupling #75 to a second unmerged issue buys nothing. |

### Evidence from the linter

Run against `@google/design.md@0.4.0` during the grill, on probe files:

- A seed carrying an **unsubstituted `{{PROJECT_NAME}}`** in `name:` and a prose stamp line lints with **0 errors**. Unknown section headings are spec'd as "preserve; do not error", so the stamp is safe. The "lints unsubstituted" criterion is satisfiable exactly as written.
- `omitted: [elevation]` → `warning · unknown-omission · unknown section name 'elevation' in omitted key`.
- A missing `spacing` section is `info` severity; missing typography tokens is `warning`. The seed must define real typography tokens to come back clean.

## Approach

### What this reuses

Almost all of it already exists, which is why the CLI surface is now one line:

- **`copyTemplate` needs no changes.** It renames `_foo` → `.foo` at *any* depth and applies
  `{{VAR}}` substitution to every file, so `_agents/skills/saasaloy-design/SKILL.md` lands as
  `.agents/skills/saasaloy-design/SKILL.md` with the project name already substituted.
- **`linkAgentSkills` in `init.ts` already exists** — landed by PR [#74](https://github.com/mimukit/saasaloy/pull/74) for #61, and already written
  generically over *every* folder under `.agents/skills/`, with conflicts reported and never fatal.
  `saasaloy-design` is picked up with **no code change at all**.
- **`scripts/verify-preset.ts`** already runs the preset swap for real against `.dev/playground` and
  asserts every hand-written part of `globals.css` survives the merge. That is the risky half of the
  skill's `theme` mode, already proven and already documented as out-of-gate.
- **`_gitignore`** already ignores `.claude/skills/`, so a base-shipped skill's link is
  regenerated per-machine exactly like a module's.
- **`templates/base/AGENTS.md`** already documents the preset-swap recipe and the no-update-path
  warning; the skill points at that prose rather than restating it.
- **`docs/product-brief.md`** — #61's interview persistence, already the agreed home for product,
  audience and tone.

### Phase 1 — Record the decision

- ADR 0023: the design *contract* ships in the base, on ADR 0022's own argument.
- The consequence that earns the ADR is not base-vs-module, it is this: the seed is a base file, so
  it has **no update path**, and it stops being true the instant the owner swaps the preset. The
  fingerprint is what keeps that consequence honest — the file cannot go stale *silently* — and the
  skill is what repairs it.
- Glossary entries in `CONTEXT.md` for **`DESIGN.md`**, **base-shipped skill** (as distinct from a
  module skill, which arrives via `add`), and **token fingerprint**.

### Phase 2 — Derive and commit the seed

- Run `designkit init` against `packages/cli/templates/base/` and review the output by hand.
- Expected shape, from what the template actually contains: colors from `:root`/`.dark`; `rounded`
  from the `--radius` scale (`0.625rem`, with `sm`/`md`/`lg`/`xl` derived); real typography tokens
  from what the blocks apply; `omitted: [{ section: spacing, reason: … }]`; a written
  `## Elevation & Depth` stating borders-over-shadows; components for the primitives that carry real
  state pairs.
- Commit as `packages/cli/templates/base/DESIGN.md` with `{{PROJECT_NAME}}` in `name:` and the seed
  stamp:

  ```
  _Seeded from the saasaloy base template · CLI {{CLI_VERSION}} · tokens sha256:<12 hex> of packages/ui/src/styles/globals.css_
  ```

- Confirm `globals.css` contains no `{{VAR}}` tokens, so it copies byte-identical and the hash stays
  valid in every scaffolded project. If that ever stops being true, the hash must be computed
  post-substitution instead.
- Verify it lints **unsubstituted**:
  `pnpm dlx @google/design.md lint packages/cli/templates/base/DESIGN.md`.

### Phase 3 — Vendor the narrowed skill

- `packages/cli/templates/base/_agents/skills/saasaloy-design/SKILL.md`, one file, matching the five
  existing `saasaloy-*` module skills.
- Carries: the token home by name, the three modes, the preset-merge semantics, the grounding rule
  (never a value the codebase doesn't contain), the fingerprint's meaning and how to recompute and
  re-stamp it, that `elevation` is prose and never an `omitted` entry, the schema's refusal to hold
  motion, degrade-loudly, and the ADR 0022 warning that `globals.css` is the owner's to maintain.
- `theme` reads `docs/product-brief.md` before asking anything, and asks only what the brief doesn't
  answer. With no brief, it asks the product questions and writes one in #61's format.
- `update` and `theme` always re-stamp the fingerprint. `audit` never writes.
- Front matter records `derived-from: designkit (MIT), narrowed 2026-08-09`, so it never reads as
  the same skill at a different version.
- Explicit seam with `uikit`: this skill records the system, it writes no components and no pages.

### Phase 4 — One CLI change

- Add `CLI_VERSION` to `copyTemplate`'s vars in `init.ts`, read from the CLI's own `package.json`,
  so the seed stamp can name the CLI that wrote it. (Reads `0.0.0` until [#46](https://github.com/mimukit/saasaloy/issues/46) publishes — honest,
  if not yet useful.)
- Add the module-UI nudge to `add`: when the applier's plan writes any file under `packages/ui/`,
  print one line pointing at `saasaloy-design update`.
- **The skill-link step is not in scope** — `linkAgentSkills` already covers it. See the blocker
  on #61.

### Phase 5 — Point the template at it

- `templates/base/AGENTS.md`: a pointer from the `@repo/ui` design-layer section to `DESIGN.md`, an
  "Always Do" entry to read it before writing UI, and a line on the preset-swap recipe noting that a
  swap invalidates `DESIGN.md` and that `saasaloy-design theme` is how to run the swap so it doesn't.
- `templates/base/README.md`: one line, so a human reader finds the file too.

### Phase 6 — Prove it

- Extend `scripts/verify-preset.ts` — still **not** wired into `deps:verify`:
  1. Before the swap: assert `DESIGN.md` is present in `.dev/playground` and lints clean.
  2. After the swap: assert the recorded fingerprint no longer matches `globals.css`.
  That second assertion is the whole argument for `audit` existing, run for real.
- Manual leg: run the skill's `theme` mode end to end in `.dev/playground` and confirm the
  re-derived tokens match the merged `globals.css` and the stamp was rewritten.

## Follow-ups

- **Pre-commit fingerprint check** — once [#71](https://github.com/mimukit/saasaloy/issues/71) lands husky + lint-staged in the template, add a
  warning when `packages/ui/src/styles/globals.css` is staged and `DESIGN.md` is not. Offline, no
  network, and it catches the exact failure this plan is built around.

## Non-goals

- **Writing or restyling UI.** `uikit` builds, this records. A skill that both invents the taste and
  documents it can be held to neither job. Growing the base a shadow scale is a separate issue.
- **An update path for base files.** ADR 0022 settled that `init` is a one-time gift; this plan does
  not add manifest tracking or `--diff` for `DESIGN.md`. The fingerprint detects staleness; it does
  not repair it.
- **A palette or preset library.** The preset catalogue is tweakcn's and shadcn's; Saasaloy ships no
  curated themes.
- **CI enforcement.** [#46](https://github.com/mimukit/saasaloy/issues/46) owns CI. Nothing here gates a build.
- **The linter in pre-commit.** Reversed by the `pnpm dlx` decision; [#71](https://github.com/mimukit/saasaloy/issues/71)'s lint-staged does not gain a
  `DESIGN.md` **lint** entry. (A hash check is not the linter — see Follow-ups.)
- **Translation.** [#73](https://github.com/mimukit/saasaloy/issues/73) owns locale splitting; a design token is not a message.
