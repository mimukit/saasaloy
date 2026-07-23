---
name: create-module
description: Scaffold a new Saasaloy module (registry-item.json + files + Claude skill) under modules/, following the repo's two-tier, convention-based design. Use whenever adding a capability or feature to the Saasaloy registry — e.g. "add a waitlist/billing/teams module", "create a new api/database/auth capability", "author a module descriptor", or any work under modules/ — even if the user doesn't say the word "module".
---

# create-module

Guide for authoring a new module in the Saasaloy registry (`modules/<name>/`). A module is
a shadcn-shaped **descriptor** plus the **files it drops** into a consumer project. This skill
covers writing that descriptor and laying out its files so they honor the conventions that let
granular modules compose without stepping on each other.

**Ground truth:** `docs/plans/plan-saasaloy-build-spec-2026-07-21.md` — §2.7 (modules), §2.13 (agent context),
§3.2 (manifest), §3.3 (descriptor). Read those sections if a decision here is unclear.

**Applier coverage today:** `saasaloy list` queries the registry and `saasaloy add` runs the
local applier (`buildPlan`/`executePlan`) — neither is a stub any more. But the applier only
honors part of the descriptor so far; the rest is recognized and *deferred* (reported, not
applied). Author the full descriptor regardless — the deferred fields are read and warned about
today, and will apply the moment their engines land, with no descriptor changes needed.

