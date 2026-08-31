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
local applier (`buildPlan`/`executePlan`) — neither is a stub any more. Every descriptor field is
now honored at `add` time; author the full descriptor and it all applies.

| Field | Applied at `add` time? |
| --- | --- |
| `files[]` | ✅ copied to their `@alias` targets |
| `agent.skills[]` | ✅ files land in `.agents/skills/saasaloy-<name>/`, with a `.claude/skills/` symlink (both recorded in the manifest) (ADR 0015) |
| `dependencies[]` | ✅ merged into the root `package.json`'s `dependencies` (you run `pnpm install`) |
| `devDependencies[]` | ✅ merged into the root `package.json`'s `devDependencies` (`@types/*`, build tooling) |
| `dependsOn[]` | ✅ resolved recursively + topologically sorted |
| `conflictsWith[]` | ✅ `add` refuses, before writing anything, when a module you name is already installed |
| `requiresOneOf[]` | ✅ `add` refuses when none of the modules you name is installed or in the same graph; on a terminal it prompts for one instead |
| `envVars` | ✅ reported to the user (never written to files) |
| `scaffolds[]` | ✅ births the workspace (root-relative files + registers its aliases into `saasaloy.json`) (ADR 0013) |
| `patches` | ✅ applied by the config-patch engine — read file → codemod → write, idempotent (ADR 0019) |

