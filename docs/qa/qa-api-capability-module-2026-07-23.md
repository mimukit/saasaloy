# QA Plan: `api` capability module (issue #8)

_Generated 2026-07-23 · covers the uncommitted `api` capability module + the three module-authoring conventions (ADR 0013 deps/scaffolds split, ADR 0014 `saasaloy-` skill prefix)_

## Summary
- Authors the `api` capability module: a descriptor (`modules/api/registry-item.json`), the `apps/api` scaffold files it births (Hono on Cloudflare Workers, built with Vite + `@cloudflare/vite-plugin`, file-based route auto-registration), and a `saasaloy-api` skill runbook.
- "Working" means: the scaffold boots on the real `workerd` runtime locally, `GET /health` is green, a dropped `routes/*.ts` auto-registers with no entry edit — and the descriptor + convention docs are internally consistent and reviewer-legible.

## Preconditions
- Branch: `issue-8-api-capability-module` (the `api` module is committed; QA runs against this worktree).
- Node + `corepack` available; `pnpm 11` via corepack (repo convention — do not use a global `pnpm`).
- Workspace deps installed at repo root (`corepack pnpm install`), so `ajv` and the CLI build resolve.

### Exercise the module through a real local `add` (descriptor + skill)

Use the worktree-safe playground (see `CONTRIBUTING.md` → _Manual QA_). It runs **this** worktree's freshly-built CLI against **this** worktree's `modules/` via `SAASALOY_REGISTRY_DIR`, so `list`/`add` resolve the uncommitted-or-local `api` descriptor with no publish step:

```sh
pnpm cli:dev            # terminal 1: rebuild the CLI on change — leave running
pnpm play:init          # scaffold .dev/playground + drop the ./saasaloy shim (no install)
cd .dev/playground
./saasaloy list         # api should appear (proves descriptor loads from local modules/)
./saasaloy add api -y   # scaffolds apps/api + applies the saasaloy-api skill into .claude/skills/
```

