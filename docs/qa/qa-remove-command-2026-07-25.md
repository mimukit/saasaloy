# QA Plan: `saasaloy remove` (undo applied files via manifest)

_Generated 2026-07-25 · covers issue #27 (388e270, 89b6499, e4e8ed8): new `lib/remover.ts` +
`commands/remove.ts`, plus manifest patch-tracking on the `add` side
(`lib/manifest.ts`, `lib/applier.ts`, `schemas/manifest.schema.json`)_

## Summary

`saasaloy remove <module>` is the offline undo for `add`: it deletes exactly the files
`.saasaloy/manifest.json` attributes to a module, protects anything hand-edited since,
reconciles `saasaloy.json`/`saasaloy-lock.json`/the manifest, prunes emptied directories,
drops dangling aliases, and warns (never reverses) about config patches the module applied
elsewhere. "Working" means: a real `add` → `remove` round trip leaves the project exactly
as if the module was never installed, drift and dependents are never silently destroyed,
and `--dry-run`/`--diff` never write.

This plan covers the **human-only** parts — the interactive confirm prompts, the picker,
Ctrl-C handling, and visual legibility of the clack TUI. The deterministic file/manifest/
lock/prune/alias/patch behavior was driven end-to-end by the agent (via `--yes`/`--force`,
which never prompt) against the repo's real `api`/`database` modules and is recorded under
**Automated verification**.

## Why `api` + `database` as the fixtures

Two real, committed modules already give full coverage without a throwaway registry:
`database` (`modules/database/registry-item.json`) `dependsOn: ["api"]` and patches
`apps/api/wrangler.jsonc` (a `wrangler-binding`) that `api` itself owns. That one pair
exercises dependents-refusal, patch-recording/warning, and the prune/alias-drop chain
across two workspaces (`apps/api`, `packages/db`) in one flow.

## Preconditions

- Node ≥ 24, pnpm 11, this branch checked out.
- Build the CLI, then scaffold a fresh `.dev/playground` pointed at the repo's own
  `modules/` registry (the `saasaloy` shim sets `SAASALOY_REGISTRY_DIR` for you):

```sh
pnpm --filter saasaloy build
pnpm run play:reset
```

- Run every case from inside the playground:

```sh
cd .dev/playground
```

- To reset between test cases, re-run from the repo root:

```sh
pnpm run play:reset
```

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Round-trip `add database` → `remove database` → `remove api`, interactive accept | 🔴 Critical |
| TC-2 | Unmanaged files survive; pruning stops at the first non-empty ancestor | 🔴 Critical |
| TC-3 | Drift — decline the confirm, hand-edited file survives untracked | 🔴 Critical |
| TC-4 | Drift — accept the confirm, hand-edited file is deleted anyway | 🟡 Normal |
| TC-5 | Dependents refusal blocks `remove api`; `--force` overrides with a warning | 🔴 Critical |
| TC-6 | Config patch recorded on `add`, dropped + warned (not reversed) on `remove database` | 🔴 Critical |
| TC-7 | A patched file classifies as drift when its *owning* module is removed | 🟡 Normal |
| TC-8 | `--dry-run` / `--diff` preview identically, write nothing | 🟡 Normal |
| TC-9 | Bare `remove` picker + Ctrl-C cancels cleanly | 🟢 Low |

## Test cases

### TC-1 — Round-trip `add database` → `remove database` → `remove api`, interactive  ·  🔴 Critical
**Steps**
1. From a fresh playground, install both (accept the confirm prompt when it appears):

```sh
./saasaloy add database
```

2. Confirm both modules are installed and the D1 binding was patched:

```sh
cat saasaloy.json && echo --- && cat apps/api/wrangler.jsonc
```

3. Remove `database` first (accept the `Proceed?` prompt):

```sh
./saasaloy remove database
```

4. Then remove `api`:

```sh
./saasaloy remove api
```

**Expected**
- Step 1: a `Proceed?` prompt appears after the plan; accepting applies 15 files, links
  two skills, patches `apps/api/wrangler.jsonc`, registers `@api`/`@db`, and ends
  `Applied api, database (15 files)`.
- Step 3: prompt shows a `Plan` box (8 files, all `delete`), a warning that the
  `wrangler.jsonc` patch isn't reversed; accepting deletes `packages/db/**`, unlinks the
  skill, prunes `packages/db` entirely, drops the `@db` alias, ends
  `Removed database (8 files)`.
- Step 4: `api`'s own files delete cleanly and its skill link/dirs prune; the `@api` alias
  drops too since `apps/api/src` is now gone (see TC-7 for the one file that survives).
