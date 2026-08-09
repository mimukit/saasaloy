# Plan — Reader-facing documentation for the tool repo

Grilled: 2026-08-09

> Tracked in [#77](https://github.com/mimukit/saasaloy/issues/77). Touches
> [#46](https://github.com/mimukit/saasaloy/issues/46) (npm publish), which owns the install path
> this plan has to work around, and reports gaps tracked by
> [#36](https://github.com/mimukit/saasaloy/issues/36) and
> [#49](https://github.com/mimukit/saasaloy/issues/49).

## Context

Saasaloy documents itself thoroughly for agents and maintainers, and not at all for readers.
`AGENTS.md`, `CLAUDE.md`, the module skills under `.agents/skills/`, [`CONTEXT.md`](../../CONTEXT.md),
22 ADRs, 28 plan documents, QA runs and status snapshots all exist. Every one of them is written
for somebody already inside the project. A person who finds the repo on GitHub gets `README.md`
and then falls off a cliff.

That gap is widest for the thing the project is actually selling. Saasaloy's pitch is a composable
module system, and the module system is the least self-evident part of the repo: two tiers plus
providers, convention-based extension points, a descriptor format, an alias map, a manifest, and a
lockfile. None of it is legible without reading source or ADRs.

Facts found while grounding and grilling this plan, each of which changed its shape:

**The CLI is not distributed yet.** `npm view saasaloy` returns 404. The package is `private: false`
with a `bin`, but nothing has been published, and publishing is [#46](https://github.com/mimukit/saasaloy/issues/46).
Every install instruction a tutorial could write today is a clone-and-build instruction.

**The registry half already works remotely.** `DEFAULT_OWNER` / `DEFAULT_REPO` in
`packages/cli/src/lib/registry.ts` resolve a bare `saasaloy add waitlist` against `mimukit/saasaloy`
on GitHub, fetched by giget at a resolved commit SHA ([ADR 0012](../adr/adr-0012-remote-first-registry-repo-is-the-registry-2026-07-23.md)).
The only missing piece in the reader's path is the CLI binary. Once they have it by any means,
`init` and `add` behave exactly as they will after #46. That is why the tutorial is worth writing
now: one section of one page changes when #46 lands, and everything else is already true.

**`remove` is not the inverse of `add`.** `packages/cli/src/lib/remover.ts:283` is explicit that
config patches are "report-only here — dropping the entry isn't a reversal". A module's `wrangler`
bindings and plugin-array entries survive its removal. [#36](https://github.com/mimukit/saasaloy/issues/36)
would close the gap. A docs run that assumes symmetry would ship a false statement.

**The repo has no CI.** No `.github/`, no husky, no lint-staged. Nothing gates anything today, which
is the backdrop for the deliberate decision not to gate the docs either.

**Success:** a reader who lands on the repo can install the CLI, scaffold a project, add a module,
and understand what the module system is, without opening `packages/cli/src`. A reader who wants to
contribute a module can find the authoring path without being handed an agent skill file.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Doc home is `docs/wiki/`** | `docs/` holds only agent artifact directories today (`adr`, `plans`, `qa`, `status`), and no docs engine config exists. wikikit's detection ladder lands on rung 3. `docs/wiki/` also keeps a reader from wandering into a QA plan, which rung 2 would not. |
| **One root set, no per-package set** | `pnpm-workspace.yaml` globs `packages/*`, which matches `packages/cli` and nothing else. `modules/` holds descriptors, not workspace members. wikikit's independently-published test would technically pass for `packages/cli`, but a second `.wikimap.yaml` for a one-package workspace buys a reader nothing and costs a second map to keep honest. |
| **Two tracks inside one set** | The repo serves a SaaS builder and a module contributor, and their pages share almost nothing. `index.md` splits into **Use Saasaloy** and **Build a module**, with `architecture.md` and `reference.md` sitting under both. One set, one map, no page that mixes the two readers. |
| **The tutorial documents the clone path** | Honest today, and the only path that works. `pnpm cli:link` from a `main` checkout puts a real `saasaloy` on `PATH`, and remote module resolution then works normally. One line names #46 as the future npm path without printing a command that fails. |
| **#46 gets the rewrite obligation, not this issue** | Rather than block #77 on #46, add a checkbox to #46: update `docs/wiki/getting-started.md` when the package publishes. The docs ship now; the churn is one section, owned by the issue that causes it. |
| **The tutorial states Node 24.13.0** | Three manifests disagree: root and the base template say `>=24.0.0`, `packages/cli` says `>=24.13.0`, and the README says "Node 24+". The strictest is the one a CLI installer actually hits, so it is the honest number to print. Reconciling the manifests is a real fix and a behavior change, so it stays **outside** this docs issue as its own `chore(repo):` issue. |
| **One runbook, and it is the registry** | The repo *is* the registry, so `main` is live infrastructure for every downstream `saasaloy add`. A broken `registry-item.json` merged to `main` breaks installs immediately, with no publish step in between. `runbooks/bad-descriptor-on-main.md` documents detection, revert, and why consumers pinned by SHA in `saasaloy-lock.json` are unaffected. No deploy or rollback pages: there is no deployed service and no workflow to describe. |
| **No release runbook yet** | Cutting a release means publishing to npm, which does not exist. It arrives with #46 or not at all. |
| **The contributor track is one orienting page** | `CONTRIBUTING.md` already covers the playground and the dependency workflow well, and `create-module` (242 lines) plus `create-provider` (181) are real authoring guides. All three live where a human browsing GitHub will not find them. One page routes to all three and duplicates none, collapsing three planned pages into one. |
| **Limitations live in one section of `reference.md`** | A single **Known limitations** block covering the config-patch gap (#36) and `add`'s partial-failure behaviour (#49), each linked to its issue. One place to keep current as those issues land. `remove-a-module.md` cross-links the section rather than restating it. |
| **No third-party registry how-to** | [#39](https://github.com/mimukit/saasaloy/issues/39) changes module identifiers for third-party registries and is in flight. The coordinate grammar goes in `reference.md` as a grammar block, so #39's churn is a few lines instead of a narrative page. Nobody needs a third-party registry before the CLI publishes. |
| **Nothing gates the docs** | No link check, no command check, no CI job. `wikikit audit` on demand is the whole verification story. This is a deliberate trade accepted with the risk named below, not an oversight. |
| **`CONTRIBUTING.md` is linked, never rewritten** | Anything wikikit would write there instead becomes a second home for the same instructions, and the two drift. |
| **Agent files are neither source nor target** | `AGENTS.md`, `CLAUDE.md`, and the skills under `.agents/skills/` are written for an agent mid-task. The contributor page *points at* `create-module` and `create-provider`; it does not paraphrase them, and no page in the set edits them. |
| **Terms and rationale are links** | A page needing a term links [`CONTEXT.md`](../../CONTEXT.md). A page needing a rationale links the ADR by number. Neither is restated inline. |
| **No docs engine, in-repo only** | The repo runs none, and wikikit does not introduce one. Plain Markdown that renders on GitHub. The GitHub wiki tab stays out of scope. |

## Approach

### What this reuses

Most of the content already exists in the repo and needs relocating for a different reader, not
inventing:

- **`CONTEXT.md`** already defines every term the architecture page needs: base, module, capability
  module, feature module, provider module, applier, registry source, module coordinate, alias map,
  manifest, lockfile. The architecture page narrates how they fit and links each definition.
- **The 22 ADRs** already carry the reasoning. ADRs [0001](../adr/adr-0001-all-in-on-cloudflare-2026-07-22.md),
  [0005](../adr/adr-0005-two-tier-convention-based-modules-2026-07-22.md),
  [0012](../adr/adr-0012-remote-first-registry-repo-is-the-registry-2026-07-23.md),
  [0013](../adr/adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md) and
  [0020](../adr/adr-0020-capability-owns-its-vendor-packages-2026-07-24.md) are the spine of the
  architecture page.
- **`CONTRIBUTING.md`** already documents the playground, the global-link caveat, and the whole
  dependency workflow. The contributor page links these sections rather than restating them.
- **`packages/cli/schemas/*.schema.json`** are the authoritative shape of `saasaloy.json`,
  `registry-item.json`, `saasaloy-lock.json` and the manifest. `reference.md` links them instead of
  hand-transcribing fields that would drift.
- **`README.md`** already has the stack table and the Cloudflare cost caveat. The docs link back to
  it, and the README grows one link into the set.

The genuinely new writing is the narrative connecting these: a tutorial, three task how-tos, the
architecture explanation, and one runbook.

### The page list — eight pages

| Page | Track | Mode |
|------|-------|------|
| `index.md` | both | entry point, splits the two tracks |
| `getting-started.md` | use | tutorial |
| `how-to/add-a-module.md` | use | how-to |
| `how-to/remove-a-module.md` | use | how-to |
| `how-to/contribute-a-module.md` | build | how-to |
| `architecture.md` | both | explanation |
| `reference.md` | both | reference |
| `runbooks/bad-descriptor-on-main.md` | build | how-to (operator) |

### Phase 1 — Establish the set

Run wikikit `init`. Confirm the ladder lands on rung 3 and create `docs/wiki/` with
`.wikimap.yaml`. State the root-only split out loud before writing any page. Every entry's
`documents:` globs must point at code that exists.

### Phase 2 — The user track

- `getting-started.md` (tutorial): Node 24.13.0 or later, clone, `pnpm install`, `pnpm cli:link`,
  `saasaloy init` into a directory outside the repo, `pnpm dev`, see the landing page. Then one
  `saasaloy add` to prove the registry resolves remotely. One short note that npm distribution
  arrives with #46.
- `how-to/add-a-module.md`: the `add` flow, `dependsOn` resolution, the confirm prompt, and
  `--dry-run` / `--diff` before committing to it.
- `how-to/remove-a-module.md`: manifest-driven undo, what a base file's one-time-gift status means
  for what `remove` can reach, and a cross-link to **Known limitations** for the config-patch gap.

### Phase 3 — The contributor track

`how-to/contribute-a-module.md`: one page that orients a human contributor and routes onward. The
two-tier model in a paragraph, then links to `CONTRIBUTING.md` for the `.dev/playground` and the
dependency workflow, to `.agents/skills/create-module/` and `create-provider/` as the authoring
path, and to `architecture.md` for the model itself. It duplicates none of them.

### Phase 4 — Explanation and reference

- `architecture.md`: the dispatcher in `packages/cli/src/index.ts`, the four commands, the applier,
  the registry source, the config-patch engine, and the manifest plus lockfile pair. Data flow for
  one `saasaloy add`, end to end. Links the ADRs named above.
- `reference.md`, the declared surface only:
  - Commands `init`, `add`, `remove`, `list`.
  - Flags: `--force` and `--no-install` on `init`; `--dry-run`, `--diff`, `--yes` / `-y` and
    `--force` on `add` and `remove`. `list` takes **no flags** and one optional
    `[owner/repo[@ref]]` positional.
  - The `SAASALOY_REGISTRY_DIR` environment variable.
  - The module coordinate grammar, as a grammar block.
  - A two-row email provider table: `email-console` versus `email-cloudflare`, with the paid-plan
    and sending-domain requirement.
  - Config keys by link to the four JSON schemas.
  - **Known limitations**: `remove` does not reverse config patches (#36); `add` is not honest
    about partial failure (#49). Each linked to its issue.

  Verify every flag against `packages/cli/src/commands/` before it ships.

### Phase 5 — The runbook

`runbooks/bad-descriptor-on-main.md`: how a bad descriptor surfaces downstream, how to confirm it
from a clean checkout, how to revert on `main`, and why a consumer whose `saasaloy-lock.json` pins
an earlier SHA is unaffected. Verify the revert path against the resolution code rather than
assuming it.

### Phase 6 — Wire it up

- `README.md` gains a link into `docs/wiki/`.
- #46 gains a checkbox: update `getting-started.md`'s install section on publish.
- Every page carries wikikit's provenance stamp. The repo merge-commits rather than squashing
  (`7c3e07e` has two parents), so the branch SHA stays reachable and the stamp is precise.
- Re-read the set as a stranger. Any page that answers a question the reader did not ask gets cut.

## Open questions

The grill closed every one. What remains is two accepted risks and one to-do.

- **Accepted risk: nothing verifies the docs.** No link check, no command check, and no CI to hang
  one on. A page can print a command that stopped working and nothing will notice until someone
  runs `wikikit audit` by hand. Accepted deliberately in the grill over adding the repo's first
  automated gate inside a docs issue.
- **Accepted risk: the limitations block is off the reader's path.** Putting #36 and #49 in one
  `reference.md` section keeps them easy to maintain, at the cost of sitting away from
  `remove-a-module.md`, where a reader meets the gap. The cross-link is the mitigation, and a
  reader who skips it will assume `remove` undoes `add`.
- **To-do, owner-filed: the Node manifest mismatch.** `packages/cli` declares `>=24.13.0` while the
  root and the base template declare `>=24.0.0`, and nothing found requires `.13`. Needs its own
  `chore(repo):` issue. Not filed by this grill, and #77 does not wait on it.

## Non-goals

- **The GitHub wiki tab.** In-repo Markdown only. `wikikit publish` is a separate, explicit ask.
- **New glossary terms or ADRs.** Those belong to `CONTEXT.md` and `docs/adr/`, and a term missing
  from the glossary gets routed, not invented on a docs page.
- **A generated API reference.** No TypeDoc, no hand-maintained symbol tables.
- **Rewriting `CONTRIBUTING.md`, `README.md` beyond one link, `AGENTS.md`, `CLAUDE.md`, or any
  module skill.**
- **Documentation for the generated project.** The scaffolded repo's own `README` and `AGENTS.md`
  are the template's concern, not this set's.
- **A docs site.** No MkDocs, Docusaurus, or Starlight in a repo that runs none.
- **Publishing the CLI.** That is #46, and this plan only works around its absence.
- **Fixing the gaps the docs report.** #36, #39, #46 and #49 are named and linked, never closed
  here.
