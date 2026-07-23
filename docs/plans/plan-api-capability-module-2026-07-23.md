# Plan — `api` capability module

*Drafted 2026-07-23. Hardened via grillkit 2026-07-23.*

## Context

`api` is the first Phase-1 **capability module** in the Saasaloy registry (issue #8). It scaffolds
`apps/api` — **Hono on Workers**, the stable backend spine shared by `web` and `admin` — and
establishes the **file-based route convention** that every downstream feature (`waitlist`,
`feedback`, `billing`, …) extends by dropping a `routes/*.ts` file, with no module ever editing the
entry. It is a prerequisite of nearly every feature module, so its conventions set the ceiling for
how cleanly the whole registry composes.

This plan authors the module **artifact** — `modules/api/registry-item.json`, its `files/` tree, and
its `skills/saasaloy-api/` runbook — per the `create-module` skill and build-spec §2.3 / §2.7 / §3.1 / §3.3.
It does **not** build the applier that consumes the descriptor (issue #6) or the patch engine
(issue #7, already landed). Success = a schema-valid `api` descriptor whose scaffolded `apps/api`
runs Hono on the **`workerd` runtime locally**, auto-registers a dropped `routes/*.ts` without an
entry edit, and ships a skill runbook — ready for the applier the moment it lands.

**Phase reality:** `saasaloy add`/`list` are still Phase-1 stubs and `modules/` is empty; no
consumer base template (`templates/base`) exists in-repo yet. This module is authored against the
conventions and exercised through the git-ignored `.dev/` playground, not a real `add` run.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Tier | **Capability** (`saasaloy:capability`) — scaffolds a new `apps/api` workspace and carries `scaffolds`. |
| Framework | **Hono on Workers** (build-spec §2.3). Entry is a Workers `fetch` handler; no Node adapter. |
| Build tool | **Vite + `@cloudflare/vite-plugin`.** Chosen so the route convention can auto-resolve at build (below) and so `vite dev` runs the code on the real **`workerd`** runtime locally. `wrangler` stays for the eventual deploy. |
| Extension convention | A **`routes/` folder** the entry auto-registers via `import.meta.glob('./routes/*.ts', { eager: true })` — resolved to static imports at **build time** (Workers has no runtime FS). Adding a route = drop `@api/routes/<feature>.ts`; the entry is never hand-edited (§2.7). A manual drop works on the next build. |
| Route contract | Each `routes/<name>.ts` **default-exports a `Hono()` sub-app named after the service** (`const health = new Hono(); export default health`). The entry mounts it at `/<name>` (basename). **Flat folder only** in v1 (nested dirs → nested paths is a clean, backward-compatible upgrade if ever needed). Internal paths are **relative to the mount** — `health.get('/')` serves `GET /health`, not `health.get('/health')`. |
| `dependsOn` | **None.** `api` is an independent **root capability** (peer of `database`; neither needs the other). Features `dependsOn: ["api"]`, not the reverse. |
| npm deps — the standing convention | **One source of truth per workspace.** A capability *owns* the `package.json` it scaffolds → declares its deps there and leaves descriptor `dependencies[]` **empty**. A feature owns no `package.json` → lists npm deps in `dependencies[]` and the applier merges them into the target workspace's `package.json`. So for `api`: `dependencies: []`; `hono` (runtime) + `vite`/`@cloudflare/vite-plugin`/`wrangler`/`@cloudflare/workers-types` (dev) live in the scaffolded `apps/api/package.json`. |
| `dependsOn` vs `dependencies` | Two distinct fields: `dependsOn[]` = **inter-module** prerequisites (topo-sorted Saasaloy modules); `dependencies[]` = **npm packages** (pnpm). Never conflate. |
| Bindings convention | Bindings are threaded through Hono context (`c.env`), never `process.env`, typed via a `Bindings` type in the entry. Base `api` ships **zero bindings**; `database`/`queue`/etc. patch `wrangler.jsonc` to add theirs. |
| `envVars` | **Empty** — base `api` needs no secrets. |
| `patches` | **Empty.** Assumes the base's `pnpm-workspace.yaml` uses `apps/*`/`packages/*` globs, so pnpm + Turbo auto-discover `apps/api` with no root edit. **Fallback:** if the base instead pins explicit members, `api` gains its one structural patch — append `apps/api` to the members list via the patch engine. |
| `scaffolds[]` shape | Each entry describes a full workspace with **workspace-root-relative** targets (no alias) and declares the alias it registers into `saasaloy.json`: `{ "workspace": "apps/api", "aliases": { "@api": "apps/api/src" }, "files": [{ "path": "files/…", "target": "package.json" }, …] }`. `scaffolds[]` = "I birth this whole workspace"; `files[]` = "I drop into an existing convention" (features). `api`'s own files — incl. `src/routes/health.ts` — ship **in the scaffold**, so `api`'s `files[]` is empty. |
| Agent context | Ships `skills/saasaloy-api/SKILL.md` (Hono-on-Workers + route-convention runbook), listed in `agent.skills`, copied to `.claude/skills/saasaloy-api/` by `add`. Skill name is **`saasaloy-`-prefixed** to avoid collisions with user-installed skills (ADR 0014). |
| Deployment ownership | **Not `api`'s job.** A future **`infra` capability** centralizes deploy for all services via IaC (needs a tracking issue — none exists yet). `api` ships `wrangler.jsonc` (its own service config) but owns no deploy step. |
| Acceptance / DoD | **Local `workerd` (`vite dev`) + auto-registration** is the Definition of Done: `GET /health` returns green and a second dropped `routes/*.ts` auto-registers with no entry edit (issue #8 criterion 2). A real edge `wrangler deploy` (criterion 1's literal "deploys to Workers") is **deferred to end-to-end applier/`infra` QA**, not a blocker for landing this descriptor. |

## Approach

### Phase 1 — Descriptor (`modules/api/registry-item.json`)
- Author a schema-valid descriptor: `name: "api"`, `type: "saasaloy:capability"`, empty
  `dependencies`/`envVars`/`patches`/`files`, a single `scaffolds[]` entry (shape above) declaring
  `@api → apps/api/src`, and `agent.skills: ["skills/saasaloy-api"]`.
- Validate through `validateRegistryItem` (`packages/cli/schemas/registry-item.schema.json`). Tighten
  the schema's `scaffolds.items` from bare `{ "type": "object" }` to the `{ workspace, aliases, files }`
  shape while here (no forced change, but pins the convention).

### Phase 2 — Scaffold files (`modules/api/files/`)
- **`src/index.ts`** — Hono app + Workers `fetch` export, typed `Bindings`, the `import.meta.glob`
  route loader (mount each `mod.default` at `/<basename>`).
- **`src/routes/health.ts`** — `const health = new Hono(); health.get('/', …); export default health`
  → `GET /health`, proving the convention end to end.
- **Workspace config** — `package.json` (deps per the convention: `hono` + Vite/wrangler toolchain,
  `dev`/`build`/`deploy` scripts), `vite.config.ts` (`@cloudflare/vite-plugin`), `wrangler.jsonc`
  (Workers entry, compat date, **no bindings**), `tsconfig.json` (extends `@repo/tsconfig`).

### Phase 3 — Skill runbook (`modules/api/skills/saasaloy-api/SKILL.md`)
- The route convention and how to add a route; the **mount-relative path** gotcha; the `c.env`
  bindings rule (no `process.env`); the `vite dev` / `workerd` local workflow; how feature modules
  patch `wrangler.jsonc` for *their* bindings; a pointer that deploy is the future `infra` module's job.

### Phase 4 — Exercise in `.dev/`
- Stand the scaffold up in `.dev/`: `vite dev` boots it on `workerd`, `GET /health` is green, and a
  second dropped `routes/*.ts` auto-registers with **no entry edit** (issue #8 acceptance criterion 2).

## Open questions

Remaining thin spots (none block `api`; logged for the tiers/plans that own them):

- **Feature-tier dep target (out of scope for `api`).** A feature can drop files into several
  workspaces (`@api`, `@db`, `@web`), so the applier must decide *which* workspace's `package.json`
  receives a feature's `dependencies[]` — likely inferred from the importing file's target alias.
  Belongs to the `waitlist`/feature plans, not here.
- **Toolchain version pins.** Exact `hono` / `vite` / `@cloudflare/vite-plugin` / `wrangler` /
  `@cloudflare/workers-types` versions to pin in the scaffolded `package.json` — settled at build
  time against what's current.
- **Route path-derivation edges.** Reserved/underscore-prefixed filenames, and behavior if two
  routes collide with a built-in path — minor; document the rule in the skill.

## Non-goals

- **Building the applier or patch engine** — issues #6/#7; this plan authors the descriptor they consume.
- **Deployment / IaC** — owned by the future `infra` capability, not `api`. `api` ships only its own `wrangler.jsonc`.
- **A real edge `wrangler deploy`** — deferred to end-to-end applier/`infra` QA (see DoD).
- **A consumer base template** (`templates/base`) — not in scope; the module is exercised via `.dev/`.
- **Any feature module** (`waitlist`, `feedback`, …) or their routes — they `dependsOn: ["api"]` and land later.
- **`database`/`auth`/other capabilities** and their `wrangler.jsonc` bindings — separate modules; `api` ships zero bindings.