Consequence to know while authoring: a **capability** whose files all live in `scaffolds[]` (like
`api`) lands its whole workspace on disk from `add`, registers its aliases, and applies any
`patches` (e.g. `database`'s D1 binding into `apps/api/wrangler.jsonc`) — all in one run. Exercise
such a module through the `.dev/` playground to see it end to end. A patch mutates a file another
module owns, so patched files are **not** manifest-tracked as clean copies. `remove` reverses one
patch kind, `chained-route`, and drops the other four with a warning telling the user to
hand-revert them; generalising the inverse is #36. Everything else the applier does is fully
described by the descriptor.

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
  Carries `scaffolds` (new workspaces) and usually the structural `patches`. A capability built
  on a vendor SDK (`database` → `drizzle-orm`, `auth` → `better-auth`) **encapsulates it**: the
  scaffolded workspace owns the npm dep and exports project-facing utilities; no other workspace
  imports the vendor package directly (ADR 0020).
- **Feature module** — `waitlist`, `billing`, `teams`, … Extends existing capabilities *purely
  by dropping files into their conventions*, and declares `dependsOn` for the capabilities it
  needs. A feature rarely needs `patches` at all.

Rule of thumb: if you're creating a whole new `apps/*` or `packages/*`, it's a capability. If
you're adding a route + a table + some UI to things that already exist, it's a feature.

> **Authoring a provider?** A module that supplies one implementation of an existing capability's
> provider interface (`email-cloudflare`, `email-console`, a future `email-resend`) is a feature
> with a much narrower shape — one file, one registration patch, the vendor dep patched into the
> capability's workspace. Use [`create-provider`](../create-provider/SKILL.md) for those; it
> assumes everything on this page and adds only the differences.

## Step 2 — Write `registry-item.json`

Start from this annotated feature example (waitlist) and trim/extend per tier:

```jsonc
// modules/waitlist/registry-item.json
{
  "name": "waitlist",
  "type": "saasaloy:feature",                 // or "saasaloy:capability"
  "dependsOn": ["api", "database"],           // capabilities this needs; resolved recursively
  "dependencies": ["zod@4.0.5"],              // consumer `dependencies` — exact-pinned name@version
  "devDependencies": ["@types/node@26.1.1"],  // optional — consumer `devDependencies` (@types/*, tooling)
  "files": [
    { "path": "files/api/routes/waitlist.ts",          "target": "@api/routes/waitlist.ts" },
    { "path": "files/db/schema/waitlist.ts",           "target": "@db/schema/waitlist.ts" },
    { "path": "files/web/components/WaitlistForm.tsx",  "target": "@web/components/WaitlistForm.tsx" }
  ],
  "envVars": {},                              // env keys the module needs (documented for the user)
  "patches": [                                // a route file is dropped, but registered by patch
    {
      "file": "apps/api/src/index.ts",        // project-relative POSIX path, no @alias
      "kind": "chained-route",
      "exportName": "default",                // the exported chain — followed to `const app = …`
      "path": "/waitlist",                    // also the match key for the inverse
      "call": "waitlist",
      "import": { "name": "waitlist", "from": "./routes/waitlist" }
    }
  ],
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
- **`conflictsWith`** — modules this one refuses to sit beside, named the same way `dependsOn`
  names them. Reach for it when two modules are genuinely mutually exclusive: two drivers behind
  one capability's interface, two mailers a project can only pick one of. `add` refuses with a
  message naming both modules, before it writes anything, and `--force` does not bypass it.
  **Declare it on one side only.** The field is recorded into `saasaloy-lock.json`, so the refusal
  fires in either install order, and declaring it on both sides buys nothing. `add` never
  auto-resolves a conflict: it refuses and tells the user which `saasaloy remove` clears it.
- **`requiresOneOf`** — a list of modules, exactly one of which has to be present. Use it when this
  module is incomplete on its own and several modules could complete it: `database` scaffolds
  `packages/db` and declares the `./client` export, but the file behind that export ships in
  `database-d1` or `database-postgres`. `add` counts an option as present when it is already
  installed or arrives in the same resolved graph, so naming a driver directly satisfies the core
  with no prompt. When nothing satisfies it, an interactive `add` offers the list as a picker and a
  non-interactive one refuses and names the options. It takes **at least two** names — one hard
  prerequisite is `dependsOn`. Pair it with `conflictsWith` on the options themselves: this field
  stops a project at zero, `conflictsWith` stops it at two.
- **`dependencies` / `devDependencies`** — npm packages (distinct from `dependsOn`, which is
  *inter-module*), merged into the consumer's `dependencies` / `devDependencies` respectively —
  put `@types/*` and build tooling in `devDependencies[]`. **Both are exact-pinned `name@version`**
  (`zod@4.0.5`); the schema rejects bare names and ranges. Author a version by hand or leave the
  entry out and run `pnpm deps:update` to fill/refresh it (it also enforces the 3-day cooldown). A
  name declared in both buckets lands in `dependencies` only. **One source of truth per workspace:**
  a **capability** owns the `package.json` it scaffolds, so it declares its deps *there* and leaves
  the descriptor buckets **empty**; a **feature** owns no `package.json`, so it lists npm deps here
  and the applier merges them into the target workspace's `package.json`. Never declare the same dep
  in both places. A feature extending a capability's vendor SDK (e.g. `billing` adding
  `@better-auth/stripe`) targets the capability's workspace, so the plugin dep merges into *that*
  workspace's `package.json` — vendor packages stay inside the capability that owns them (ADR 0020).
- **`files[]`** — each entry maps a source `path` (under this module's `files/`) to a `target`
  written with a consumer **alias**, resolved from the consumer's `saasaloy.json`:
  `@web`→`apps/web/src`, `@api`→`apps/api/src`, `@admin`→`apps/admin/src`, `@db`→`packages/db/src`,
  `@ui`→`packages/ui/src`. Prefer alias targets that land in a convention folder (Step 3).
- **`envVars`** — keys the module needs (e.g. `RESEND_API_KEY`); surfaced to the user, never
  invented secrets committed to files.
- **`patches`** — reserve for genuinely structural edits (see Step 3). Empty is the goal. Each op
  names its own target `file` and a codemod `kind`; the engine defines the payload per kind:

  | `kind` | What it does | Payload |
  | --- | --- | --- |
  | `wrangler-binding` | upserts a binding into a `wrangler.jsonc` array | `bindingType`, `entry`, `matchOn` |
  | `package-json-dependency` | upserts one dependency into a `package.json` section | `section`, `name`, `range` |
  | `package-json-script` | upserts one entry into a `package.json` `scripts` map | `name`, `value` |
  | `plugin-array` | appends a call into a TS module's plugin array | `exportName`, `arrayProp`, `call`, `import` |
  | `chained-route` | appends `.route(path, handler)` to a TS module's exported call chain | `exportName`, `path`, `call`, `import` |

  Every kind is idempotent and never clobbers. Each one has a match key it checks first (the
  binding name, the dependency name, the script name, the callee, the route path), and an entry
  already there is left exactly as the user last edited it, so a re-`add` is a byte-for-byte
  no-op. `chained-route` is the only kind `remove` reverses, taking the link back out, and the
  named import with it when the file no longer references the binding anywhere else; the other
  four are dropped from the manifest with a warning until #36 generalises the inverse.

  The match key locates an edit; it does not prove the edit is still yours. `chained-route`
  checks identity on both sides, and **skips with a warning rather than guessing**: `add`
  refuses when the entry file already binds your import's local name to a different module,
  because wiring the route would point it at the wrong handler, and `remove` leaves the link
  alone when the recorded path now routes to something other than your `call`. Both cases mean
  a user owns that line. Design the module for the skip: `add` reports the file and the reason,
  and records nothing, so the user wires it by hand.
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

  A scaffolded `package.json` **must declare a `clean` script**, or `pnpm clean` in the consumer
  project silently skips the workspace and leaves its build output behind. Use `rimraf` (exact-pinned
  in that workspace's `devDependencies` like any other dep), never `rm -rf` — it doesn't exist on
  Windows. Pass `-g` when an argument is a glob. Delete only what the workspace *generates* — never
  committed artifacts such as Drizzle migrations — and leave `node_modules` / `.turbo` alone; the
  template's root `clean` removes those repo-wide after Turborepo finishes.

  ```jsonc
  "scripts": { "clean": "rimraf -g dist .wrangler \"*.tsbuildinfo\"" },
  "devDependencies": { "rimraf": "6.1.3" }
  ```

## Step 3 — Lay out `files/` along the conventions

Convention-based extension points are what make granular modules safe: **no module AST-patches
another module's internals**, so there's no drift-seam. A feature adds behavior by dropping a
file where a capability already auto-discovers it.

- **`api`** scaffolds `apps/api` with a **statically chained route table** in `src/index.ts`. Add a
  route in two parts: drop `files/api/routes/<feature>.ts` → `@api/routes/<feature>.ts`, then
  register it with a `chained-route` patch (below). The drop alone mounts nothing.
- **`database`** scaffolds `packages/db` with a **schema barrel** that auto-re-exports everything
  in `schema/`. Add a table = drop `files/db/schema/<feature>.ts` → `@db/schema/<feature>.ts`.
- **Landing-facing UI** drops into `apps/web` (`@web/...`); shared components into `packages/ui`
  (`@ui/...`).

Only when a change is genuinely structural — and no convention exists for it — use a **small,
tested AST patch** in `patches`: a D1 binding in `wrangler.jsonc`, a plugin inserted into Better
Auth's array, a `db:generate` command in the app's `package.json`. That's the 10%, not the spine.
If you reach for a patch to edit another *module's* file, stop — add or use a convention instead.

**Registering a route is the exception to that rule, and it is not optional.** `apps/api` used to
glob `routes/*.ts`, so a drop was enough; it no longer does. `src/index.ts` now names every route
in one `.route()` chain, because `hc<AppType>` reads its paths, inputs and response shapes off
`typeof app`, and a glob gives that type nothing to carry. So a route module drops its handler
file **and** adds one `chained-route` patch. The drop on its own leaves a file nothing imports.
ADR 0028 records the trade.

The patch kind is the reversible one, which is what makes this affordable: `saasaloy remove` takes
the link and its import back out, and the entry file comes back byte-identical. Two rules for the
descriptor:

- **`exportName` names the export in the *target* file, not in your route file.** Use
  `"default"` for a typed route — that is `apps/api/src/index.ts`'s `export default app`, which
  the codemod follows to `const app = …` so `AppType` picks the link up. Use `"base"` only for a
  mount that must stay *out* of `AppType`, such as an opaque catch-all like `auth`'s.
- **Your route file exports its sub-app by name, as one chained expression.** `export const
  <feature> = new Hono().get(...)`, matching `import.name`. The codemod refuses to wire a link
  whose binding resolves to a default import, and a broken-up chain exports a type that has
  forgotten its own routes.

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
  convention-based drop points instead: a table into `packages/db/schema/`, a UI component
  into `apps/web`. Only genuinely structural edits (a D1 binding, a Better Auth plugin) use
  small, tested AST patches.
- **A route is the exception: drop the handler, then register it with a `chained-route`
  patch.** `apps/api/src/index.ts` names every route statically so `AppType` carries them;
  nothing globs `routes/` (ADR 0028).
- **Contribute agent context by shipping a skill folder**, not editing shared ones: an
  `agent.skills[]` folder is copied into the consumer's `.claude/skills/` by `add`. Modules
  never append to the committed `AGENTS.md`/`CLAUDE.md`.
- **Name every module skill `saasaloy-<module>`** — folder and frontmatter `name` alike — so it
  can't collide with a user's own installed skills (ADR 0014).
- Declare `dependsOn` so the applier can resolve and topologically sort prerequisites.

## Authoring checklist

- [ ] `modules/<name>/registry-item.json` present, `name` matches the directory.
- [ ] `type` is `saasaloy:capability` or `saasaloy:feature` (capabilities carry `scaffolds`).
- [ ] Every needed capability is in `dependsOn`; every npm import is exact-pinned in
      `dependencies`/`devDependencies` (`name@version`; `pnpm deps:update` fills versions).
- [ ] Each `files[]` target uses a `@alias` and lands in a convention folder where possible.
- [ ] `patches` is empty unless a change is genuinely structural (with a note on why), and each op
      uses a `kind` the engine defines.
- [ ] `conflictsWith` names any module this one is mutually exclusive with, on one side only.
- [ ] `requiresOneOf` names the modules that complete this one, if it ships an extension point some
      other module has to fill (two names minimum).
- [ ] `envVars` lists any required keys; no secrets baked into files.
- [ ] `agent.skills[]` points at a `skills/saasaloy-<name>/SKILL.md` runbook, with matching
      `saasaloy-<name>` frontmatter `name` (prefixed to avoid skill-name collisions).
- [ ] Files are self-contained wiring (clean copy-in updates; no sentinel comments).