- After both removals: `saasaloy.json` `installed` is back to `["web"]` only, no
  `@api`/`@db` aliases remain, `saasaloy-lock.json.modules` is empty, and
  `.saasaloy/manifest.json` has empty `managed`/`links`/`patches`.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — Unmanaged files survive; pruning stops at the first non-empty ancestor  ·  🔴 Critical
**Steps**
1. `add api` (accept), then drop an unrelated file into its scaffolded workspace:

```sh
./saasaloy add api --yes
echo "my scratch notes" > apps/api/notes.txt
```

2. Remove it:

```sh
./saasaloy remove api --yes
```

3. Inspect what's left:

```sh
find apps/api -type f
```

**Expected**
- Only the 6 manifest-managed files under `apps/api` (`package.json`, `tsconfig.json`,
  `wrangler.jsonc`, `vite.config.ts`, `src/index.ts`, `src/routes/health.ts`) are deleted;
  `notes.txt` is **untouched** — the manifest never attributed it to `api`.
- Because `apps/api` is non-empty (`notes.txt` remains), pruning stops there — no `prune
  apps/api` log line — while `apps/api/src/routes` (now empty) **does** prune.
- `find apps/api -type f` shows only `apps/api/notes.txt`.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — Drift — decline the confirm, hand-edited file survives  ·  🔴 Critical
**Steps**
1. `add api --yes`, then hand-edit a managed file:

```sh
./saasaloy add api --yes
echo "// hand edit" >> apps/api/src/index.ts
```

2. Remove interactively (no `--yes`):

```sh
./saasaloy remove api
```

3. At the per-file prompt `apps/api/src/index.ts was hand-edited since it was applied —
   delete it anyway?`, answer **No**.
4. At the final `Proceed?` prompt, answer **Yes**.
5. Check the file survived:

```sh
cat apps/api/src/index.ts
```

**Expected**
- The plan box tags `apps/api/src/index.ts` as `drift → confirm` (yellow).
- Declining the per-file prompt does **not** abort the whole run — the other 6 files still
  delete, the skill unlinks, and dirs prune.
