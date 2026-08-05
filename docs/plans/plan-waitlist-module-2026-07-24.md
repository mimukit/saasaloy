# Plan — `waitlist` feature module (first end-to-end proof)

*Drafted 2026-07-24. Hardened via grillkit 2026-07-24.*

## Context

`waitlist` is the first **feature module** (`saasaloy:feature`) and the first end-to-end proof of the
registry machinery (issue #10, build-spec §2.8): `saasaloy add waitlist` must topo-sort and install
`api` → `database` → `waitlist` behind the confirmation prompt, and a visitor must be able to submit
the form and see the row land in local D1. It proves the **file-drop conventions** the capabilities
established — a Hono sub-app into api's `routes/` glob, a Drizzle table into database's `schema/`
glob — with **zero patches**.

Grilling exposed three conflicts between the issue as written and the codebase, all resolved by
moving platform-layer concerns into the **base template and the api capability** (prerequisite
commits on this same branch) so the feature itself stays a pure file-drop:

1. The base web app was static React-less Astro, but the spec'd `WaitlistForm.tsx` needs React.
   → **React joins the base template** (it will always be needed — ui package, web, admin).
2. Nothing rendered the form, and patching `index.astro` would be fragile and patch-ful.
   → **base `index.astro` gains a sections glob** — a landing-page file-drop extension point
   mirroring api's `routes/` and db's `schema/` globs.
3. `dependencies: ["zod"]` installs to the *root* `package.json`, which pnpm's isolation makes
   un-importable from `apps/api`. → **zod ships with the api capability**; waitlist declares no deps.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Tier | **Feature** (`saasaloy:feature`) — no `scaffolds`, `patches: []`, `dependencies: []`. Pure file-drop; the "no structural patches" acceptance criterion holds. |
| `dependsOn` | **`["api", "database"]`.** The spec's optional `email` is **omitted entirely** — no email module exists and the resolver has no optional-dependency mechanism; half-declaring it would be dishonest. Follow-up issue instead. |
| Base prerequisite — React | React is set up **once, in the base template**, never per-module: `apps/web` gets `@astrojs/react` + `react`/`react-dom` + `react()` in `astro.config.mjs` + JSX tsconfig; `packages/ui` becomes React-ready (react as peer dep). Same branch, own commit(s). |
| Base prerequisite — sections | Base `apps/web/src/pages/index.astro` renders `import.meta.glob('../sections/*.astro', { eager: true })` in **sorted filename order** below the hero. Dropping `sections/<name>.astro` puts content on the landing page with no patch. |
| api prerequisite — zod | `zod` + `@hono/zod-validator` join the **api module's `package.json` template** — validation is as universal to the api as React is to the web. Waitlist's `dependencies: []` stays honest. |
| API route | `files/api/routes/waitlist.ts` → `@api/routes/waitlist.ts`. Hono sub-app default-export (mounts at `/waitlist` via the entry glob). zod-validated `POST /` (email). Inserts via `getDb(c.env.DB)`, typed with `DbBindings` from `@db` — no api-entry edit. |
| CORS | Mounted **route-level** on the waitlist sub-app with Hono's built-in `hono/cors` — the api entry stays untouched, no new dep. Needed because web (`:4321`) and api (`:8787`) are separate origins in dev and prod. |
| DB table | `files/db/schema/waitlist.ts` → `@db/schema/waitlist.ts`. Columns: integer `id` PK, `email` text **unique** not null, `createdAt`. Picked up by both the runtime barrel and drizzle-kit's glob with no edit. |
| Duplicates | **Idempotent success** — on unique-conflict the route returns the same "you're on the list" response. No membership leak, no error state in the form. |
| Web form | `files/web/components/WaitlistForm.tsx` → `@web/components/WaitlistForm.tsx`. React island; posts to `${import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787"}/waitlist`. Client-side validation is native HTML (`type="email"`, `required`) — zod stays server-side. |
| Landing embed | `files/web/sections/waitlist.astro` → `@web/sections/waitlist.astro`, rendering `<WaitlistForm client:load />` — appears on `/` via the base sections glob. No orphan `/waitlist` page, no patch. |
| `envVars` | `{ "PUBLIC_API_URL": "…" }` — surfaced by `add`'s needed-env notice (the mechanism is display-only; no `.env` is written). Dev needs nothing (localhost fallback); production sets it at web build time. |
| Migrations | **Manual, per the database convention**: the skill documents `db:generate` → `db:migrate:local` after install. The module ships **no pre-generated SQL** — drizzle-kit generates from the dropped table. |
| Agent context | `skills/saasaloy-waitlist/SKILL.md` — the route/table/section drop map, the migration flow, `PUBLIC_API_URL`, duplicate semantics. Installed per convention (`.agents/skills/` + `.claude/skills` symlink), listed in `agent.skills`. |
| CLI changes | **None.** The applier (#6–#9) already handles everything waitlist needs. |
| Acceptance / DoD | In `.dev/`: `saasaloy add waitlist` resolves + installs `api` → `database` → `waitlist` behind the prompt; migrations generated + applied; visitor submits the landing-page form; row lands in local D1; duplicate submit returns success without a second row. Manual QA doc in `docs/qa` (like the database module). |

## Approach

### Phase 1 — Base template: React + sections (prerequisite commit)
- `apps/web`: add `@astrojs/react`, `react`, `react-dom`; `react()` in `astro.config.mjs`
  integrations; JSX settings in tsconfig.
- `packages/ui`: react as peer dep + JSX tsconfig, so shared components can be `.tsx`.
- `apps/web/src/pages/index.astro`: render the sorted `../sections/*.astro` glob (empty-safe —
  base ships no sections).

### Phase 2 — api module: validation stack (prerequisite commit)
- Add pinned `zod` + `@hono/zod-validator` to `modules/api/files/package.json`.

### Phase 3 — The `waitlist` module (`modules/waitlist/`)
- `registry-item.json`: `type: "saasaloy:feature"`, `dependsOn: ["api", "database"]`,
  `dependencies: []`, `patches: []`, the four `files[]` entries (alias targets), `envVars`
  with `PUBLIC_API_URL`, `agent.skills: ["skills/saasaloy-waitlist"]`. Validate via
  `validateRegistryItem`.
- `files/api/routes/waitlist.ts`, `files/db/schema/waitlist.ts`,
  `files/web/components/WaitlistForm.tsx`, `files/web/sections/waitlist.astro` per the table above.
- `skills/saasaloy-waitlist/SKILL.md`.

### Phase 4 — Prove end-to-end in `.dev/`
- Fresh `saasaloy init` project → `saasaloy add waitlist` → confirm the resolved chain and prompt.
- `db:generate` + `db:migrate:local`; run api + web dev servers; submit the form on `/`;
  verify the row in D1; re-submit the same email → success, still one row.
- Write the manual QA doc in `docs/qa` and sign off.

## Follow-up issues (to file)

- **Workspace-scoped dependency installs** — `dependencies[]` merges only into the root
  `package.json`, which pnpm isolation makes useless for workspace imports. Needs a target syntax
  or a package-json patch kind.
- **Optional `dependsOn`** — the spec §2.7 `email optional — skip? [Y/n]` prompt has no schema or
  resolver support; needed before `email` integration lands.

## Non-goals

- **`email` integration** — no email module exists; waitlist gains it later via the optional-deps
  mechanism above.
- **CLI/applier changes** — nothing in waitlist requires them.
- **Remote/edge deploy** — the proof is local D1, mirroring the api/database modules' deferred
  remote story.
- **`remove`/reverse flows** — owned by #27.
