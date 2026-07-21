# Saasaloy — Build Spec (v1)

*Source of truth for the Saasaloy build. Supersedes `Saasaloy-Draft-Plan.md`, which was decision-first brainstorming; this doc records the decisions we settled and the reasoning behind them. Grilled and finalized 21 July 2026.*

> **Status:** decisions settled, ready to build. No code has been written yet. Lower-priority items are parked in [Open Questions](#open-questions) and will be resolved when their feature is actually implemented, not before.

---

## 1. What we're building (one paragraph)

Saasaloy is a **personal SaaS accelerator for Cloudflare**, built first to kill *my own* re-scaffolding pain and designed to become an open-source product later without rework. It is a **composable CLI + module system**, not a static boilerplate. A near-inert base (`saasaloy init`) scaffolds a Cloudflare-native Turborepo monorepo containing only a marketing landing page; everything churny — the API, database, auth, admin app, and SaaS features — installs on demand via `saasaloy add <module>`, each module carrying *today's correct wiring*. It steals **shadcn's distribution mechanics** (declarative, you-own-the-code descriptors) but implements only a **local applier** for v1, deferring the HTTP registry until there are other users. Every project it generates is **AI-agent-native**: Saasaloy ships the agent instructions, guidelines, and skills that tools like Claude Code, Codex, and Antigravity read (committed `AGENTS.md`/`CLAUDE.md` plus module-supplied Claude skills), and the workflow prefers AI-assisted solutions for any non-deterministic step. The wedge: Cloudflare's building blocks are all mature, but nobody assembles *and maintains* them — static boilerplates rot within a release cycle, and the thinner the frozen base, the less there is to rot.

---

## 2. The decisions (settled)

### 2.1 Purpose — personal accelerator first, open-source later

Built to solve my own repeated MVP scaffolding, with me as user #1 and the validation metric ("does this kill my re-scaffolding pain"). Everything is engineered so the open-source transition is additive, never a rewrite. **Consequence:** the entire community/trust/distribution apparatus (community namespaces, Sigstore provenance, reputational signals, discovery page) and framework breadth are **out of v1** — deferred to the open-source phase.

### 2.2 All-in on Cloudflare

I commit personally to Cloudflare for my own MVPs, so the **multi-cloud adapter layer is cut entirely** — no `core` capability interfaces, no per-provider adapter packages (`db-neon`, `store-s3`, `deploy-*`), no `saasaloy migrate db` command. D1 + R2 + Workers are hardcoded. Two cheap habits are kept as conventions (not the adapter layer) because they cost nothing now and preserve a future exit: thread an `env`/`context` object for bindings instead of reading `process.env`, and keep a thin repository layer so raw SQL doesn't sprawl through app code.

### 2.3 Stack

| Concern | Choice | Notes |
|---|---|---|
| Marketing (`apps/web`) | **Astro** | Content-first — landing, ToS, privacy. Astro's strength. |
| App (`apps/admin`) | **TanStack Router + Vite (SPA)** | Client-rendered. Deliberately *Router*, not *Start* — sidesteps the known "fullstack TanStack Start + Workers + D1 not cleanly generatable" issue, since an SPA never asks Workers to render it. SEO is irrelevant behind login. |
| Backend (`apps/api`) | **Hono on Workers** | The stable backend spine; shared by web and admin. |
| Database | **Drizzle + D1 (SQLite)** | Postgres treated as a later, explicit migration — never a config toggle. |
| Auth | **Better Auth + plugins** | Org plugin (teams) and Stripe plugin (billing) are feature modules, not base. |
| Monorepo | **Turborepo + pnpm**, `workspace:*` | JIT internal packages for zero-config drop-in. |

### 2.4 Registry v1 — local applier over shadcn-shaped descriptors

`saasaloy add <module>` is a **local applier**, not an HTTP registry. Modules live in the CLI's own repo as shadcn-style `registry-item.json`-shaped descriptors (`files[]` with alias targets, `dependencies[]`, `dependsOn[]`, and a declarative config-patch block). The applier reads a descriptor **off disk**, resolves file targets through a minimal `saasaloy.json` alias map in the consumer project, topologically sorts prerequisite modules, and applies files + npm deps + patches — all `--dry-run`/`--diff`-able.

Everything the full shadcn model adds — HTTP transport, schema-validation-at-fetch, recursive cross-registry resolution, per-registry auth, last-target-wins override — is deferred, because it exists to serve *other people* and I don't have them yet. **The graduation is one line:** `fs.readFile(...)` becomes `fetch(...)`. The module *format* is identical in both worlds, so there is zero rework.

### 2.5 Auth model — httpOnly cookies + subdomains

*This overrides the draft's JWT default.* The draft chose JWT for edge portability; that rationale died with the all-in-Cloudflare commitment, and a client-only SPA has no server to hold a JWT (so it lands in `localStorage`, XSS-exposed, or in-memory with a refresh dance).

- **Topology:** `x.com` (marketing) · `app.x.com` (admin SPA) · `api.x.com` (Hono API). Three apps deploy independently.
- **Sessions:** Better Auth sets an **httpOnly session cookie scoped to `.x.com`**. The SPA calls the API with `credentials: 'include'`; CORS allows the app origin with credentials.
- **Why:** most secure (nothing stealable from JS, revocable), least code, standard SaaS shape. A D1 session read per request is negligible; the draft's "DB sessions lack edge compat" worry does not apply — D1 is a binding and Better Auth's Drizzle adapter reads it at the edge fine.

### 2.6 Base = landing page only

*This rejects the draft's "auth in base."* The base is a near-inert marketing shell — `apps/web` (Astro) + `packages/ui` + `packages/config` — and nothing else. Rationale: a frozen base is exactly what rots; a landing page barely churns while auth/API/DB wiring churns constantly. Pushing all churny wiring into patchable modules and keeping the base inert is the anti-rot thesis taken to its logical end.

### 2.7 Modules — granular, two-tier, convention-based

Modules are **granular** (rejecting a monolithic `add app`), because real MVP stages need different subsets. Concretely: a landing page's first feature might be a **waitlist**, which needs `api` + `database` + optional `email` but explicitly *not* auth or admin.

Two tiers:

- **Capability modules** — `api`, `database`, `email`, `auth`, `admin`. Each scaffolds an app or package **and establishes convention-based extension points**.
- **Feature modules** — `waitlist`, `billing`, `teams`, … Each extends capabilities *by dropping files into their conventions*, and declares `dependsOn`.

**Convention-based extension points** are what make granular modules safe (no module AST-patches another module's internals, so no drift-seam):

- `api` scaffolds `apps/api` with **file-based route registration** — a `routes/` folder the Hono entry auto-globs. Add a route = drop `routes/waitlist.ts`.
- `database` scaffolds `packages/db` with a **schema barrel** that auto-re-exports everything in `schema/`. Add a table = drop `schema/waitlist.ts`.
- A feature drops its files into those folders (and into `apps/web` for landing-facing UI). Genuinely structural edits (a D1 binding in `wrangler.jsonc`, a plugin into Better Auth's array) remain small AST patches — the 10%, not the spine.

**Dependency resolution:** `dependsOn` resolves recursively, topologically sorted, behind a **confirmation prompt**:

```
$ saasaloy add waitlist
  › waitlist requires: api, database   (email optional — skip? [Y/n])
  › will install: api → database → waitlist
  › proceed? [Y/n]
```

### 2.8 First proof — waitlist, then billing

*This replaces the draft's "billing first."* The first end-to-end registry proof is **`add waitlist`** (pulling `api` + `database`) — a real feature (not a toy) that exercises dependency resolution and the file-drop conventions without the weight of auth. **`add billing`** (pulling `auth` + Stripe webhooks + pricing UI) is the *harder second* proof — you can't add billing to a landing page anyway; the app must exist first.

### 2.9 Update story — copy-in + `--diff` + manifest-tracked files

*The "maintained" half of the value prop.* New projects get current wiring for free (the CLI repo is current at `add` time). Existing projects receive fixes via **copy-in + `--diff`**, not versioned packages:

- Update = `saasaloy add <mod> --diff`. A copy-in update only conflicts at the intersection of "you edited this file" *and* "the module changed this file" — and the churny wiring is exactly what you don't hand-edit, so updates are usually clean overwrites of files you never touched.
- **No in-file markers.** Managed/generated status is tracked in a central **`.saasaloy/manifest.json`** that records each managed file + a content hash (see [3.2](#32-saasaloyjson--saasaloymanifestjson)). On update the tool hashes the file: matches → safe clean overwrite; drifted (hand-edited) → routed to the AI-merge path instead of clobbered. Nothing Saasaloy writes carries a sentinel comment. *(This supersedes the earlier `// saasaloy:managed` header idea — manifest tracking is cleaner and file-pollution-free, and it applies to every managed file, not just agent files.)*
- **AI-assisted merge is a first-class path.** `--diff` emits a structured, agent-consumable merge plan (old→new module version, managed-vs-yours file map) that hands straight to Claude Code / Codex / Antigravity. Non-AI users get the same diff as a manual guideline.
- The full update flow is **`diff → merge → regenerate migrations → verify (smoke test)`** — not just a text merge. A change can merge cleanly and still break at runtime (e.g. a Better Auth cookie-behavior change), and a schema change needs a Drizzle migration generated and run against existing data.

Packages are deferred: extract the churniest wiring into versioned `@saasaloy/*` deps *only if* manual merges ever start hurting. Copy-in → package is a cheap later migration; package-first is infra paid up front against a problem I may not have. Copy-in is also more agent-friendly — every file sits in the repo where an AI can read and rewrite it, rather than hidden in `node_modules`.

### 2.10 CLI entry — `saasaloy init`

*Rejecting `create-saasaloy`.* One binary, one mental model (`init` / `add` / `list`), one package to maintain. Consistent with shadcn — our model uses `npx shadcn init`, not `create-shadcn`. `npx saasaloy init my-app` bootstraps from a clean machine exactly like a `create-*` package would. A thin `create-saasaloy` shim can be added later purely for the `npm create` entry point if/when open-sourcing.

### 2.11 Remote registry — GitHub-hosted, git-tag-versioned

When Saasaloy graduates to a remote registry, it is **a GitHub repo of JSON descriptors + files**, not a custom-hosted service. shadcn supports GitHub refs natively (`owner/repo/item#tag`, raw URLs), so this is first-class:

- **Git tags/branches are the registry versions** (`saasaloy add billing@v2` → `…#v2`). Pin to tags, never `main`, so a registry edit never silently changes what an old project resolves.
- The remote phase points the applier at `raw.githubusercontent.com/<me>/saasaloy-registry/…`. A custom `registry.saasaloy.dev` collapses to an **optional** vanity/CDN front, added only if raw GitHub's ~5-min cache or unauthenticated rate limits ever bite.
- Community contribution later = PRs to the registry repo; private registries = a GitHub PAT in the `${TOKEN}` auth header.

### 2.12 Brand

`saasaloy` is the fixed brand. Name/npm/GitHub/domain availability is handled by me, out of scope for this spec.

### 2.13 AI-assisted development as a first-class citizen

Development of both Saasaloy and every project it generates is assumed to be **heavily AI-assisted** (Claude Code, Codex, Antigravity, …). This is a design constraint, not an afterthought, and it has two halves plus a governing principle.

**Saasaloy *ships* agent context into every project.** The base and each module supply the instructions, guidelines, and skills that agent tools consume — split into two kinds handled differently:

- **Fixed common rules → committed `AGENTS.md` + `CLAUDE.md`.** The base ships a static `AGENTS.md` (project-wide rules: pnpm/ESM conventions, "add features, don't hand-wire", the layout) copied verbatim from `templates/base` at `init`, plus a one-line `CLAUDE.md` (`@AGENTS.md`, since Claude Code supports `@`-imports). Both are **plain committed files — not generated, not git-ignored**. They exist the instant `init` finishes and survive a `git clone`, so any agent tool (Claude Code, Codex, Antigravity) opens the project with context immediately.
- **Module-specific guidance → Claude skills.** A module's runbook ships as a **skill folder** that `saasaloy add` **copies** into `.claude/skills/<name>/` (recorded in the manifest so `remove` can undo it). Skills are on-demand: the agent loads the waitlist runbook only when working on waitlist, keeping the always-in-context `AGENTS.md` lean. Modules never append to a shared agent file — adding/removing a module is adding/removing a self-contained folder, with no concat, no regeneration, and a clean remove path.

**Why this replaced the earlier canonical-source pipeline (reversal).** An earlier design made `AGENTS.md` a deterministic **concatenation** of ordered `.agents/*.md` fragments, with `CLAUDE.md` and per-OS skill **symlinks** regenerated by a `saasaloy sync` step and the outputs **git-ignored** (so symlinks wouldn't rely on git's flaky Windows handling). That machinery existed solely to let `AGENTS.md` grow as modules dropped fragments — but git-ignored, regenerated views are **absent on a fresh clone or a new agent session until `sync` runs**, and `saasaloy` isn't a dependency of generated projects, so the agent opens with no context (caught in Phase 0 QA, TC-6). Committing a static `AGENTS.md` and copying skills removes that entire failure class along with the concat/fragment/manifest-hash/`sync` machinery. The cost, accepted deliberately: module guidance is now **Claude-Code-only and on-demand** (skills aren't read by Codex/Antigravity) instead of concatenated cross-tool into `AGENTS.md`. For a Claude-first personal accelerator that's the right trade — the committed `AGENTS.md` still carries the universal rules to every tool.

**Saasaloy *contains* agent context for its own development.** The CLI/registry repo carries its own **hand-maintained** `AGENTS.md`/`CLAUDE.md` and an `author-module` skill (scaffolds a new `registry-item.json` + files + skill following the conventions) so building Saasaloy is itself AI-assisted and self-consistent. This repo is the CLI, not a generated project, so it does **not** run `saasaloy sync` on itself — its agent docs are tracked directly.

**Governing principle — prefer AI for non-deterministic tasks.** Deterministic steps stay deterministic and scripted (copy a file, add a dep, glob a route, copy a skill folder). For anything genuinely non-deterministic — a `--diff` merge into a hand-edited file, reconciling a migration against existing data, adapting a patch that no longer applies cleanly to a customized project — the CLI's default is to **emit a structured, agent-ready plan** (natural-language intent + the target files + old/new context) rather than fail or force a brittle deterministic transform. The tool stays agent-agnostic (it produces artifacts any agent can execute); optionally auto-invoking a detected agent CLI (`claude`, `codex`) is a later convenience, not a dependency. The update-merge design in [2.9](#29-update-story--copy-in---diff--manifest-tracked-files) is the first instance of this principle; it generalizes to every non-deterministic seam.

---

## 3. Architecture

### 3.1 Monorepo layout

```
saasaloy/                        # created by `saasaloy init`
  apps/
    web/                         # BASE — Astro marketing (landing, ToS, privacy)
    api/                         # via `add api` — Hono on Workers (routes/ auto-globbed)
    admin/                       # via `add admin` — TanStack Router SPA on Vite
  packages/
    ui/                          # BASE — shadcn-based React components
    config/                      # BASE — @repo/tsconfig, @repo/eslint-config
    db/                          # via `add database` — Drizzle schema barrel + repository layer
  .saasaloy/
    manifest.json                # module-applied file tracking (hashes) — created by `add`
  saasaloy.json                  # consumer manifest: alias map + installed modules
  AGENTS.md                      # BASE — committed: fixed common project rules (not generated)
  CLAUDE.md                      # BASE — committed: "@AGENTS.md" (one-line import)
  .claude/skills/                # module skill folders copied in by `add` (empty in base)
  turbo.json
```

Only the BASE entries exist after `init`; everything marked `via add …` is added on demand. `AGENTS.md` and `CLAUDE.md` are **committed static files** copied from the base template — nothing regenerates them and there is no `saasaloy sync`. `.claude/skills/` is empty in the base; `saasaloy add` **copies** each module's skill folder into it (tracked in the manifest for a clean `remove`).

### <a id="32-saasaloyjson--saasaloymanifestjson"></a>3.2 `saasaloy.json` + `.saasaloy/manifest.json`

`saasaloy.json` — the consumer manifest (alias map + installed modules):

```jsonc
{
  "aliases": {
    "@web":   "apps/web/src",
    "@api":   "apps/api/src",
    "@admin": "apps/admin/src",
    "@db":    "packages/db/src",
    "@ui":    "packages/ui/src"
  },
  "installed": ["web"]           // grows as modules are added; drives dependsOn resolution
}
```

`.saasaloy/manifest.json` — managed-file tracking (replaces in-file markers). Records each file a module applied — copied source files **and** copied skill files — with a content hash and the owning module, so `remove`/update know exactly what to undo. The base writes no manifest (`init` is a pure copy of static files); it is created by the first `saasaloy add`:

```jsonc
{
  "managed": {
    "apps/api/src/lib/auth.ts":            { "module": "auth", "hash": "c3d4…" },
    ".claude/skills/test-webhooks/SKILL.md": { "module": "billing", "hash": "e5f6…" }
  }
}
```

On update, the tool hashes a managed file: match → clean overwrite; drift → route to AI-merge. Committed `AGENTS.md`/`CLAUDE.md` are **not** managed entries — they are static base files, edited by hand.

### 3.3 Module descriptor (authored in the CLI/registry repo)

```jsonc
// modules/waitlist/registry-item.json
{
  "name": "waitlist",
  "type": "saasaloy:feature",
  "dependsOn": ["api", "database"],          // optional: "email"
  "dependencies": ["zod"],
  "files": [
    { "path": "files/api/routes/waitlist.ts",   "target": "@api/routes/waitlist.ts" },
    { "path": "files/db/schema/waitlist.ts",    "target": "@db/schema/waitlist.ts" },
    { "path": "files/web/components/WaitlistForm.tsx", "target": "@web/components/WaitlistForm.tsx" }
  ],
  "envVars": {},
  "patches": {},                              // waitlist needs none — pure file-drop via conventions
  "agent": {                                  // AI context contributed by this module
    "skills": ["skills/waitlist"]             //   skill folder(s) copied into .claude/skills/ by `add`
  }
}
```

Capability modules additionally carry `scaffolds` (new workspaces) and the structural `patches` (e.g. `wrangler.jsonc` bindings, Better Auth plugin-array insertions). The `agent` block is a convention-based extension point: a module ships one or more **skill folders**, and `saasaloy add` **copies** them into `.claude/skills/` (recorded in the manifest for a clean `remove`) — a module never edits the committed `AGENTS.md`/`CLAUDE.md`. Module guidance is thus on-demand Claude skills, not text concatenated into the shared agent file.

### 3.4 Config-patch strategy

Declarative merges for the 90% (env vars, schema additions via barrel, simple key merges). Small, well-tested AST codemods for the ~10% structural edits: **`magicast`** for TS/JS module edits (pushing `stripe()` into Better Auth's plugin array, config arrays) and **`jsonc-parser`** for `wrangler.jsonc` binding/route edits. Every patch is `--dry-run`/`--diff`-able.

---

## 4. Roadmap (re-sequenced)

The draft's phases are re-sequenced to reflect the thin base, granular modules, and personal-first cuts.

- **Phase 0 — Base + agent scaffolding** (#1). `saasaloy init` → Astro landing + `packages/ui` + `packages/config`, deploys green to Cloudflare (#2). Also scaffolds the agent layer: **committed static `AGENTS.md` + `CLAUDE.md`** (fixed common rules) copied from the base template — no `sync`, no generation (#3). Proves scaffolding + Turborepo + CF deploy + agent-native-out-of-the-box context. (Module skills are copied into `.claude/skills/` later, by Phase 1's `add`.)
- **Phase 1 — Applier + first proof** (#4). Build the local applier (descriptor read, alias resolution, `dependsOn` topo-sort + confirmation, `.saasaloy/manifest.json` hash tracking, `--dry-run`/`--diff`) (#6) over `$schema`-validated manifests (#5), with declarative + `magicast`/`jsonc-parser` patches (#7). Ship `api` (#8) + `database` (#9) capability modules and **`waitlist`** (#10) as the first end-to-end proof.
- **Phase 2 — Auth + hard proof + feature set** (#11). `auth` (#12) + `admin` (#13) capability modules (httpOnly-cookie + subdomain flow). **`billing`** (#14) as the harder proof (Better Auth Stripe plugin + webhooks + pricing UI). Then `teams` (#16), `email` (#15), `admin` panel pages. Introduce the full update flow (migrations regen + smoke verify) (#17).
- **Future (open-source phase, out of v1 scope).** HTTP/GitHub remote registry (`readFile` → `fetch`, git-tag versions), community namespaces + PR contribution, Sigstore provenance + reputational signals, framework breadth, and — only if ever needed — multi-cloud adapters and the `@saasaloy/*` package hybrid.

---

## 5. What changed from the draft (reversals recorded)

| Draft decision | Final decision | Why |
|---|---|---|
| Registry + CLI as an HTTP service (Phase 1 crown-jewel resolver) | **Local applier**, shadcn-shaped format; HTTP deferred | Cross-registry resolution serves other people — deferred with personal-first. `readFile`→`fetch` later, zero rework. |
| Multi-cloud adapters + `migrate db` (Theme D, Phase 3) | **Cut** | All-in on Cloudflare. Kept only cheap conventions (context-threaded bindings, repo layer). |
| Framework swappable behind alias contract (Phase 5) | **Cut** | Swappability is a product concern; personal-first marries one stack. |
| Default framework = React Router v7 | **Astro (web) + TanStack Router SPA (admin) + Hono (api)** | Purpose-built split; SPA dodges TanStack Start's generation risk. |
| Auth in base | **Base = landing page only** | Thinnest base = least rot. Auth is a capability module. |
| JWT/stateless auth default | **httpOnly cookies + subdomains** | Portability rationale died with CF commitment; SPA has no server for a JWT. |
| Billing first (hardest module) | **Waitlist first, billing second** | Matches real MVP stages; waitlist proves the machinery, billing stresses it. |
| `create-saasaloy` | **`saasaloy init`** | One binary/package, consistent with shadcn. |
| `registry.saasaloy.dev` custom host | **GitHub-hosted, git-tag-versioned**; custom domain optional | Zero infra, versioning for free, PR contribution path. |
| (draft had no AI-agent concept) | **AI-agent-native projects** — base ships committed static `AGENTS.md` + `CLAUDE.md` (`@AGENTS.md`); modules ship Claude **skills** copied into `.claude/skills/` by `add`; prefer-AI for non-deterministic steps | Development is heavily AI-assisted; agent context must be first-class and present on clone. |
| Canonical `.agents/` → `saasaloy sync` → generated + git-ignored `AGENTS.md`/`CLAUDE.md`/skill-links | **Committed static `AGENTS.md`/`CLAUDE.md`; module guidance = copied Claude skills; `sync` removed** | Git-ignored, regenerated views were absent on fresh clones/sessions until `sync` ran, and `saasaloy` isn't a dep of generated projects — the agent opened with no context (Phase 0 TC-6). Committing the base rules and copying skills kills that failure class and the concat/`sync`/manifest-hash machinery; accepted cost is module guidance being Claude-only + on-demand. |
| `// saasaloy:managed` in-file markers | **`.saasaloy/manifest.json` hash tracking** | Keeps generated files clean; applies to all managed files, not just agent files. |

---

## <a id="open-questions"></a>6. Open Questions (resolve at implementation time, not before)

Parked deliberately — each is a lower-altitude decision to settle when its feature is actually built.

1. **Email provider** (`email` module) — assume **Resend + React Email** unless a better fit surfaces. Resolve when building `add email`.
2. **`admin` shell scope** — what the base admin app includes (nav, session guard, empty dashboard) before feature modules add pages. Resolve when building `add admin`.
3. **CI / anti-rot testing** — how (and whether) to test each module against *latest* Cloudflare / Better Auth / Stripe on a schedule, so churn is caught before it reaches a project. Resolve alongside Phase 2's update flow.
4. **`saasaloy.json` + `registry-item.json` schemas** — the exact manifest + extension-field schemas (including the `agent` block), drafted as a `$schema`-validated forcing function. Resolve at the start of Phase 1 (it surfaces the real applier design).
5. **Cross-tool coverage of module guidance** — module runbooks now ship as Claude skills copied into `.claude/skills/`, which Codex/Antigravity don't read (the committed `AGENTS.md` still covers common rules cross-tool). If those tools ever need module-specific guidance, decide the mechanism (a second copied target, or a per-tool skills convention). Revisit only if Codex/Antigravity become primary. Saasaloy's own `author-module` skill set lives in this repo.

---

## 7. Key risk to keep in view

The premise and the risk are the same object: **the churn that justifies Saasaloy also becomes my maintenance burden.** Every module encodes today's correct wiring, so I now own keeping it current. Mitigations baked into the plan: the base is inert (nothing to rot); churn lives in thin, declarative, copy-in modules that are cheap to patch and AI-friendly to merge; scope is brutally personal-first, so the module surface stays small until the mechanics are proven. If I can't keep modules current faster than re-cloning would cost, the value proposition inverts — so ruthless scope is the standing discipline.