This stands up the whole `apps/api` workspace: `add api` copies the six scaffold files, registers `@api → apps/api/src` into `saasaloy.json`, and records everything in `.saasaloy/manifest.json` (scaffold applier — issue #8). `api` declares no `patches`, so no deferral notice appears. The scaffolded `package.json`/`tsconfig.json` extend `@repo/tsconfig`, which the base template now ships (`packages/tsconfig`), so the workspace installs and boots directly — no throwaway harness needed.

### Stand up the `apps/api` runtime (worker DoD — TC-1/TC-2/TC-3)

Because `add api` scaffolds a real, installable `apps/api` and the base ships the `@repo/tsconfig` package it extends, the worker boots straight from the playground. From `.dev/playground` (after the `add api` above):

```sh
# The scaffolded api pins very recent Cloudflare deps (workerd, wrangler, workers-types);
# override the 3-day supply-chain cooldown for this throwaway QA install.
corepack pnpm install --config.minimumReleaseAge=0

# `pnpm dev` re-runs pnpm's supply-chain pre-check (which those recent deps trip), so launch
# vite directly to skip it and boot the Worker on the real workerd runtime:
cd apps/api && node_modules/.bin/vite dev
```

Note the port it prints (5173, or the next free port such as 5175).

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | `GET /health` is green in a browser on real `workerd` | 🔴 Critical |
| TC-2 | A dropped `routes/*.ts` auto-registers with no entry edit | 🔴 Critical |
| TC-3 | The mount-relative path rule behaves as the runbook claims | 🟡 Normal |
| TC-4 | `saasaloy-api` skill runbook is followable by a developer | 🟡 Normal |
| TC-5 | ADR 0013 + ADR 0014 read coherently to a reviewer | 🟡 Normal |
| TC-6 | `create-module` guidance is self-consistent after the edits | 🟢 Low |

## Test cases

### TC-1 — `GET /health` is green in a browser on real `workerd`  ·  🔴 Critical
**Steps**
1. With the Worker running (see Preconditions), open the printed URL in a browser, e.g. `http://localhost:5175/health`.
2. Observe the response body and status.

**Expected**
- Body is exactly `{"status":"ok"}`.
- HTTP status is 200.
- The terminal running `vite dev` shows it serving on the `workerd` runtime (not a Node server).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — A dropped `routes/*.ts` auto-registers with no entry edit  ·  🔴 Critical
**Steps**
1. Keep the Worker running. Do **not** edit `src/index.ts`.
2. Create a new file `.dev/playground/apps/api/src/routes/ping.ts` with a Hono sub-app that returns `{"pong":true}` at `/`:

```sh
printf 'import { Hono } from "hono";\nconst ping = new Hono();\nping.get("/", (c) => c.json({ pong: true }));\nexport default ping;\n' > .dev/playground/apps/api/src/routes/ping.ts
```

3. In the browser, load `http://localhost:5175/ping` (adjust the port to match).
4. Confirm you never touched `src/index.ts` (its file mtime / editor tab is unchanged).

**Expected**
- `GET /ping` returns `{"pong":true}` with status 200.
- `GET /health` still returns `{"status":"ok"}` (the first route is unaffected).
- `src/index.ts` was not opened or edited — the new route appeared purely from the file drop.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — The mount-relative path rule behaves as the runbook claims  ·  🟡 Normal
**Steps**
1. Edit `.dev/playground/apps/api/src/routes/ping.ts` and change the handler path from `"/"` to `"/ping"` (the mistake the runbook warns about).
2. Reload `http://localhost:5175/ping` in the browser.
3. Then load `http://localhost:5175/ping/ping`.

**Expected**
- `GET /ping` now returns 404 (the handler no longer matches the mount root).
- `GET /ping/ping` returns `{"pong":true}` — proving paths are relative to the `/ping` mount, exactly as the `saasaloy-api` runbook's "double prefix" warning describes.
- Revert the file to `"/"` afterward and confirm `GET /ping` is green again.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — `saasaloy-api` skill runbook is followable by a developer  ·  🟡 Normal
**Steps**
1. Open `modules/api/skills/saasaloy-api/SKILL.md`.
2. Read it as if you were a developer new to the project who must add a route and wire a binding.

**Expected**
- The "Add a route" steps are unambiguous — a reader could add a working route without further help.
- The mount-relative rule, the `c.env` (never `process.env`) binding rule, and "deploy is the future `infra` module's job" are all stated and clear.
- The frontmatter `name:` is `saasaloy-api` (prefixed), matching the folder — no stray bare `api` references that would mislead.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — ADR 0013 + ADR 0014 read coherently to a reviewer  ·  🟡 Normal
**Steps**
1. Read `docs/adr/adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md`.
2. Read `docs/adr/adr-0014-saasaloy-prefixed-module-skill-names-2026-07-23.md`.
3. Cross-check each ADR's decision against the actual `modules/api/` artifact.

**Expected**
- ADR 0013's two rules (deps one-source-of-truth-per-workspace; `scaffolds[]` births a workspace vs `files[]` drops into one) match what the `api` descriptor actually does (`dependencies: []`, deps in the scaffolded `package.json`, populated `scaffolds[]`, empty `files[]`).
- ADR 0014's rule (`saasaloy-<module>` skill name) matches the shipped `skills/saasaloy-api/` folder and its frontmatter.
- The "Considered Options" / rejected alternatives in each read as genuine trade-offs, not filler.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — `create-module` guidance is self-consistent after the edits  ·  🟢 Low
**Steps**
1. Read `.agents/skills/create-module/SKILL.md` end to end.
2. Watch for internal contradictions introduced by the deps/scaffolds and `saasaloy-` prefix edits.

**Expected**
- Every skill-path example uses the `saasaloy-<name>` form (module tree, waitlist example, Step 4, checklist) — no lingering bare `skills/<name>`.
- The deps convention (capability owns its `package.json`; feature uses `dependencies[]`) reads consistently across the field note, Step 2 example, and checklist.
- No step references the removed/renamed artifacts as if they still exist.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [ ] CLI test suite still passes (see Automated verification — 49 tests).
- [ ] `registry-item.json` still validates against `registry-item.schema.json` (see Automated verification).
- [ ] The build-spec §3.3 and schema `registry-item.example.json` examples still parse and now show the `saasaloy-`-prefixed skill path.
- [ ] No unrelated files changed — the diff is confined to the `api` module, its docs, and the convention docs.

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run (grouped where related):

```sh
pnpm --filter saasaloy test   # applier + schema unit tests
node -e '/* ajv 2020 compile of registry-item.schema.json against modules/api/registry-item.json */'
grep -m1 "^name:" modules/api/skills/saasaloy-api/SKILL.md
grep compatibility_date modules/api/files/wrangler.jsonc
# real end-to-end add → install → boot in .dev/playground:
pnpm run play:reset
(cd .dev/playground && SAASALOY_REGISTRY_DIR=…/modules ./saasaloy add api -y)
(cd .dev/playground && corepack pnpm install --config.minimumReleaseAge=0)
(cd .dev/playground/apps/api && node_modules/.bin/vite dev)   # → workerd runtime
# probes via node fetch:
fetch /health ; (drop routes/ping.ts) ; fetch /ping
```

- ✅ `pnpm --filter saasaloy test` → **7 files, 49 tests, all passed** (10 new in `applier.test.ts` cover scaffold planning, alias registration, same-run alias resolution, and conflict hold-back).
- ✅ Schema validation → `registry-item.json` **VALID** against the tightened `scaffolds` schema; `agent.skills = ["skills/saasaloy-api"]`, `dependsOn = []`.
- ✅ Shipped skill frontmatter → `name: saasaloy-api` (folder `skills/saasaloy-api/` matches).
- ✅ **Scaffold applier** → `./saasaloy add api -y` created `apps/api/{package.json,tsconfig.json,wrangler.jsonc,vite.config.ts,src/index.ts,src/routes/health.ts}`, registered `@api → apps/api/src` in `saasaloy.json`, and recorded all seven files (incl. the skill) in `.saasaloy/manifest.json`. A second `add api` (no `--force`) correctly no-ops.
- ✅ Real install + boot → the base now ships `@repo/tsconfig`, so `pnpm install` resolved the scaffolded workspace and `vite dev` came up on the real `workerd` runtime (vite v8.1.5). No `.dev/` harness needed.
- ✅ **DoD criterion 1** → `GET /health → 200 {"status":"ok"}` on `workerd`.
- ✅ **DoD criterion 2** → dropped `src/routes/ping.ts` with no edit to `src/index.ts` → `GET /ping → 200 {"pong":true}`; `GET /health` still `200 {"status":"ok"}`. Auto-registration proven end-to-end from a real `add`.
- ✅ Stale-reference scan → the only remaining bare `skills/api` string is inside ADR 0014, which intentionally documents the `skills/api/ → skills/saasaloy-api/` rename.

## Not covered / needs human judgment
- **Real edge `wrangler deploy`** — deliberately out of scope; deployment is the future `infra` capability's job (issue #29). The DoD is local `workerd` only.
- **End-to-end `add` → `pnpm install` → boot** — now **covered** (see Automated verification): the scaffold applier lands `apps/api`, the base ships the `@repo/tsconfig` it extends, `pnpm install` discovers the new workspace via the `apps/*` glob (so `patches` stays empty), and the Worker boots green on `workerd`. Retained here only as a note that a tester can reproduce it from `.dev/playground`.
- **Prose quality / reviewer legibility** of the runbook and ADRs (TC-4/5/6) — inherently a human read; the agent can confirm consistency of paths and names but not whether the guidance actually *teaches*.
- **`.claude/skills/` collision avoidance in a real consumer** — ADR 0014's core motivation (a `saasaloy-api` skill not clobbering a user's own `api` skill) can only be fully observed once the applier copies skills into a real project.
