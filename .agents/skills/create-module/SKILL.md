---
name: create-module
description: Scaffold a new Saasaloy module (registry-item.json + files + Claude skill) under modules/, following the repo's two-tier, convention-based design. Use whenever adding a capability or feature to the Saasaloy registry — e.g. "add a waitlist/subscription/teams module", "create a new api/database/auth capability", "author a module descriptor", or any work under modules/ — even if the user doesn't say the word "module".
---

# create-module

Guide for authoring a new module in the Saasaloy registry (`modules/<name>/`). A module is
a shadcn-shaped **descriptor** plus the **files it drops** into a consumer project. This skill
covers writing that descriptor and laying out its files so they honor the conventions that let
granular modules compose without stepping on each other.

**Ground truth:** `docs/plans/0001-plan-saasaloy-build-spec-2026-07-21.md` — §2.7 (modules), §2.13 (agent context),
§3.2 (manifest), §3.3 (descriptor). Read those sections if a decision here is unclear.

**Applier coverage today:** `saasaloy list` queries the registry and `saasaloy add` runs the
local applier (`buildPlan`/`executePlan`) — neither is a stub any more. Every descriptor field is
now honored at `add` time; author the full descriptor and it all applies.

| Field | Applied at `add` time? |
| --- | --- |
| `files[]` | ✅ copied to their `@alias` targets |
| `files[].when`, `patches[].when`, `entries[].when` | ✅ the entry ships only while its condition holds: `testing: true` needs a testing mode other than `off`, `installed` needs every named module; a tracked entry stays managed in every mode (also honored on a scaffold's `files[]`) (ADR 0054) |
| `files[].seed` | ✅ written once and recorded as a seed; `update` never overwrites or merges it and restores it when missing, `remove` keeps it once changed (also honored on a scaffold's `files[]`) (ADR 0060) |
| `files[].untested` | ✅ read by the test guards, which print the reason instead of failing |
| `enablesTesting` | ✅ `add` turns an `off` project to `tests-after` once the apply lands, then backfills (ADR 0054) |
| `agent.skills[]` | ✅ files land in `.agents/skills/saasaloy-<name>/`, with a `.claude/skills/` symlink (both recorded in the manifest) (ADR 0015) |
| `dependencies[]` | ✅ merged into the root `package.json`'s `dependencies` (you run `pnpm install`) |
| `devDependencies[]` | ✅ merged into the root `package.json`'s `devDependencies` (`@types/*`, build tooling) |
| `dependsOn[]` | ✅ resolved recursively + topologically sorted |
| `conflictsWith[]` | ✅ `add` refuses, before writing anything, when a module you name is already installed |
| `requiresOneOf[]` | ✅ `add` refuses when none of the modules you name is installed or in the same graph; on a terminal it prompts for one instead |
| `envVars` | ✅ reported to the user (never written to files) |
| `scaffolds[]` | ✅ births the workspace (root-relative files + registers its aliases into `saasaloy.json`) (ADR 0013) |
| `patches` | ✅ applied by the render as an in-memory transform of the target file, idempotent (ADR 0019) |
| `tables` | ✅ each table is written as a `<name>.generated.ts` file, in full, on every run (plan 0116) |
| `entries` | ✅ each row is written into the generated file of its table, sorted by `order` and then by module name |

Consequence to know while authoring: a **capability** whose files all live in `scaffolds[]` (like `api`) lands its whole workspace on disk from `add`, registers its aliases, and applies any `patches` (e.g. `kv-cloudflare`'s KV binding into `apps/api/wrangler.jsonc`) — all in one run. Exercise such a module through the `.dev/` playground to see it end to end.

A `remove` is a render without the module. The CLI renders the project from the modules that stay, so a file, a patch or a table row of the removed module is not in the result, and the merge takes it out of the project. No patch kind has an inverse of its own, and the old "remove reverses the patch" rule no longer applies. Everything else the applier does is fully described by the descriptor.

## Shape of a module

```
modules/<name>/
  registry-item.json     # name, type, description, stage, needs[], requires{}, dependsOn[], dependencies[], files[], envVars{}, patches, tables[], entries[], scaffolds[], agent{}
  files/                 # template files, copied to alias (or scaffold-root) targets in the consumer project
  skills/saasaloy-<name>/  # Claude skill folder (SKILL.md), copied verbatim into .claude/skills/saasaloy-<name>/
```

`saasaloy new module <name>` writes that skeleton (Step 2). Do not hand-write it: the CLI
and this skill are one scaffolder, so a change to the shape lands in the command and both
paths get it. Everything after the skeleton — the tier, the conventions, the vertical
slice — is the judgment this skill carries, and the command has none of it.

## Step 1 — Pick the tier

Modules are **granular** (no monolithic `add app`) and come in two tiers. Decide which you're
authoring first; it drives everything else.

- **Capability module** — `api`, `database`, `email`, `auth`, `admin`. Scaffolds a new app or
  package **and establishes a convention-based extension point** other modules drop into.
  Carries `scaffolds` (new workspaces) and usually the structural `patches`. A capability built
  on a vendor SDK (`database` → `drizzle-orm`, `auth` → `better-auth`) **encapsulates it**: the
  scaffolded workspace owns the npm dep and exports project-facing utilities; no other workspace
  imports the vendor package directly (ADR 0020).
- **Feature module** — `waitlist`, `subscription`, `teams`, … Extends existing capabilities *purely
  by dropping files into their conventions*, and declares `dependsOn` for the capabilities it
  needs. A feature rarely needs `patches` at all.

Rule of thumb: if you're creating a whole new `apps/*` or `packages/*`, it's a capability. If
you're adding a route + a table + some UI to things that already exist, it's a feature.

> **Authoring a provider?** A module that supplies one implementation of an existing capability's
> provider interface (`email-cloudflare`, `email-console`, a future `email-resend`) is a feature
> with a much narrower shape — one file, one table row, the vendor dep patched into the
> capability's workspace. Use [`create-provider`](../create-provider/SKILL.md) for those; it
> assumes everything on this page and adds only the differences.

## Step 2 — Scaffold the skeleton, then fill in `registry-item.json`

Run the CLI's own scaffold from the repo root. It takes the tier you settled in Step 1, so
there is nothing to type twice:

```sh
saasaloy new module subscription --type saasaloy:feature --depends-on api,database
```

It writes `modules/subscription/registry-item.json` (schema-valid, `agent.skills[]` already
pointing at the skill folder, and a `TODO` `description` with `stage: "mvp"` and `needs: []`
for you to correct), an empty `modules/subscription/files/`, and a
`modules/subscription/skills/saasaloy-subscription/SKILL.md` stub with the frontmatter filled in and
`TODO`s for the prose. Then it runs the `doctor` checks over what it wrote, so a fresh
module starts green. Drop `--type` / `--depends-on` to be prompted for them instead, and
run it in this repo — it refuses inside a generated project, where a `modules/` folder
means nothing.

The scaffold gives you the skeleton and stops. Everything below is what you fill in.
Use this annotated feature example (waitlist) as the field reference:

```jsonc
// modules/waitlist/registry-item.json
{
  "name": "waitlist",
  "type": "saasaloy:feature",                 // or "saasaloy:capability"
  "description": "A waitlist form on the landing page, with its API route and table, to collect early sign-ups.",
  "stage": "validate",                        // validate | mvp | teams | money | scale
  "needs": [],                                // cloudflare-paid | stripe | domain | vendor-account
  "requires": { "saasaloy": ">=0.10.0" },     // semver range the consumer's CLI must satisfy; >=0.10.0 for `entries`
  "dependsOn": ["api", "database"],           // capabilities this needs; resolved recursively
  "dependencies": ["zod@4.0.5"],              // consumer `dependencies` — exact-pinned name@version
  "devDependencies": ["@types/node@26.1.1"],  // optional — consumer `devDependencies` (@types/*, tooling)
  "files": [
    { "path": "files/api/routes/waitlist.ts",          "target": "@api/routes/waitlist.ts" },
    { "path": "files/db/schema/waitlist.ts",           "target": "@db/schema/waitlist.ts" },
    { "path": "files/ui/blocks/waitlist.tsx",          "target": "@ui/blocks/waitlist.tsx" }
  ],
  "envVars": {},                              // env keys the module needs (documented for the user)
  "entries": [                                // a route file is dropped, but registered by a table row
    {
      "table": "api.routes",                  // the `id` of a table another module declares
      "path": "/waitlist",                    // the mount path, unique in the table
      "call": "waitlist",                     // the router the route file exports by name
      "import": { "name": "waitlist", "from": "./routes/waitlist" }  // relative to the generated file
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
- **`description`** — one line on what the module gives a project. `saasaloy list --json` prints it, and an agent picks modules from it, so name the thing the user gets, not the files. The schema keeps it optional, so a project still reads an older descriptor, but `saasaloy doctor` in registry mode fails a descriptor without it.
- **`stage`** — the product stage that usually earns the module: `validate` (landing page and waitlist), `mvp` (sign-in, admin, email), `teams` (organizations, tenancy, roles), `money` (subscription and payments) or `scale` (jobs, caching, files, rate limits, API access). A supporting module the README's stage table does not name takes the earliest stage of the modules that need it, and a provider or a driver takes its capability's stage. The scaffold writes `mvp`; change it.
- **`needs`** — what the module needs outside the repo before it works in production: `cloudflare-paid` (a paid Workers plan), `stripe` (a Stripe account), `domain` (a domain onboarded by hand) or `vendor-account` (an account with any other vendor). Write `[]` when the free tier and no account will do, which is what the scaffold writes.
- **`requires`** — an optional `{ "saasaloy": "<semver range>" }` naming the CLI versions
  this descriptor works on. A consumer whose CLI falls outside the range gets one fatal,
  actionable message before anything is written, instead of an Ajv dump about a field the
  old CLI never heard of — and instead of nothing at all when a field it does know has
  changed meaning. Any range shape works, upper bounds included (`>=0.3`, `>=0.3 <2`,
  `^1.2.0`, `1.x`), so there is no separate maximum field. The check is fatal and runs for
  transitive `dependsOn` too, so declaring a floor you have not tested against refuses
  installs that would have worked. Leave the field out unless you use something the older
  CLI cannot do; a descriptor without it installs on every version, which is the right
  default. `saasaloy new module` seeds it from the CLI that scaffolded the module, and
  `saasaloy doctor` checks the range parses — it never compares it against your own CLI,
  because your version is not the consumer's.
- **`dependsOn`** — capabilities that must exist first. The applier resolves these recursively,
  topologically sorts them, and confirms with the user before installing (`waitlist` → `api`,
  `database`). Declare every hard prerequisite; mark genuinely optional ones as such in your
  skill/README rather than in `dependsOn`. **Name the capability, never one of its drivers.**
  `api-keys-organization` depends on `api-keys`, and no feature depends on `api-keys-user` or
  `api-keys-organization` directly. The capability's `requiresOneOf` names the drivers, so the user
  picks one at install time. A feature
  that pins a driver overrides that choice silently and makes itself uninstallable beside any other
  driver. When your payload only works on one driver, say so in your skill and fix the payload; do
  not encode it in `dependsOn`.
- **`conflictsWith`** — modules this one refuses to sit beside, named the same way `dependsOn`
  names them. Reach for it when two modules are genuinely mutually exclusive: two drivers behind
  one capability's interface, two mailers a project can only pick one of. `add` refuses with a
  message naming both modules, before it writes anything, and `--force` does not bypass it.
  **Declare it on one side only.** The field is recorded into `saasaloy-lock.json`, so the refusal
  fires in either install order, and declaring it on both sides buys nothing. `add` never
  auto-resolves a conflict: it refuses and tells the user which `saasaloy remove` clears it.
- **`requiresOneOf`** — a list of modules, exactly one of which has to be present. Use it when this
  module is incomplete on its own and one or more modules could complete it: `api-keys` wires Better
  Auth's api-key plugin, but who owns a key ships in `api-keys-organization` or `api-keys-user`.
  `database` names its one driver the same way, `database-postgres`. `add` counts an option as
  present when it is already installed or arrives in the same resolved graph, so a user who runs
  `saasaloy add api-keys-user` directly satisfies the core with no prompt. That is the only legitimate way a driver name reaches
  the graph: from the user, never from another module's `dependsOn`. When nothing satisfies it, an interactive `add` offers the list as a picker and a
  non-interactive one refuses and names the options. It takes one name when the capability has one
  driver, as `database` does. Pair it with `conflictsWith` on the options themselves: this field
  stops a project at zero, `conflictsWith` stops it at two.
- **`dependencies` / `devDependencies`** — npm packages (distinct from `dependsOn`, which is
  *inter-module*), merged into the consumer's `dependencies` / `devDependencies` respectively —
  put `@types/*` and build tooling in `devDependencies[]`. **Both are exact-pinned `name@version`**
  (`zod@4.0.5`); the schema rejects bare names and ranges. Author a version by hand or leave the
  entry out and run `pnpm deps:update` to fill/refresh it. A
  name declared in both buckets lands in `dependencies` only. **One source of truth per workspace:**
  a **capability** owns the `package.json` it scaffolds, so it declares its deps *there* and leaves
  the descriptor buckets **empty**; a **feature** owns no `package.json`, so it lists npm deps here
  and the applier merges them into the target workspace's `package.json`. Never declare the same dep
  in both places. A feature extending a capability's vendor SDK (e.g. `subscription` adding
  `@better-auth/stripe`) targets the capability's workspace, so the plugin dep merges into *that*
  workspace's `package.json` — vendor packages stay inside the capability that owns them (ADR 0020).
- **`files[]`** — each entry maps a source `path` (under this module's `files/`) to a `target`
  written with a consumer **alias**, resolved from the consumer's `saasaloy.json`:
  `@web`→`apps/web/src`, `@api`→`apps/api/src`, `@admin`→`apps/admin/src`, `@db`→`packages/db/src`,
  `@ui`→`packages/ui/src`. Prefer alias targets that land in a convention folder (Step 3).
- **`when`** — an optional condition on a `files[]` entry, a scaffold `files[]` entry, a `patches` op, or an `entries` row (ADR 0054). `{ "testing": true }` ships it only when the project's testing mode is `tests-after` or `tdd`. `{ "installed": ["e2e"] }` ships it only when every named module is installed. Both keys together mean both. A target whose entries `when` drops is skipped, not refused. `when` decides the first write only: once the file is in the manifest it stays managed in every mode. A later `saasaloy testing tests-after`, `add` or `update` backfills an entry whose condition turned true, and `remove X` takes every entry whose `installed` names X. Use `testing` for every test file, and `installed` for a file that only makes sense beside another module, such as a journey spec beside `e2e`.
- **`seed`** — `true` on a `files[]` or scaffold `files[]` entry the project is meant to change: an extension point a managed file imports, such as `apps/admin/src/extend/payments.ts`. `add` and backfill write it once and the manifest records it as a seed. `update` never overwrites or merges it, and writes it again only when it is missing. `remove` deletes it while unchanged and keeps it, with a warning, once the project changed it. Keep a seed small and stable: a project that already holds it never sees a later change to its content, so a change to what it exports needs an update note. Use it in place of asking the owner to edit a managed file in place, and set `requires.saasaloy` to `>=0.9.0`, the first CLI that reads the flag (ADR 0060).
- **`untested`** — on a `files[]` entry, a one-line reason the file ships with no test beside it (`"untested": "generated types"`). The test guards print it instead of failing.
- **`enablesTesting`** — `true` on a module whose whole point is tests (`e2e`). Adding it to a project with testing `off` sets `tests-after` after the apply succeeds and backfills. It leaves `tdd` alone, and `remove` never changes the mode.
- **`envVars`** — keys the module needs (e.g. `RESEND_API_KEY`); surfaced to the user, never
  invented secrets committed to files.
- **`patches`** — reserve for genuinely structural edits (see Step 3). Empty is the goal. A registration table is never a patch: it is a generated file, declared in `tables` and filled from `entries` (below). Each op names its own target `file` and a codemod `kind`; the engine defines the payload per kind:

  | `kind` | What it does | Payload |
  | --- | --- | --- |
  | `wrangler-binding` | upserts a binding into a `wrangler.jsonc` array, top-level or nested | `bindingType`, `entry`, `matchOn` |
  | `package-json-dependency` | upserts one dependency into a `package.json` section | `section`, `name`, `range` |
  | `package-json-script` | upserts one entry into a `package.json` `scripts` map | `name`, `value` |
  | `drizzle-column` | adds one column to a Drizzle table another module ships | `exportName`, `column`, `value`, `import?` |
  | `const-property` | replaces `property: undefined` on a module-scope const object with a JSON value | `constName`, `property`, `value` |

  These five are the only kinds (`packages/cli/src/lib/patch/index.ts`). The four kinds that wrote a registration table into a file the owner keeps (`plugin-array`, `const-array`, `chained-route`, `nav-entry`) are deleted, and the schema rejects them.

  `bindingType` takes a dotted path when the binding lives under a parent object — `queues.producers`, `queues.consumers`, `triggers.crons`. The engine creates the missing parent when it applies the patch, and a render without the module has neither the parent nor the entry. A value with no dot addresses a top-level array, exactly as before. Do not invent a patch kind for a nested binding (ADR 0033).

  **A non-`fetch` Worker export registers in the handler table**, not through the deploy tooling. `apps/api/src/worker.ts` is the Worker entry, and it spreads `workerHandlers` from `./worker.generated.ts`, the `worker.handlers` table. A module that ships a `queue` consumer or a `scheduled` tick exports a function returning `{ queue?, scheduled? }` and adds the call as an `entries` row: `{ "table": "worker.handlers", "call": "cloudflareQueueHandlers", "import": { "name": "cloudflareQueueHandlers", "from": "@repo/queue/providers/cloudflare" } }`. `apps/api/src/index.ts` stays the Hono app. A module that needs both a binding and a handler carries a `wrangler-binding` patch and an `entries` row; the one-file rule constrains its runtime surface, not its descriptor.

  Every kind is idempotent and never clobbers. Each one has a match key it checks first (the binding name, the dependency name, the script name, the column, the property), and an entry already there is left exactly as the user last edited it, so a second render is a byte-for-byte no-op. The render applies each patch in memory as a transform, so only the insert side exists. A remove is a render without the module, and the merge takes the edit back out.
- **`tables`** — the registration tables this module owns. A registration table is a list that other modules add rows to, such as a capability's providers or the api route chain. The CLI writes each table into a generated file, in full, on every run. Each item takes three fields and one optional field:

  | Field | Meaning |
  | --- | --- |
  | `id` | Unique across the payload, `<owner>.<table>`, such as `email.providers`. The generated file exports the table under the camelCase of the id: `email.providers` is `emailProviders`, `api.baseRoutes` is `apiBaseRoutes`. |
  | `file` | The generated file, as a project path or an `@alias` path. Name it `<name>.generated.ts` and put it beside the file that holds the table: `@email/providers.generated.ts` beside `@email/index.ts`. Several tables may share one file (`api.routes` and `api.baseRoutes` both live in `@api/routes.generated.ts`). |
  | `shape` | What the export looks like. See the shape table below. |
  | `type` | `objects` only. A `{ name, from }` import of the element type, imported as a type, so the export reads `T[]`: `{ "name": "Service", "from": "./services.ts" }`. |

  | `shape` | The generated export | Fields a row needs |
  | --- | --- | --- |
  | `calls` | `export const emailProviders = [consoleEmail(), cloudflare()];` | `call`, `import` |
  | `objects` | `export const envServices: Service[] = [{ … }, { … }];` | `entry` |
  | `routes` | `export function apiRoutes(app)` that chains `.route(path, router)` for each row onto the Hono app it takes, so the type of each link carries to `AppType` | `path`, `call`, `import` |
  | `nav` | `export const adminNav = [{ area, group, …entry, icon }] as const;` | `area`, `group`, `entry` (with `entry.to`), `import` (the icon) |

  The generated file starts with one header line that names the CLI (`// Generated by saasaloy. Do not edit: …`). Its file class is `generated`: the CLI writes it in full on every run, `update` refuses with exit 2 when the owner edited it, and `--force` overwrites the edit. The file that holds the table imports the export and spreads it. Entries the owning module ships inline go first, then the spread, then the owner's own entries: `export const email = defineEmail({ providers: [...emailProviders] });`. Better Auth's `audience()` stays first in `packages/auth/src/auth.ts` for this reason. Tell the owner, in the module's skill, to add an entry of their own after the spread and never in the generated file. The base template declares its own tables in `packages/cli/templates/base/_saasaloy-base.json` under `tables` (`env.services`, `config.sections`, `tooling.deployTargets`, `ui.pageLinks` and others).
- **`entries`** — the rows this module adds to tables, its own or another module's. A row names its table, and the shape of that table decides which other fields it needs. The render refuses a row that does not fit its shape.

  | Field | Meaning |
  | --- | --- |
  | `table` | Required. The `id` of the table. |
  | `call` | `calls`: the factory, printed `call()`. `routes`: the router, printed `.route(path, call)`. |
  | `import` | `calls` and `routes`: the `{ name, from }` import of `call`. `nav`: the icon component, printed `icon: <name>`. `from` is relative to the generated file, which sits beside the file that holds the table, so a specifier that worked there works here. A package name also works. |
  | `path` | `routes`: the mount path, such as `/waitlist`. It starts with `/`. |
  | `entry` | `objects`: the JSON object of the row. `nav`: the row without its icon (`to`, `label`, `shortcut`, …). |
  | `area` | `nav`: the `to` of the area the row goes into, such as `/`. |
  | `group` | `nav`: the label of the group. A group the area does not have yet is added after its last group. |
  | `order` | Sort key, 1000 when absent. A lower order comes first. Equal orders sort by module name, and one module's rows keep their descriptor order. `/health` is the `api` module's own row in `api.routes`, at order 0. A `tooling.deployTargets` row carries an `order` equal to its object's `order`. |
  | `when` | Write this row only while the condition holds, the same `when` as on a file or a patch: `{ "installed": ["command"] }`. |

  A row that repeats the identity of an earlier row in the same table is written once: the same `call`, the same route `path`, the same nav `area` and `to`, or an equal `objects` entry. A remove is a render without the module, so the row leaves the generated file and its import goes with it. A descriptor that holds `tables` or `entries` sets `requires.saasaloy` to `>=0.10.0`, the first CLI that reads them.
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

- **`api`** scaffolds `apps/api` with a **statically chained route table**, the `api.routes` table in `src/routes.generated.ts`. Add a route in two parts: drop `files/api/routes/<feature>.ts` → `@api/routes/<feature>.ts`, then add an `api.routes` row to `entries` (below). The drop alone mounts nothing.
- **`config`** ships in the base and holds a **section registry**, the `config.sections` table in `packages/config/src/sections.generated.ts`. A capability that owns a checked-in constant contributes one section, the same two-part shape as a job. Drop `files/config/<key>.ts` → `@config/sections/<key>.ts`, exporting a factory that returns `defineSection("<key>", { … })`, then add the call as a `config.sections` row. The key is the module name, it must be unique, and `saasaloy add` refuses two modules claiming one. Read the value anywhere with `import { config } from "@repo/config"`.

  ```jsonc
  "files": [{ "path": "files/config/shop.ts", "target": "@config/sections/shop.ts" }],
  "entries": [
    { "table": "config.sections", "call": "shopConfig",
      "import": { "name": "shopConfig", "from": "./sections/shop" } }
  ]
  ```

  Three rules the file itself has to follow. It imports its helper by subpath,
  `@repo/config/define`, never by relative path. It lives in `packages/config` rather than in
  your own package, because `@repo/config` imports nothing and that is what lets every app and
  every capability — yours included — import it. And it never reads another section: sections
  compose side by side, so a value derived from two of them is derived where it is used. A value
  that can differ between two deployments of one project is an `envVars` entry instead (ADR 0052).

- **`database`** scaffolds `packages/db` with a **schema barrel** that auto-re-exports everything
  in `schema/`. Add a table = drop `files/db/schema/<feature>.ts` → `@db/schema/<feature>.ts`.
- **Every table ships its seed slice.** Drop `files/db/seed/<table-in-kebab-case>.ts` → `@db/seed/slices/<table-in-kebab-case>.ts`, one row for each state the UI shows differently, and `rows: {}` for a table that stays empty. `scripts/seed-slices.test.ts` fails when a module ships a table without one. The `saasaloy-database` skill, "Seed data", has the slice contract.
- **A Vitest test file is `<name>.vitest.ts` in the module and `<name>.test.ts` in the project.** Set the rename in the descriptor, and gate it on the testing mode (`"path": "files/api/routes/auth.vitest.ts", "target": "@api/routes/auth.test.ts", "when": { "testing": true }`), so a project with testing `off` receives no module test (ADR 0054). `pnpm lint` applies the project's Vitest rules to every `.vitest.ts` file here, so a violation fails in this repo before a scaffold sees it.
- **A journey spec ships in the feature module, gated on `e2e`.** Drop `files/e2e/<module>-<journey>.spec.ts` → `@e2e/specs/<module>-<journey>.spec.ts` with `"when": { "installed": ["e2e"] }`. A journey that crosses three or more modules belongs in `modules/e2e` instead (ADR 0054). `pnpm test:modules` runs `node --test` over `modules/*/files/**/*.test.ts`, and it would fail on a file that imports `vitest`.
- **`queue`** scaffolds `packages/queue` with a **job table** and a **schedule table**, `queue.jobs` in `src/jobs.generated.ts` and `queue.schedules` in `src/schedules.generated.ts`. Background work is two parts, the same shape as a route. Drop `files/queue/jobs/<feature>.ts` → `@queue/jobs/<feature>.ts`, exporting a **factory** (`export const sendDigestJob = (): Job => defineJob({ name: "send-digest", handler })`), then add the call as a `queue.jobs` row. A job that also runs on a clock adds a `queue.schedules` row, whose `call` is a `defineSchedule({ name, cron, job })` factory. The drop alone registers nothing: nothing scans `jobs/`, and an unregistered job name fails `enqueue` with `unknown_job`. A factory, not a bare constant, because a `calls` table prints `call()`.

  ```jsonc
  "entries": [
    { "table": "queue.jobs", "call": "sendDigestJob",
      "import": { "name": "sendDigestJob", "from": "./jobs/digest" } },
    { "table": "queue.schedules", "call": "nightlyDigest",
      "import": { "name": "nightlyDigest", "from": "./jobs/digest" } }
  ]
  ```

  A feature module `dependsOn` `queue`, never a provider. The user picks `queue-cloudflare` or
  `queue-memory` and sets `QUEUE_PROVIDER`, exactly as with `email`.
- **UI goes into `packages/ui`, as a block.** A module that ships user-facing UI targets
  `@ui/blocks/<name>.tsx` and follows the same rules the base blocks follow: one file, one
  component export named for the block (`Waitlist`), copy as in-file prop defaults, reached at its
  own `@repo/ui/blocks/<name>` subpath. Nothing globs a folder and no page is patched, so the block
  lands on disk and goes nowhere until the owner imports it. **A module that targets
  `@ui/blocks/` must ship a skill with a `## Wire-up` section** (Step 4) — that section is the only
  place the wire-up steps exist, and `saasaloy add` prints a pointer to it. Copy defaults stay in
  the block file: `packages/ui/src/content/landing.ts` belongs to the base, and a module never edits
  a file it does not own.
- **A block stays presentational, and the app injects the behaviour.** A block that has to send
  something takes a function prop and calls it. It imports React and ui primitives, and nothing
  else — never an api package, an http client, or `import.meta.env`. Ship the counterpart as a
  second file under `@web/components/<Name>.tsx`: a small React island that builds the client and
  passes the function down. Two reasons. `packages/ui` has a `typecheck` script and the workspace
  is consumed as source, so a single `import type { AppType } from "@repo/api/client"` in a block
  makes `tsc` compile the entire api and db source tree under the ui package's tsconfig, inheriting
  every error in it. And Astro serializes island props, so a function cannot cross from `.astro`
  into an island anyway — the page has to render the app-side file. `waitlist` is the worked
  example: `blocks/waitlist.tsx` plus `apps/web/src/components/WaitlistForm.tsx`.
- **An admin page is a route file on the admin shell, not a block.** A module that adds an admin screen drops `@admin/routes/<feature>.tsx` and registers its nav row as an `admin.nav` row in `entries`: `{ "table": "admin.nav", "area": "/", "group": "Manage", "entry": { "to": "/teams", "label": "Teams" }, "import": { "name": "UsersRoundIcon", "from": "lucide-react" } }`. The `app` shell takes the same row in `app.nav`. The page renders inside the page frame the admin root route provides, so it writes no `<main>`, no centred `max-w-*` wrapper, no outer padding and no `h1`. It renders `PageHeader` from `@repo/ui/blocks/shell/page-header`, puts a list in `DataTable` inside `PageLayout` with a `DetailPanel` for the selected record, and puts anything else in `PageBody`. Every control comes from the shell primitive set at `@repo/ui/components/shell/*`: `Field` and `Input` in forms, `Switch` for a toggle, `Dialog` for a create flow, `AlertDialog` before a destructive action, and `toastManager.add` for each mutation result. A lint rule fails any base `@repo/ui/components/*` import under `apps/admin/**`. The router supplies a skeleton and an error screen for every route, so a page writes its own only when its words differ. A module block that only the admin page renders goes in `@ui/blocks/admin/<name>.tsx` and uses the shell set too; `feature-flags` is the worked example. The `saasaloy-shell` skill documents every block and container.
- Non-UI files still drop into their own app (`@web/...`, `@api/...`).

Only when a change is genuinely structural — and no convention exists for it — use a **small, tested AST patch** in `patches`: a KV binding in `wrangler.jsonc`, a column on another module's Drizzle table, a `db:generate` command in the app's `package.json`. A plugin in Better Auth's array is a table row (`auth.plugins`), not a patch. That's the 10%, not the spine. If you reach for a patch to edit another *module's* file, stop — add or use a convention instead.

**Registering a route is not optional.** `apps/api` used to glob `routes/*.ts`, so a drop was enough; it no longer does. Every route is one `.route()` link in a single chain, because `hc<AppType>` reads its paths, inputs and response shapes off `typeof app`, and a glob gives that type nothing to carry. So a route module drops its handler file **and** adds one row to `entries`. The drop on its own leaves a file nothing imports. ADR 0028 records the trade.

The CLI writes the chain into `apps/api/src/routes.generated.ts`, and `apps/api/src/index.ts` does `const app = apiRoutes(base)`. A remove is a render without the module, so the link and its import leave the generated file. An owner adds a route of their own after the generated ones: `apiRoutes(base).route("/reports", reports)`. Two rules for the descriptor:

- **Pick the table by whether the route belongs in `AppType`.** Use `api.routes` for a typed route: `apiRoutes` chains it onto `base`, and `AppType` picks the link up. Use `api.baseRoutes` only for a mount that must stay *out* of `AppType`, such as an opaque catch-all like `auth`'s `/auth`. `apiBaseRoutes` mounts it on `base` after the middleware.
- **Your route file exports its sub-app by name, as one chained expression.** `export const <feature> = new Hono().get(...)`, matching `import.name`. The generated file imports the router by name, so a default export does not work, and a broken-up chain exports a type that has forgotten its own routes.

## Step 4 — Contribute agent context

A module carries the AI guidance for the capability it adds the same convention-based way it adds
routes and schema: **by shipping a self-contained skill folder, never by editing a shared agent
file.** Step 2's scaffold writes `modules/<name>/skills/saasaloy-<name>/SKILL.md` as a stub and
lists it in `agent.skills[]`; replace its `TODO`s with the real runbook. At
`add` time the applier **copies** that folder verbatim into the consumer's
`.claude/skills/saasaloy-<name>/` and records it in `.saasaloy/manifest.json`, so `remove` deletes
exactly what was copied.

**Skill names are always `saasaloy-`-prefixed.** A module's skill folder, and the `name:` in its
`SKILL.md` frontmatter, both take the form `saasaloy-<module>` (the `api` module ships
`skills/saasaloy-api/` with `name: saasaloy-api`). The prefix namespaces every module skill so it
lands in the consumer's `.claude/skills/` without colliding with a user's own installed skills — a
generated project may have dozens of module skills alongside the user's, and a bare `api` or
`subscription` is exactly the kind of name a user might already have. Keep the folder name and the
frontmatter `name` identical and prefixed. (See ADR 0014.)

**A UI-bearing module's skill carries a `## Wire-up` section, and it is required.** Any module with
a `files[]` target under `@ui/blocks/` needs one, because the applier writes the block and then
stops: it never edits a page, and it prints only a pointer to your skill. Write the section for an
agent that has to follow it without guessing, and name all four things:

1. **Which file to edit** — `apps/web/src/pages/index.astro` for the landing page.
2. **The import line, verbatim** — `import WaitlistForm from "@web/components/WaitlistForm";`.
   Name the app-side island when the block takes injected behaviour, and say plainly that the page
   imports that file rather than the block.
3. **The tag, verbatim, with its client directive** — `<WaitlistForm client:load />` — and say why
   the directive is there, or say that the block is static and takes none.
4. **An exact suggested anchor, marked as a suggestion** — "after `<Cta />`, or wherever you want
   it". Placement is the owner's decision; the anchor saves them a search, it does not make the
   choice.

Say also what `saasaloy remove` does not undo: it deletes the block file and leaves the import the
owner added, so that line has to come out by hand. `modules/waitlist/skills/saasaloy-waitlist/SKILL.md`
is the worked example.

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
- **Name every table in plural snake_case** and export it under the camelCase plural:
  `featureFlagOverrides` on `feature_flag_overrides`, `waitlistEntries` on `waitlist_entries`.
  Columns stay singular, and an index starts with its table name. A Better Auth plugin table
  follows the rule too: the adapter runs with `usePlural: true` and asks for `<model>s`, so a
  plugin with `modelName: "X"` needs the export `Xs`. `scripts/table-names.test.ts` checks all of
  it (ADR 0038).

## Conventions to honor

- **Feature modules never AST-patch another module's internals.** Extend via the
  convention-based drop points instead: a table into `packages/db/schema/`, a UI component
  into `apps/web`. Only genuinely structural edits (a KV binding, a Better Auth plugin) use
  small, tested AST patches.
- **A route is the exception: drop the handler, then register it with an `api.routes` row in `entries`.** The generated `apps/api/src/routes.generated.ts` names every route statically so `AppType` carries them; nothing globs `routes/` (ADR 0028).
- **A registration goes in `entries`, never in a file the owner keeps.** The owning module declares the table in `tables`, the CLI writes it as a `<name>.generated.ts` file, and the file the owner keeps spreads it.
- **UI ships as a `@ui/blocks/` block, and the owner places it.** No module puts itself on a page,
  and no applier edits one. A module with such a file ships a skill whose `## Wire-up` section
  carries the import, the tag and a suggested anchor.
- **Blocks are presentational; behaviour is injected.** A block takes a function prop and never
  imports an api package, an http client or `import.meta.env`. The module ships the app-side island
  that supplies it under `@web/components/`.
- **Contribute agent context by shipping a skill folder**, not editing shared ones: an
  `agent.skills[]` folder is copied into the consumer's `.claude/skills/` by `add`. Modules
  never append to the committed `AGENTS.md`/`CLAUDE.md`.
- **Name every module skill `saasaloy-<module>`** — folder and frontmatter `name` alike — so it
  can't collide with a user's own installed skills (ADR 0014).
- Declare `dependsOn` so the applier can resolve and topologically sort prerequisites.
- **Prefix every account-scoped name with `{{PROJECT_NAME}}`**: a Worker `name`, a KV namespace, a queue, an R2 bucket. `saasaloy add` renders the token in module files and in patch entries, as `init` does for the base, so two projects in one Cloudflare account never deploy over each other. The token renders in every module file, skills included, so a skill that means the placeholder writes `<project>` instead.

## Authoring checklist

- [ ] The skeleton came from `saasaloy new module <name>`, not from a hand-written file.
- [ ] `modules/<name>/registry-item.json` present, `name` matches the directory.
- [ ] `type` is `saasaloy:capability` or `saasaloy:feature` (capabilities carry `scaffolds`).
- [ ] `description` is one real line, not the scaffold's `TODO`; `stage` and `needs` are checked, not left at the scaffold's `mvp` and `[]` by default.
- [ ] `requires.saasaloy` is left out, or names a range you have actually run the module on.
- [ ] Every needed capability is in `dependsOn`, named as the capability and never as one of its
      drivers; every npm import is exact-pinned in `dependencies`/`devDependencies` (`name@version`;
      `pnpm deps:update` fills versions).
- [ ] Each `files[]` target uses a `@alias` and lands in a convention folder where possible.
- [ ] `patches` is empty unless a change is genuinely structural (with a note on why), and each op
      uses a `kind` the engine defines.
- [ ] `conflictsWith` names any module this one is mutually exclusive with, on one side only.
- [ ] `requiresOneOf` names the modules that complete this one, if it ships an extension point some
      other module has to fill (two names minimum).
- [ ] Every test file entry carries `"when": { "testing": true }`, and every `when.installed` name is a module under `modules/`.
- [ ] `envVars` lists any required keys; no secrets baked into files. A key that cannot differ
      between two deployments of one project is a config section, not an env var (ADR 0052).
- [ ] `agent.skills[]` points at a `skills/saasaloy-<name>/SKILL.md` runbook, with matching
      `saasaloy-<name>` frontmatter `name` (prefixed to avoid skill-name collisions).
- [ ] Any UI ships as a `@ui/blocks/<name>.tsx` block that imports React and ui primitives only;
      when the block takes injected behaviour, that comes from a `@web/components/<Name>.tsx`
      island the module also ships (a static block needs no island).
- [ ] The skill carries a `## Wire-up` section naming the file to edit, the import line, the tag
      with its client directive, and a suggested anchor marked as a suggestion.
- [ ] Files are self-contained wiring (clean copy-in updates; no sentinel comments).
- [ ] `saasaloy doctor modules/<name>` reports no findings.