| Field | Applied at `add` time? |
| --- | --- |
| `files[]` | ✅ copied to their `@alias` targets |
| `agent.skills[]` | ✅ copied into `.claude/skills/saasaloy-<name>/` (recorded in the manifest) |
| `dependencies[]` | ✅ merged into the root `package.json` (you run `pnpm install`) |
| `dependsOn[]` | ✅ resolved recursively + topologically sorted |
| `envVars` | ✅ reported to the user (never written to files) |
| `scaffolds[]` | ⏳ deferred — capability scaffolding engine (issues #8/#9) |
| `patches` | ⏳ deferred — config patch engine (issue #7) |

Consequence to know while authoring: a **capability** whose files all live in `scaffolds[]` (like
`api`) has *nothing* land on disk from `add` today except its skill — its workspace files wait on
the scaffold engine. Exercise such a module through the `.dev/` playground and expect the deferred
warning. Everything the applier does at `add` time must still be fully described by the descriptor.

## Shape of a module

```
modules/<name>/
  registry-item.json     # name, type, dependsOn[], dependencies[], files[], envVars{}, patches, scaffolds[], agent{}
  files/                 # template files, copied to alias (or scaffold-root) targets in the consumer project
  skills/saasaloy-<name>/  # Claude skill folder (SKILL.md), copied verbatim into .claude/skills/saasaloy-<name>/
```

## Step 1 — Pick the tier

Modules are **granular** (no monolithic `add app`) and come in two tiers. Decide which you're
authoring first; it drives everything else.

- **Capability module** — `api`, `database`, `email`, `auth`, `admin`. Scaffolds a new app or
  package **and establishes a convention-based extension point** other modules drop into.
  Carries `scaffolds` (new workspaces) and usually the structural `patches`.
- **Feature module** — `waitlist`, `billing`, `teams`, … Extends existing capabilities *purely
  by dropping files into their conventions*, and declares `dependsOn` for the capabilities it
  needs. A feature rarely needs `patches` at all.

Rule of thumb: if you're creating a whole new `apps/*` or `packages/*`, it's a capability. If
you're adding a route + a table + some UI to things that already exist, it's a feature.

## Step 2 — Write `registry-item.json`

Start from this annotated feature example (waitlist) and trim/extend per tier:

```jsonc
// modules/waitlist/registry-item.json
{
  "name": "waitlist",
  "type": "saasaloy:feature",                 // or "saasaloy:capability"
  "dependsOn": ["api", "database"],           // capabilities this needs; resolved recursively
  "dependencies": ["zod"],                    // npm deps added to the consumer
  "files": [
    { "path": "files/api/routes/waitlist.ts",          "target": "@api/routes/waitlist.ts" },
    { "path": "files/db/schema/waitlist.ts",           "target": "@db/schema/waitlist.ts" },
    { "path": "files/web/components/WaitlistForm.tsx",  "target": "@web/components/WaitlistForm.tsx" }
  ],
  "envVars": {},                              // env keys the module needs (documented for the user)
  "patches": {},                              // waitlist needs none — pure file-drop via conventions
  "agent": {                                  // AI context this module contributes (see Step 4)
    "skills": ["skills/saasaloy-waitlist"]    //   skill folder(s) copied into .claude/skills/ by `add`
  }
}
```

Field notes:

- **`name`** — matches the directory (`modules/<name>/`).
- **`type`** — `saasaloy:capability` or `saasaloy:feature`.
- **`dependsOn`** — capabilities that must exist first. The applier resolves these recursively,
  topologically sorts them, and confirms with the user before installing (`waitlist` → `api`,
  `database`). Declare every hard prerequisite; mark genuinely optional ones as such in your
  skill/README rather than in `dependsOn`.
- **`dependencies`** — npm packages (distinct from `dependsOn`, which is *inter-module*). **One
  source of truth per workspace:** a **capability** owns the `package.json` it scaffolds, so it
  declares its deps *there* and leaves descriptor `dependencies[]` **empty**; a **feature** owns no
  `package.json`, so it lists npm deps in `dependencies[]` and the applier merges them into the
  target workspace's `package.json`. Never declare the same dep in both places.
- **`files[]`** — each entry maps a source `path` (under this module's `files/`) to a `target`
  written with a consumer **alias**, resolved from the consumer's `saasaloy.json`:
  `@web`→`apps/web/src`, `@api`→`apps/api/src`, `@admin`→`apps/admin/src`, `@db`→`packages/db/src`,
  `@ui`→`packages/ui/src`. Prefer alias targets that land in a convention folder (Step 3).
- **`envVars`** — keys the module needs (e.g. `RESEND_API_KEY`); surfaced to the user, never
  invented secrets committed to files.
- **`patches`** — reserve for genuinely structural edits (see Step 3). Empty is the goal.
- **`agent.skills[]`** — skill folder(s) under this module (`skills/saasaloy-<name>`) copied into
  the consumer's `.claude/skills/saasaloy-<name>/` by `add` (see Step 4). Module skills are
  **always `saasaloy-`-prefixed** so they can't collide with the user's own installed skills.
- **Capability modules additionally carry `scaffolds`** — the new workspace(s) they create
  (e.g. `api` scaffolds `apps/api`; `database` scaffolds `packages/db`). Each entry describes a
  full workspace with **workspace-root-relative** targets (not `@alias`-prefixed — the alias root
  doesn't exist yet) and **declares the alias it registers** into the consumer's `saasaloy.json`:

  ```jsonc
  "scaffolds": [{
    "workspace": "apps/api",
    "aliases": { "@api": "apps/api/src" },   // applier writes this into saasaloy.json
    "files": [
      { "path": "files/package.json",        "target": "package.json"        },
      { "path": "files/wrangler.jsonc",       "target": "wrangler.jsonc"       },
      { "path": "files/src/index.ts",         "target": "src/index.ts"         },
      { "path": "files/src/routes/health.ts", "target": "src/routes/health.ts" }
    ]
  }]
  ```

  Split of concern: **`scaffolds[]` births a whole workspace** (root-relative paths, incl. its
  `package.json` and config) — **`files[]` drops into an existing convention** (alias-relative,
  what *features* use). A capability's own initial files (the entry, its first route) ship **in the
  scaffold**, so a capability's `files[]` is typically empty.

## Step 3 — Lay out `files/` along the conventions

Convention-based extension points are what make granular modules safe: **no module AST-patches
another module's internals**, so there's no drift-seam. A feature adds behavior by dropping a
file where a capability already auto-discovers it.

- **`api`** scaffolds `apps/api` with **file-based route registration** — a `routes/` folder the
  Hono entry auto-globs. Add a route = drop `files/api/routes/<feature>.ts` → `@api/routes/<feature>.ts`.
- **`database`** scaffolds `packages/db` with a **schema barrel** that auto-re-exports everything
  in `schema/`. Add a table = drop `files/db/schema/<feature>.ts` → `@db/schema/<feature>.ts`.
- **Landing-facing UI** drops into `apps/web` (`@web/...`); shared components into `packages/ui`
  (`@ui/...`).

Only when a change is genuinely structural — and no convention exists for it — use a **small,
tested AST patch** in `patches`: a D1 binding in `wrangler.jsonc`, a plugin inserted into Better
Auth's array. That's the 10%, not the spine. If you reach for a patch to edit another *module's*
file, stop — add or use a convention instead.

## Step 4 — Contribute agent context

A module carries the AI guidance for the capability it adds the same convention-based way it adds
routes and schema: **by shipping a self-contained skill folder, never by editing a shared agent
file.** Author `modules/<name>/skills/saasaloy-<name>/SKILL.md` and list it in `agent.skills[]`. At
`add` time the applier **copies** that folder verbatim into the consumer's
`.claude/skills/saasaloy-<name>/` and records it in `.saasaloy/manifest.json`, so `remove` deletes
exactly what was copied.

**Skill names are always `saasaloy-`-prefixed.** A module's skill folder, and the `name:` in its
`SKILL.md` frontmatter, both take the form `saasaloy-<module>` (the `api` module ships
`skills/saasaloy-api/` with `name: saasaloy-api`). The prefix namespaces every module skill so it
lands in the consumer's `.claude/skills/` without colliding with a user's own installed skills — a
generated project may have dozens of module skills alongside the user's, and a bare `api` or
`billing` is exactly the kind of name a user might already have. Keep the folder name and the
frontmatter `name` identical and prefixed. (See ADR 0014.)

Module guidance is therefore **on-demand Claude skills** — the agent loads a module's runbook only
when working on that module, keeping the always-in-context `AGENTS.md` lean. There is no `AGENTS.md`
concatenation and no regeneration step: the consumer's `AGENTS.md`/`CLAUDE.md` are committed static
files that no module touches. (This reversed an earlier canonical-`.agents/` + regeneration
pipeline; see build-spec §2.13.)

> Scope note: this applies to the projects Saasaloy **generates**. This CLI/registry repo maintains
> its own `.agents/` skills and its `AGENTS.md`/`CLAUDE.md` directly — to exercise a module
> end-to-end, use the git-ignored `.dev/` playground (`pnpm play:*`).

## Step 5 — Sanity-check against the update story

Every file a module writes becomes **manifest-tracked** in the consumer's `.saasaloy/manifest.json`
(path + content hash), with **no in-file markers**. On update (`saasaloy add <mod> --diff`) the
tool hashes each managed file: an untouched file is a clean overwrite; a hand-edited (drifted)
file routes to the AI-merge path instead of being clobbered. Author with this in mind:

- Keep dropped files **self-contained wiring** the user won't need to hand-edit — that's exactly
  what makes copy-in updates land cleanly.
- Don't emit sentinel comments (`// saasaloy:managed`) — tracking is the manifest's job.
- A schema change implies a migration downstream; note it in your module's skill.

## Conventions to honor

- **Feature modules never AST-patch another module's internals.** Extend via the
  convention-based drop points instead: a route file into `apps/api/routes/`, a table into
  `packages/db/schema/`, a UI component into `apps/web`. Only genuinely structural edits
  (a D1 binding, a Better Auth plugin) use small, tested AST patches.
- **Contribute agent context by shipping a skill folder**, not editing shared ones: an
  `agent.skills[]` folder is copied into the consumer's `.claude/skills/` by `add`. Modules
  never append to the committed `AGENTS.md`/`CLAUDE.md`.
- **Name every module skill `saasaloy-<module>`** — folder and frontmatter `name` alike — so it
  can't collide with a user's own installed skills (ADR 0014).
- Declare `dependsOn` so the applier can resolve and topologically sort prerequisites.

## Authoring checklist

- [ ] `modules/<name>/registry-item.json` present, `name` matches the directory.
- [ ] `type` is `saasaloy:capability` or `saasaloy:feature` (capabilities carry `scaffolds`).
- [ ] Every needed capability is in `dependsOn`; every npm import is in `dependencies`.
- [ ] Each `files[]` target uses a `@alias` and lands in a convention folder where possible.
- [ ] `patches` is empty unless a change is genuinely structural (with a note on why).
- [ ] `envVars` lists any required keys; no secrets baked into files.
- [ ] `agent.skills[]` points at a `skills/saasaloy-<name>/SKILL.md` runbook, with matching
      `saasaloy-<name>` frontmatter `name` (prefixed to avoid skill-name collisions).
- [ ] Files are self-contained wiring (clean copy-in updates; no sentinel comments).
