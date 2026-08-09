# Plan — `DESIGN.md` ships in the base, and a skill keeps it true

> Tracked in [#75](https://github.com/mimukit/saasaloy/issues/75), filed ungrilled. Shares the brand interview and the `init` skill-link step with [#61](https://github.com/mimukit/saasaloy/issues/61) — grill the two together.

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
project's actual tokens* and passes the official linter, plus a shipped skill that makes it the
owner's own — brand interview, theme preset, re-derived tokens — and keeps it true as `packages/ui`
moves.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Base, not a module** | Same argument [ADR 0022](../adr/adr-0022-design-layer-ships-in-the-base-2026-08-06.md) made for the design layer itself and [#71](https://github.com/mimukit/saasaloy/issues/71) reused for the linter: every project wants it, so an opt-in module is a step everyone takes. Inverting it is worse — a module shipping UI would `dependsOn` a documentation artifact with no capability. |
| **The file is seeded, not generated** | `packages/cli/templates/base/DESIGN.md` is derived **once by the maintainer**, reviewed, and committed with `{{PROJECT_NAME}}` in `name:`. `init` stays a pure copy — no interview, no network, no CLI logic. Every project is lint-clean and `uikit`-ready on day one. |
| **Seeding is only defensible because the base is uniform** | The template ships **one** UI, byte-identical in every project. Running an extraction at `init` would produce the same file every time; doing it once upstream is the same output for none of the cost. The moment the owner swaps the preset that stops being true — which is what the skill exists for. |
| **The skill is vendored, not delegating** | `designkit` lives in a maintainer's private `~/.claude/skills` and is not published. A shipped skill that defers to it is broken for every user who isn't its author. `saasaloy-design` is a self-contained, **narrowed** descendant (designkit is MIT). |
| **Narrowing is most of the value** | The template deletes designkit's hardest problems: the token home is known, there is no "no system" case, no rung search, no cluster-threshold judgment, and the write surface is one CSS file plus one Markdown file. What it *adds* is Saasaloy-specific and has no generic equivalent — the preset-merge semantics and the one-time-gift warning. |
| **Modes are `theme` / `update` / `audit`** | Recast for a base that always has a file. `theme` owns brand interview → pick or generate a `registry:style` preset → `shadcn add` → re-derive from the merged `globals.css` → re-stamp → lint. `update` and `audit` inherit designkit's behaviour. designkit's `init` disappears; the seed is the init. |
| **Linter via `pnpm dlx`, nothing pinned** | The skill shells out to `pnpm dlx @google/design.md` (currently `0.4.0`, published 2026-07-27). No template devDependency, no `design:lint` script, no lint-staged entry. The spec is explicitly alpha and moving, and designkit's own rule is to read it at run time rather than freeze it. `pnpm dlx` is already the template's sanctioned form — `npx` is banned outright, `dlx` is not. |
| **"Degrade loudly" is now load-bearing** | With nothing pinned, offline means no lint. The skill must report the gap in the same breath as the result and never claim validation that didn't happen. This is inherited from designkit verbatim and is not optional here. |
| **The seed's stamp is honest about what it is** | designkit's `_Extracted from main@sha_` is a lie in a scaffolded repo — that SHA belongs to *this* repo. The seed carries a distinct line naming the template and `{{CLI_VERSION}}`, replaced by a real stamp on the first `update`. |
| **Elevation is `omitted`, deliberately** | There is not one `shadow-*` utility anywhere in `packages/ui`; the base separates surfaces with borders. The spec's `omitted` field exists for exactly this. A reviewer must not "fix" the seed by inventing a shadow scale — the omission is the design statement. |
| **Motion is prose** | The schema has no token home for duration or easing, and both `motion:` at top level and `transitionDuration` on a component produce linter warnings. `## Motion` is prose or absent. |
| **`DESIGN.md` sits at the generated repo root** | The spec's convention and how DESIGN.md-aware tools discover it — even though the tokens live in `packages/ui`. |
| **The brand interview is shared with [#61](https://github.com/mimukit/saasaloy/issues/61)** | `DESIGN.md`'s **Overview** carries brand intent and its **Do's and Don'ts** carries UI copy voice — designkit puts voice there deliberately. The landing-copy skill *reads* those rather than re-asking. Grilled alongside #61 for that reason. |
| **Skill housing follows the existing ADRs** | `_agents/skills/saasaloy-design/` in the template → `.agents/skills/` canonical + `.claude/skills/` symlink ([ADR 0015](../adr/adr-0015-module-skills-agents-canonical-claude-symlink-2026-07-24.md)), `saasaloy-` prefix ([ADR 0014](../adr/adr-0014-saasaloy-prefixed-module-skill-names-2026-07-23.md)). |
| **Proof is a network script outside the gate** | `pnpm verify:design`, mirroring `verify:preset` exactly: run the real thing against `.dev/playground`, assert the result, and stay **out** of `deps:verify` because it depends on a third party's uptime. |

## Approach

### What this reuses

Almost all of it already exists, which is why the CLI surface is nearly zero:

- **`copyTemplate` needs no changes at all.** It renames `_foo` → `.foo` at *any* depth and applies
  `{{VAR}}` substitution to every file, so `_agents/skills/saasaloy-design/SKILL.md` lands as
  `.agents/skills/saasaloy-design/SKILL.md` with the project name already substituted. Only the
  `.claude/skills/` symlink is new code.
- **`classifyLink` / `createDirLink`** (`packages/cli/src/lib/fs-utils.ts`) already create the
  native link — POSIX symlink or Windows junction — and already treat a pre-existing non-symlink as
  a reported conflict. `add` drives them today; `init` needs the same call.
- **`scripts/verify-preset.ts`** already runs the preset swap for real against `.dev/playground` and
  asserts every hand-written part of `globals.css` survives the merge. That is the risky half of the
  skill's `theme` mode, already proven and already documented as out-of-gate.
- **`_gitignore`** already ignores `.claude/skills/`, so a base-shipped skill's link is
  regenerated per-machine exactly like a module's.
- **`templates/base/AGENTS.md`** already documents the preset-swap recipe and the no-update-path
  warning; the skill points at that prose rather than restating it.

### Phase 1 — Record the decision

- ADR 0023: the design *contract* ships in the base, on ADR 0022's own argument.
- The consequence that earns the ADR is not base-vs-module, it is this: the seed is a base file, so
  it has **no update path**, and it stops being true the instant the owner swaps the preset. That is
  the entire reason a skill ships beside it.
- Glossary entries in `CONTEXT.md` for **`DESIGN.md`** and **base-shipped skill** (as distinct from
  a module skill, which arrives via `add`).

### Phase 2 — Derive and commit the seed

- Run `designkit init` against `packages/cli/templates/base/` and review the output by hand.
- Expected shape, from what the template actually contains: colors from `:root`/`.dark`; `rounded`
  from the `--radius` scale (`0.625rem`, with `sm`/`md`/`lg`/`xl` derived); typography from what the
  blocks apply; `omitted: [elevation]`; components for the primitives that carry real state pairs.
- Commit as `packages/cli/templates/base/DESIGN.md` with `{{PROJECT_NAME}}` in `name:` and the seed
  stamp carrying `{{CLI_VERSION}}`.
- Verify it lints **unsubstituted** — `{{PROJECT_NAME}}` is a plain YAML string, so the file must
  pass in the repo, not only after scaffolding.

### Phase 3 — Vendor the narrowed skill

- `packages/cli/templates/base/_agents/skills/saasaloy-design/SKILL.md`, one file, matching the five
  existing `saasaloy-*` module skills.
- Carries: the token home by name, the three modes, the preset-merge semantics, the grounding rule
  (never a value the codebase doesn't contain), the `omitted`-beats-invented rule, the schema's
  refusal to hold motion, degrade-loudly, and the ADR 0022 warning that `globals.css` is the owner's
  to maintain.
- States plainly in its own front matter that it is a narrowed descendant of `designkit`, so it
  never reads as the same skill at a different version.
- Explicit seam with `uikit`: this skill records the system, it writes no components and no pages.

### Phase 4 — Link base-shipped skills at `init`

- `init` gains one step: for every folder under the scaffolded `.agents/skills/`, create
  `.claude/skills/<name>` via the existing helpers, reporting conflicts rather than clobbering.
- **Written generically — every folder, not a named list** — because [#61](https://github.com/mimukit/saasaloy/issues/61) needs the identical step for
  `saasaloy-landing-copy`. Whichever issue lands first owns the code; the second reuses it.
- Add `CLI_VERSION` to the `copyTemplate` vars so the seed stamp can name the CLI that wrote it.
  (Reads `0.0.0` until [#46](https://github.com/mimukit/saasaloy/issues/46) publishes — honest, if not yet useful.)

### Phase 5 — Point the template at it

- `templates/base/AGENTS.md`: a pointer from the `@repo/ui` design-layer section to `DESIGN.md`, an
  "Always Do" entry to read it before writing UI, and a line on the preset-swap recipe noting that a
  swap invalidates `DESIGN.md` and that `saasaloy-design theme` is how to run the swap so it doesn't.
- `templates/base/README.md`: one line, so a human reader finds the file too.

### Phase 6 — Prove it

- `pnpm verify:design` in the tool repo, modelled on `verify-preset.ts` and **not** wired into
  `deps:verify`: scaffold `.dev/playground`, assert `DESIGN.md` is present and lints, then apply a
  real preset and assert the file is detectably stale afterwards — which is what makes the skill's
  `audit` mode worth having.
- Manual leg: run the skill's `theme` mode end to end in `.dev/playground` and confirm the re-derived
  tokens match the merged `globals.css`.

## Open questions

- **Is a stale `DESIGN.md` worse than none?** `uikit` treats rung 1 as authoritative — "its tokens
  *are* the palette, full stop". A seed that survives a preset swap unrevised actively misleads every
  agent that reads it, and nothing forces the owner to run `update`. This is the sharpest risk in the
  plan and the one most likely to reverse the seed decision.
- **How does the vendored fork track upstream `designkit`?** There is no mechanism, and module skills
  have no update path either. Is manual re-derivation acceptable, or does the fork need a recorded
  provenance line and a review cadence?
- **Does the brand interview live here or in #61?** Both skills need product, audience and tone.
  One interview writing into `DESIGN.md` that the copy skill then reads is the proposal — but the
  ordering (design before copy, or copy before design) is unsettled, and whichever runs second must
  not re-ask.
- **Is `audit` honest enough without a pinned linter?** With `pnpm dlx`, an offline audit reports
  drift but no lint. Is a partial audit useful, or should the mode refuse and say so?
- **What happens when `add` drops module UI?** `waitlist` writes a section and a form into the
  project. Module UI is written against the tokens, so it shouldn't introduce values — but nothing
  checks that, and `add` never touches `DESIGN.md`. Should module UI be lint-fenced, audited, or
  simply trusted?
- **Should `omitted: [elevation]` be a statement or a prompt?** The base having no shadow scale is
  currently an accident of how the blocks were written. If it is intended, the seed's prose should say
  why borders over shadows; if not, the base should grow the scale first.
- **Does the tool repo get its own `DESIGN.md`?** It ships no UI of its own — probably not, but the
  template's seed is UI it *owns*, which makes the answer less obvious than it looks.

## Non-goals

- **Writing or restyling UI.** `uikit` builds, this records. A skill that both invents the taste and
  documents it can be held to neither job.
- **An update path for base files.** ADR 0022 settled that `init` is a one-time gift; this plan does
  not add manifest tracking or `--diff` for `DESIGN.md`.
- **A palette or preset library.** The preset catalogue is tweakcn's and shadcn's; Saasaloy ships no
  curated themes.
- **CI enforcement.** [#46](https://github.com/mimukit/saasaloy/issues/46) owns CI. Nothing here gates a build.
- **The linter in pre-commit.** Reversed by the `pnpm dlx` decision; [#71](https://github.com/mimukit/saasaloy/issues/71)'s lint-staged does not gain a
  `DESIGN.md` entry.
- **Translation.** [#73](https://github.com/mimukit/saasaloy/issues/73) owns locale splitting; a design token is not a message.
