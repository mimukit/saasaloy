# Saasaloy — Build Spec (v1)

*Source of truth for the Saasaloy build. Supersedes `Saasaloy-Draft-Plan.md`, which was decision-first brainstorming; this doc records the decisions we settled and the reasoning behind them. Grilled and finalized 21 July 2026.*

> **Status:** decisions settled, ready to build. No code has been written yet. Lower-priority items are parked in [Open Questions](#open-questions) and will be resolved when their feature is actually implemented, not before.

---

## 1. What we're building (one paragraph)

Saasaloy is a **personal SaaS accelerator for Cloudflare**, built first to kill *my own* re-scaffolding pain and designed to become an open-source product later without rework. It is a **composable CLI + module system**, not a static boilerplate. A near-inert base (`saasaloy init`) scaffolds a Cloudflare-native Turborepo monorepo containing only a marketing landing page; everything churny — the API, database, auth, admin app, and SaaS features — installs on demand via `saasaloy add <module>`, each module carrying *today's correct wiring*. It steals **shadcn's distribution mechanics** (declarative, you-own-the-code descriptors) but implements only a **local applier** for v1, deferring the HTTP registry until there are other users. Every project it generates is **AI-agent-native**: Saasaloy ships and generates the agent instructions, guidelines, and skills that tools like Claude Code, Codex, and Antigravity read, and the workflow prefers AI-assisted solutions for any non-deterministic step. The wedge: Cloudflare's building blocks are all mature, but nobody assembles *and maintains* them — static boilerplates rot within a release cycle, and the thinner the frozen base, the less there is to rot.

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

**Saasaloy *generates* agent context into every project.** The base and each module contribute the instructions, guidelines, and skills that agent tools consume, using a **single canonical source compiled/linked to per-tool views** (chosen over hand-maintaining per-tool files, which triples authoring and drifts):

- Canonical source lives in **`.agents/`** — ordered guidance fragments (`.agents/NN-*.md`) and skills (`.agents/skills/<name>/`). Modules contribute by **dropping a fragment and/or a skill folder** (a convention-based extension point, exactly like routes and schema — no shared-file patching).
- **`AGENTS.md`** is the deterministic **concatenation** of `.agents/*.md`, because Codex/Antigravity read `AGENTS.md` literally (no import support). It is a build artifact, tracked in the manifest — never hand-maintained.
- **`CLAUDE.md`** is a **one-line `@AGENTS.md` import** (Claude Code supports `@`-imports), so there is no second copy of the guidance.
- **`.claude/skills/<name>`** (and any other tool's skills dir) are **links** to the canonical `.agents/skills/<name>`, never copies.
- **`saasaloy sync`** regenerates all tool views from canonical source: re-concats `AGENTS.md`, rebuilds `CLAUDE.md`, and recreates the skill links per-OS. It is also wired as a pnpm `postinstall`. The links themselves are **git-ignored and regenerated** (not committed) so they survive macOS/Linux/Windows without relying on git's unreliable Windows symlink handling; only canonical `.agents/` is committed. Adding a new agent tool later = one new target entry, then `sync` — zero module changes.

**Saasaloy *contains* agent context for its own development.** The CLI/registry repo carries its own `.agents/` (compiled to `AGENTS.md`/`CLAUDE.md`) and skills for authoring modules — e.g. a skill that scaffolds a new `registry-item.json` + files + agent fragment following the conventions — so building Saasaloy is itself AI-assisted and self-consistent.

**Governing principle — prefer AI for non-deterministic tasks.** Deterministic steps stay deterministic and scripted (copy a file, add a dep, glob a route, concat fragments). For anything genuinely non-deterministic — a `--diff` merge into a hand-edited file, reconciling a migration against existing data, adapting a patch that no longer applies cleanly to a customized project — the CLI's default is to **emit a structured, agent-ready plan** (natural-language intent + the target files + old/new context) rather than fail or force a brittle deterministic transform. The tool stays agent-agnostic (it produces artifacts any agent can execute); optionally auto-invoking a detected agent CLI (`claude`, `codex`) is a later convenience, not a dependency. The update-merge design in [2.9](#29-update-story--copy-in---diff--manifest-tracked-files) is the first instance of this principle; it generalizes to every non-deterministic seam.

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
  .agents/                       # BASE — canonical agent source (fragments + skills)
    00-overview.md               #   guidance fragment (base); modules drop NN-*.md here
    skills/                      #   canonical skills; modules drop skill folders here
  .saasaloy/
    manifest.json                # managed-file tracking (hashes) + link map
  saasaloy.json                  # consumer manifest: alias map + installed modules
  saasaloy.agent.json            # BASE — agent-tool targets (which views to emit/link)
  AGENTS.md                      # BASE — generated: concat of .agents/*.md
  CLAUDE.md                      # BASE — "@AGENTS.md" (one-line import)
  .claude/skills/                # links → .agents/skills/* (git-ignored, regenerated by `sync`)
  turbo.json
```

Only the BASE entries exist after `init`; everything marked `via add …` is added on demand. `AGENTS.md`, `CLAUDE.md`, and the skill links are regenerated from canonical `.agents/` by `saasaloy sync` (also a pnpm `postinstall`).

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

`.saasaloy/manifest.json` — managed-file tracking (replaces in-file markers). Records each file Saasaloy generated/owns with a content hash, and the canonical→link map for tool views:

```jsonc
{
  "managed": {
    "AGENTS.md":                    { "source": "agent-compile", "hash": "a1b2…" },
    "apps/api/src/lib/auth.ts":     { "module": "auth", "hash": "c3d4…" }
  },
  "links": {
    ".claude/skills/test-webhooks": ".agents/skills/test-webhooks"
  }
}
```

On update, the tool hashes a managed file: match → clean regenerate/overwrite; drift → route to AI-merge. Links in `links` are git-ignored and recreated per-OS by `saasaloy sync`.

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
    "fragments": ["agent/30-waitlist.md"],    //   dropped into .agents/, re-concats AGENTS.md
    "skills": []                              //   optional: skill folders dropped into .agents/skills/
  }
}
```

Capability modules additionally carry `scaffolds` (new workspaces) and the structural `patches` (e.g. `wrangler.jsonc` bindings, Better Auth plugin-array insertions). The `agent` block is a convention-based extension point: fragments and skills are dropped into `.agents/`, and `saasaloy sync` re-derives `AGENTS.md`/`CLAUDE.md`/`.claude/skills` — a module never edits a shared agent file directly.

### 3.4 Config-patch strategy

Declarative merges for the 90% (env vars, schema additions via barrel, simple key merges). Small, well-tested AST codemods for the ~10% structural edits: **`magicast`** for TS/JS module edits (pushing `stripe()` into Better Auth's plugin array, config arrays) and **`jsonc-parser`** for `wrangler.jsonc` binding/route edits. Every patch is `--dry-run`/`--diff`-able.

---

## 4. Roadmap (re-sequenced)

The draft's phases are re-sequenced to reflect the thin base, granular modules, and personal-first cuts.

- **Phase 0 — Base + agent scaffolding** (#1). `saasaloy init` → Astro landing + `packages/ui` + `packages/config`, deploys green to Cloudflare (#2). Also scaffolds the agent layer: canonical `.agents/` (base overview fragment + any base skills), `saasaloy.agent.json` targets, and `saasaloy sync` producing `AGENTS.md` + `CLAUDE.md` + `.claude/skills` links (#3). Proves scaffolding + Turborepo + CF deploy + the canonical→tool-view pipeline.
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
| (draft had no AI-agent concept) | **AI-agent-native projects** — canonical `.agents/` → generated `AGENTS.md` + `CLAUDE.md` import + linked `.claude/skills`; modules contribute fragments/skills; prefer-AI for non-deterministic steps | Development is heavily AI-assisted; agent context must be first-class and self-updating. |
| `// saasaloy:managed` in-file markers | **`.saasaloy/manifest.json` hash tracking** | Keeps generated files clean; applies to all managed files, not just agent files. |

---

## <a id="open-questions"></a>6. Open Questions (resolve at implementation time, not before)

Parked deliberately — each is a lower-altitude decision to settle when its feature is actually built.

1. **Email provider** (`email` module) — assume **Resend + React Email** unless a better fit surfaces. Resolve when building `add email`.
2. **`admin` shell scope** — what the base admin app includes (nav, session guard, empty dashboard) before feature modules add pages. Resolve when building `add admin`.
3. **CI / anti-rot testing** — how (and whether) to test each module against *latest* Cloudflare / Better Auth / Stripe on a schedule, so churn is caught before it reaches a project. Resolve alongside Phase 2's update flow.
4. **`saasaloy.json` + `registry-item.json` schemas** — the exact manifest + extension-field schemas (including the `agent` block), drafted as a `$schema`-validated forcing function. Resolve at the start of Phase 1 (it surfaces the real applier design).
5. **Agent-tool targets + Saasaloy's own authoring skills** — confirm each default target's exact conventions (Claude Code `@`-imports + `.claude/skills`, Codex `AGENTS.md`, Antigravity's rules format) when wiring `saasaloy.agent.json`, and define the module-authoring skill set that ships in Saasaloy's own repo. Resolve when building Phase 0's agent layer.

---

## 7. Key risk to keep in view

The premise and the risk are the same object: **the churn that justifies Saasaloy also becomes my maintenance burden.** Every module encodes today's correct wiring, so I now own keeping it current. Mitigations baked into the plan: the base is inert (nothing to rot); churn lives in thin, declarative, copy-in modules that are cheap to patch and AI-friendly to merge; scope is brutally personal-first, so the module surface stays small until the mechanics are proven. If I can't keep modules current faster than re-cloning would cost, the value proposition inverts — so ruthless scope is the standing discipline.
