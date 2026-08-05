# Plan — Module stacks: one command to a composed SaaS

> **Not filed as an issue.** Deliberately gated — see Open questions for the trigger. The descriptor
> shape is settled now, while nothing needs retrofitting; implementation waits for a module set that
> makes a curated composition meaningful.

## Context

Saasaloy's onboarding is currently a sequence:

```sh
saasaloy init my-app
saasaloy add auth
saasaloy add admin
saasaloy add billing
saasaloy add teams
```

Each step is a separate confirmation, a separate dependency resolution, and a separate decision the
user has to already know how to make. The README's own framing — "installs everything churny on
demand" — describes the mechanism accurately but leaves the *composition* as an exercise for
someone who has never used the tool. A newcomer doesn't know that `billing` implies `auth`, or that
a B2B product wants `teams` and a solo-founder product doesn't.

A **stack** is a named, curated composition: `saasaloy init my-app --stack b2b-saas` scaffolds the
base and installs the modules that shape of product needs, in one confirmed step.

**A caveat this plan states up front:** the registry currently contains three modules (`api`,
`database`, `waitlist`). A curated composition over three modules is not meaningfully different from
typing them. This plan is therefore designed **now** — while the descriptor shape is cheap to
change — but is honestly premature to *build* until Phase 2 and Phase 3 modules exist. That
sequencing is a decision, recorded below.

**Success:** a newcomer reaches a composed, running SaaS in one command; stacks are authored the same
way modules are, by anyone with a registry repo; and adding a stack requires no new machinery in the
applier.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **A stack is a descriptor, not a CLI feature** | A stack is a `registry-item.json` with `type: "saasaloy:stack"`, a `dependsOn` list, and **no `files[]`**. That's it. The existing resolver already walks `dependsOn` recursively and topologically; the lock already records the full resolved graph; the registry already discovers `modules/*/registry-item.json`. A stack becomes a thing the applier can install **without a single new code path in the resolver.** |
| **Rejected: a hardcoded list in the CLI** | It would put curation in the binary, meaning a new stack requires a CLI release, and third-party registries could never ship one. The descriptor approach gives third-party stacks away for free — which is the whole point of #39. |
| **Rejected: a `--modules a,b,c` flag** | Solves the typing but not the *knowing*. The value of a stack is the curation, not the keystrokes. |
| **Stacks are installable after `init` too** | `saasaloy add b2b-saas` must work identically to `init --stack b2b-saas`. A stack is a module; `add` installs modules. Making `init --stack` sugar over `add` avoids two code paths. |
| **Build order: design now, build later** | The descriptor `type` enum and the "no `files[]`" rule are settled now so no descriptor needs retrofitting. Implementation waits until there are enough modules for a stack to mean something — see Open questions for the trigger. |
| **Stacks compose, they don't configure** | A stack selects modules. It does **not** carry settings, env values, or file overrides — that would make it a third tier and reintroduce exactly the boilerplate rot the two-tier design (ADR 0005) exists to avoid. |

## Approach

### Phase 1 — Settle the descriptor shape

Cheap, and it's the part that gets expensive to change later.

- Add `saasaloy:stack` to the `type` enum in `registry-item.schema.json`.
- Constrain the shape: a stack **must** declare `dependsOn` and **must not** declare `files[]`,
  `patches`, `dependencies[]`, or `agent.skills`. Enforce it in the schema so `doctor` catches a
  malformed stack at authoring time.
- Add a `description` requirement — a stack with no explanation of who it's for is useless, since the
  curation *is* the product.
- Update `lib/schema.ts`, `modules/README.md`, and the `create-module` skill.

### Phase 2 — Teach the applier that a stack installs nothing of its own

- Confirm `resolveGraph` handles a descriptor with no files (it should already — files are optional).
- The plan summary should read as a composition ("installs 6 modules") rather than showing a stack
  with zero file writes, which would look like a no-op.
- Record the stack itself in `saasaloy.json`'s `installed` and in the lock, so `remove` and
  `outdated` can reason about it.
- Decide what removing a stack means — see Open questions.

### Phase 3 — `init --stack`

- `saasaloy init <name> --stack <stack>` scaffolds the base, then runs the same code path `add`
  uses. One confirmation covering the whole composition, not one per module.
- With no `--stack`, offer an interactive picker listing available stacks with their descriptions,
  plus a "just the base" option — so the curation is discoverable rather than something you have to
  already know exists.
- `--stack` accepts a full module coordinate (`owner/repo/stack-name`), so third-party stacks work
  from day one.

### Phase 4 — Author the first stacks

Only once the module set justifies it. Candidates, drawn from the Phase 2/3 roadmap:

- **`waitlist-landing`** — `api` + `database` + `waitlist`. Buildable *today*, and the honest first
  test of whether the descriptor shape works.
- **`b2b-saas`** — `auth` + `admin` + `billing` + `teams`.
- **`solo-saas`** — `auth` + `admin` + `billing`, no teams.

Each stack ships with a skill-style README explaining what it composed and what to do next.

## Open questions

Targets for grillkit before this is filed as issues.

- **What triggers the build?** A module count, or the landing of specific modules (`auth` + `admin` +
  `billing`, which is when composition first requires knowledge a newcomer lacks)? This plan should
  not be filed as issues until that trigger is met.
- **What does removing a stack do?** Remove every module it pulled in — including ones the user has
  since built on — or just forget the stack and leave the modules? Neither is obviously right, and
  this interacts with `remove` (#27).
- **Can a stack depend on another stack?** The resolver would handle it, but a stack-of-stacks makes
  the "what did I actually install" question much harder to answer.
- **Should a stack pin its members' versions?** A stack that resolves to whatever is on `main` today
  is not reproducible across two users installing on different days — though the lock does capture
  what *each* user got. Pinning would make the stack a genuine release artifact.
- **Does a stack need a post-install next-steps output?** Composing six modules produces a lot of
  env vars, migrations, and manual steps. A wall of unstructured output would undo the DX win the
  stack exists to deliver.
- **Naming.** "Stack" collides with the stack table in the README (Astro/Hono/D1/…) which means
  something entirely different. "Recipe", "preset", "bundle", "kit" are alternatives —
  `CONTEXT.md` should pin whichever wins before the term spreads.

## Non-goals

- **Configurable stacks.** No settings, no env values, no file overrides, no "stack with options".
  A stack selects modules; anything more makes it a third tier.
- **Building the stacks before the modules exist.** Phase 4 is explicitly gated.
- **A stack marketplace or registry index.** Stacks are discovered exactly like modules are —
  `modules/*/registry-item.json` in a registry repo.
- **Replacing `init`'s existing behavior.** A bare `saasaloy init` still scaffolds the near-inert
  base, per ADR 0003.
- **The docs-site presentation of stacks** — that's part of the parked `saasaloy.dev` work.