- The run ends with a `Drift survivors` note listing `apps/api/src/index.ts` ("Hand-edited
  since — left on disk, now untracked") and exits **0** (`Removed api (6 files)`)  — this is
  the designed outcome, not a failure.
- `cat` still shows the hand-edited content — the file was never touched.
- `apps/api` itself is **not** pruned (it still contains `src/index.ts`); `@api` alias is
  **not** dropped (its prefix dir still exists).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — Drift — accept the confirm, hand-edited file deleted anyway  ·  🟡 Normal
**Steps**
1. Repeat steps 1–3 of TC-3, but at the per-file drift prompt answer **Yes** this time, then
   **Yes** again at `Proceed?`.
2. Check the file is gone:

```sh
ls apps/api/src/index.ts 2>&1
```

**Expected**
- No `Drift survivors` note this time — all 7 files report deleted, `apps/api` prunes
  entirely, `@api` alias drops.
- `ls` reports the file no longer exists.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-5 — Dependents refusal blocks `remove api`; `--force` overrides  ·  🔴 Critical
**Steps**
1. `add database --yes` (pulls in `api` automatically).
2. Try removing `api` while `database` still depends on it:

```sh
./saasaloy remove api --yes
echo "exit=$?"
```

3. Now force it:

```sh
./saasaloy remove api --yes --force
echo "exit=$?"
```

**Expected**
- Step 2: cancels immediately with `api is still depended on by database — refusing (use
  --force to remove it anyway).`, **exit 1**, nothing on disk changes (`apps/api/**` and
  `saasaloy.json` untouched).
- Step 3: proceeds, logging a warning `api is still depended on by database — proceeding
  anyway (--force).`, deletes `api`'s files, and **exit 0**. (Note: `database`'s own files
  are untouched by this — only `api` is removed; `database` is left installed but now
  depends on a module that's gone, which is the documented cost of `--force`.)

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-6 — Config patch recorded on `add`, dropped + warned on `remove`  ·  🔴 Critical
**Steps**
1. `add database --yes`, then inspect the manifest's patch record:

```sh
cat .saasaloy/manifest.json | python3 -m json.tool | grep -A6 '"patches"'
```

2. Remove `database` and read the warning:

```sh
./saasaloy remove database --yes
```

3. Confirm the binding is still in place (never reversed) and the manifest entry is gone:

```sh
cat apps/api/wrangler.jsonc
cat .saasaloy/manifest.json | python3 -m json.tool | grep -A3 '"patches"'
```

**Expected**
- Step 1: `manifest.patches` has one entry — `module: "database"`, `file:
  "apps/api/wrangler.jsonc"`, `patch.kind: "wrangler-binding"`.
- Step 2: a warning `Config patch on apps/api/wrangler.jsonc (wrangler-binding) is not
  reversed by \`remove\` — hand-revert it if needed.` is printed before the deletions.
- Step 3: the `d1_databases` binding is **still present** in `wrangler.jsonc` (untouched
  content) — `remove` only untracks the patch, it never reverts it. `manifest.patches` is
  now `[]`.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-7 — A patched file classifies as drift when its owning module is removed  ·  🟡 Normal
**Steps**
1. `add database --yes` (patches `apps/api/wrangler.jsonc`, owned by `api`).
2. Remove `database` first, then remove `api`:

```sh
./saasaloy remove database --yes
./saasaloy remove api --yes
```

3. Check the outcome:

```sh
find apps/api -type f
cat apps/api/wrangler.jsonc
```

**Expected**
- Removing `api` reports `wrangler.jsonc` as a **drift survivor**, not a clean delete —
  because `database`'s earlier patch changed the file's on-disk hash away from what `api`
  originally wrote, so it now looks hand-edited from `api`'s point of view.
- `apps/api/wrangler.jsonc` survives on disk (still has the D1 binding, now fully
  untracked); `apps/api` itself is **not** pruned because that file remains.
- This is expected behavior, not a bug — flag it as a **fail** only if the file gets
  silently deleted, or if no drift warning is shown at all.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-8 — `--dry-run` / `--diff` preview identically, write nothing  ·  🟡 Normal
**Steps**
1. `add api --yes`, then preview removal both ways:

```sh
./saasaloy remove api --dry-run
./saasaloy remove api --diff
```

2. After both, confirm nothing changed:

```sh
git status --short apps/api 2>/dev/null; ls apps/api/src/index.ts
```

**Expected**
- `--dry-run` shows the same `Plan` box as a real run (7 files tagged `delete`), then ends
  `dry run — nothing removed` — no file/log-step output for actual deletions.
- `--diff` shows the same plan, then one titled box per file with an **all-red** unified
  diff (every line prefixed `-`), then ends `diff only — nothing removed`.
- Neither command deletes, unlinks, prunes, or edits `saasaloy.json`/lock/manifest —
  `apps/api/src/index.ts` still exists after both runs.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-9 — Bare `remove` picker + Ctrl-C cancels cleanly  ·  🟢 Low
**Steps**
1. `add api --yes`, then run with no module name:

```sh
./saasaloy remove
```

2. Confirm the picker lists `api` (and any other installed modules), then press **Ctrl-C**.
3. Run it again, this time select `api` and let it reach the `Proceed?` prompt, then press
   **Ctrl-C** there too.

**Expected**
- Step 2: a `select` prompt appears titled "Pick a module to remove" listing installed
  modules; Ctrl-C ends with a clean `remove cancelled` message (no raw stack trace), exit 1,
  nothing on disk changes.
- Step 3: same clean cancellation from the later `Proceed?` prompt; nothing is deleted or
  reconciled (recheck `saasaloy.json` still lists `api`).

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [ ] `saasaloy add` still applies cleanly and records `patches` correctly for a module with
      no patches (`api` alone) — empty `patches: []`, no spurious warnings.
- [ ] `saasaloy --help` / command list includes `remove — undo a module's applied files via
      the manifest (offline)`.
- [ ] `saasaloy remove <name-not-installed>` fails with `<name> isn't installed — nothing to
      remove.`, exit 1, nothing changes.
- [ ] `saasaloy remove api --bogus-flag` is rejected: `Unknown argument(s): --bogus-flag —
      usage: ...`, exit 1, before touching disk.
- [ ] A pre-existing `.saasaloy/manifest.json` written before this change (no `patches` key)
      still loads and `remove` runs against it without crashing (see Automated verification).

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
pnpm --filter saasaloy-cli test
```

```sh
pnpm --filter saasaloy-cli typecheck
```

```sh
pnpm --filter saasaloy build
```

End-to-end, in `.dev/playground` (built CLI against the repo's real `modules/api` +
`modules/database`, via the `saasaloy` shim — fully offline, no network):

```sh
./saasaloy add database --yes --diff   # plan + diff preview
./saasaloy add database --yes          # apply: pulls api, patches wrangler.jsonc
./saasaloy remove api --yes            # expect: refused, database depends on it
./saasaloy remove database --dry-run   # preview only
./saasaloy remove database --yes       # apply: clean delete + prune + alias drop + patch warning
./saasaloy remove api --yes            # apply: clean delete except drifted wrangler.jsonc
./saasaloy remove nonexistent --yes    # unknown module
./saasaloy remove api --bogus          # unknown flag
```

- ✅ `pnpm --filter saasaloy-cli test` → **9 test files, 100 tests, all passed** (includes
  `remover.test.ts` — 24 tests — and `applier.test.ts` — 31 tests, covering the new patch
  dedupe/recording behavior).
- ✅ `pnpm --filter saasaloy-cli typecheck` → `tsc --noEmit`, 0 errors.
- ✅ `pnpm --filter saasaloy build` → tsup ESM build succeeds.
- ✅ `add database --yes` → 15 files created (`api` + `database`), `Aliases registered:
  @api → apps/api/src, @db → packages/db/src`, skill links created, `Config patches: 
  apps/api/wrangler.jsonc — wrangler-binding` noted; manifest `patches` has one entry
  (`module: "database"`, `file: "apps/api/wrangler.jsonc"`, `patch.kind:
  "wrangler-binding"`).
- ✅ `remove api --yes` while `database` installed → refused: `api is still depended on by
  database — refusing (use --force to remove it anyway).`, **exit 1**, nothing changed.
- ✅ `remove database --dry-run` → plan shows 8 files `delete`, 0 drift, 0 missing; warns
  `Installed module web has no lock entry — dependent detection is incomplete for it.`
  (expected — `web` is the base scaffold, not a registry module) and warns the wrangler
  patch isn't reversed; ends `dry run — nothing removed`; disk unchanged.
- ✅ `remove database --yes` (real) → deletes 8 files, unlinks
  `.claude/skills/saasaloy-database`, prunes `packages/db/src/schema`,
  `packages/db/src/repositories`, `packages/db/src`, `packages/db`,
  `.agents/skills/saasaloy-database`; drops the `@db` alias
  (`Alias @db dropped — its target directory is gone.`); `apps/api/wrangler.jsonc` is
  **untouched** (`d1_databases` binding still present) — confirmed not reversed;
  `saasaloy.json.installed` → `["web", "api"]`; `saasaloy-lock.json.modules` → `{api: ...}`
  only; `manifest.patches` → `[]`.
- ✅ `remove api --yes` (now that `database` is gone) → deletes 6 files, unlinks
  `.claude/skills/saasaloy-api`, prunes `apps/api/src/routes`, `apps/api/src`,
  `.agents/skills/saasaloy-api`, `.agents/skills`, `.agents`, `.claude/skills`, `.claude`;
  drops the `@api` alias — **but** `apps/api/wrangler.jsonc` reports as a **drift
  survivor** (its hash no longer matches what `api` wrote, because `database`'s earlier
  patch changed it), so `apps/api` itself is **not** pruned. This is the correct, designed
  interaction (see TC-7) — confirmed intentional by re-reading `buildRemovePlan`'s
  hash-based classification, not a bug.
- ✅ Unmanaged-file / prune-boundary check: created `apps/api/notes.txt` (untracked) before
  `remove api --yes` → only the 6 manifest-managed files under `apps/api` were deleted,
  `notes.txt` survived untouched, and `apps/api` (non-empty) was correctly **not** pruned
  while `apps/api/src/routes` (now empty) **was**.
- ✅ Hand-edit drift check: appended a line to `apps/api/src/index.ts`, then
  `remove api --yes` → `index.ts` reported as a drift survivor, untracked, left on disk
  with the hand-edit intact; the other 6 files deleted normally; `@api` alias **not**
  dropped (prefix dir still exists because of the surviving file).
- ✅ `remove nonexistent --yes` → `nonexistent isn't installed — nothing to remove.`,
  exit 1.
- ✅ `remove api --bogus` → `Unknown argument(s): --bogus — usage:
  saasaloy remove [<module>] [--dry-run] [--diff] [--yes] [--force].`, exit 1.
- ✅ Backward-compat check: stripped the `patches` key from a real
  `.saasaloy/manifest.json` (simulating a manifest written before this change) → `remove`
  still ran cleanly against it (loader defaults `patches` to `[]`), no crash.

## Not covered / needs human judgment
- **Interactive confirm prompts** (per-file drift confirm, final `Proceed?`, the bare-`remove`
  `select` picker, Ctrl-C) — the agent only drove non-interactive `--yes`/`--force` paths;
  TC-1, TC-3, TC-4, TC-9 need a human at a real TTY.
- **Visual legibility** of the clack boxes — plan/links/warnings note formatting, drift
  labels (yellow `drift → confirm` vs `drift → kept (untracked)` under `--yes`), the
  `Drift survivors` note, and the red `--diff` deletion boxes — a machine confirms the
  strings, not whether they read well in a terminal.
- **Cascade / multi-module removal** is explicitly out of scope for this issue (see the
  plan's Non-goals) — not tested here because it isn't a supported flow.
- **Reversing config patches** is a follow-up issue (#36) — `remove` is only expected to
  warn, never revert, which is what TC-6/TC-7 check.
- **npm dependency removal** from the root `package.json` is a non-goal for `remove` (not
  derivable offline) — not tested here.
