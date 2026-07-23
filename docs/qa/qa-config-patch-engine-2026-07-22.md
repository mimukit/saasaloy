# QA Plan: config-patch engine — magicast + jsonc-parser (issue #7)

_Generated 2026-07-22 · covers the uncommitted work on branch `issue-7-config-patch-engine-magicast-jsonc`: the new `packages/cli/src/lib/patch/` module (`diff.ts`, `jsonc.ts`, `ts-module.ts`, `index.ts` + their `*.test.ts`), the Vitest wiring (`vitest.config.ts`, `test` script), and the `magicast`/`jsonc-parser`/`diff` + `vitest` dependency adds._

## Summary
The config-patch engine is the ~10% of module application that isn't a pure file-drop: small AST codemods the applier (#6) will invoke for structural edits. `upsertWranglerBinding` uses **`jsonc-parser`** to insert `wrangler.jsonc` bindings/routes (comment- and indentation-preserving); `insertIntoPluginArray` uses **`magicast`** to push a factory call (e.g. `stripe()`) into a config array like Better Auth's `plugins` and add its import; `applyPatch` unifies both behind a pure `{ content, changed, diff }` result. "Working" means: each codemod is **idempotent** (re-run is a no-op), **never clobbers** an existing entry, and is **formatting-safe** — and every patch surfaces a readable unified diff for a `--dry-run`/`--diff` preview.

This engine is **almost entirely machine-verifiable** — 17 Vitest cases plus a scripted end-to-end driver cover idempotency, never-clobber, array creation, import de-dup, and diff output; all were run by the agent and are recorded under [Automated verification](#automated-verification-by-ai-agent). The engine has **no CLI entry point yet** (it's a library for #6), so there is no interactive flow to click through. What genuinely needs a **human eye** is the judgment the tests can't make on their clean fixtures: does the codemod output *look right* on a realistically messy file, and is the produced diff something a reviewer would trust in a preview? Those are the manual cases below.

## Preconditions
- Node ≥ 24, pnpm 11, this repo checked out on branch `issue-7-config-patch-engine-magicast-jsonc` with the uncommitted changes present.
- Install deps (adds `magicast`, `jsonc-parser`, `diff`, `vitest`):

```sh
pnpm install
```

- The engine has no `dist` entry of its own, so the manual cases use a small pre-built driver that bundles the engine and exercises it against **deliberately messy** inputs (tab indentation, comments, an existing binding/plugin). Build the bundle and run it from the repo root:

```sh
npx esbuild packages/cli/src/lib/patch/index.ts --bundle --platform=node --format=cjs --target=node24 --main-fields=module,main --outfile=.dev/patch-demo/patch-engine.cjs
node .dev/patch-demo/demo.cjs
```

- The driver (`/.dev/patch-demo/demo.cjs`, gitignored) prints, for each codemod: the patched file, its unified diff, and the result of re-running the same patch. Read its output for TC-1 through TC-4. `.dev/` is gitignored, so nothing here pollutes the repo.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | `wrangler.jsonc` codemod preserves tabs + comments while appending | 🔴 Critical |
| TC-2 | `magicast` plugin-array codemod leaves existing code intact | 🔴 Critical |
| TC-3 | Unified diff is minimal and reviewable in a dry-run preview | 🟡 Normal |
| TC-4 | Import brace-spacing + trailing-newline formatting judgment | 🟡 Normal |
| TC-5 | Engine output is something you'd commit without hand-editing | 🟢 Low |

## Test cases

### TC-1 — `wrangler.jsonc` codemod preserves tabs + comments while appending  ·  🔴 Critical
The engine's promise is that it edits *only the touched region* and never strips the comments Cloudflare configs rely on. The unit tests use a 2-space fixture; here you judge a **tab-indented, commented** file by eye.

**Steps**
1. Run the driver (see Preconditions).
2. Read the first block, `wrangler: add a NEW kv_namespaces binding`.

**Expected:** The printed file keeps the `// Cloudflare Worker for the API` comment and the original **tab** indentation; the existing `d1_databases` entry (`DB` / `app-db`) is untouched; a new `kv_namespaces` array with `CACHE` is appended, tab-indented to match the file. `changed: true`.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-2 — `magicast` plugin-array codemod leaves existing code intact  ·  🔴 Critical
Formatting-safety for the TS/JS path: pushing `stripe()` into `plugins` must not disturb the rest of the `betterAuth({...})` config.

**Steps**
1. In the driver output, read the block `auth.ts: push stripe() into the plugins array + add its import`.

**Expected:** `database: db` and `organization()` are preserved exactly; `plugins` becomes `[organization(), stripe()]`; a `stripe` import from `@better-auth/stripe` is added; the 2-space indentation of the object body is unchanged. `changed: true`.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — Unified diff is minimal and reviewable in a dry-run preview  ·  🟡 Normal
Every patch is `--dry-run`/`--diff`-able; the diff is what a human approves before the applier writes. Judge that it reads as a **tight, obvious** change, not a whole-file rewrite.

**Steps**
1. In the driver output, read the `--- diff ---` blocks under both the wrangler and the auth cases.

**Expected:** Each diff shows only the inserted lines as `+` (plus a few unchanged context lines), carries the correct filename header (`wrangler.jsonc`, `auth.ts`), and contains no spurious reformatting of untouched lines. A reviewer could approve it at a glance.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-4 — Import brace-spacing + trailing-newline formatting judgment  ·  🟡 Normal
Two known cosmetic quirks of the magicast path that the clean unit fixtures don't assert — confirm whether they're acceptable for committed output or warrant a follow-up. See also _Not covered_ below.

**Steps**
1. In the `auth.ts` block, look closely at the added import line and the end of the file (the diff shows a `\ No newline at end of file` marker).

**Expected (judgment call):** The added import renders as `import {stripe} from "@better-auth/stripe";` — note the **no inner-brace spaces**, unlike the file's existing `import { betterAuth }`. The codemod also **drops the file's trailing newline**. Decide whether either is a blocker for module output (likely 🟢 low — a formatter/`prettier` pass on the target project would normalize both) or worth fixing in the codemod first.
**Actual:** _(tester fills in)_

- [ ] Pass (acceptable / will be normalized downstream)
- [ ] Fail (fix before shipping)

### TC-5 — Engine output is something you'd commit without hand-editing  ·  🟢 Low
Overall trust check: taking TC-1–TC-4 together, would you be comfortable letting the applier write these results into a real project unattended?

**Steps**
1. Re-read the full driver output as if reviewing a PR the applier produced.

**Expected:** Both files are valid, correctly patched, and readable; nothing looks mangled or surprising beyond the TC-4 cosmetics.
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [ ] `pnpm build` still produces `packages/cli/dist/index.js` — the patch module is source-only for #6 and is **not** wired into the CLI entry, so the shipped CLI is unchanged. _(agent-verified below)_
- [ ] The new `test` turbo task runs without disturbing `build`/`typecheck`/existing commands. _(agent-verified below)_
- [ ] Existing CLI commands (`init`/`add`/`list`) are untouched by this change (no files under `src/commands/` or `src/lib/*` other than the new `patch/` folder were modified). _(agent-verified: diff touches only new files + `package.json`/lockfile)_

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
# from packages/cli
npx vitest run
npx tsc --noEmit
npx tsup
# from repo root
pnpm test          # turbo → saasaloy:test
node .dev/patch-demo/demo.cjs   # scripted end-to-end driver
```

- ✅ `npx vitest run` → **17/17 passed** across 4 files (`diff` 3, `jsonc` 5, `ts-module` 5, `index` 4), covering: idempotent re-insert returns source byte-for-byte, never-clobber on matching key, custom `matchOn`, array creation when absent, import de-dup, and `applyPatch` no-op (`changed:false`, empty diff) for both codemods.
- ✅ `npx tsc --noEmit` → clean (exit 0); caught and fixed a `noUncheckedIndexedAccess` issue in `jsonc.ts` formatting inference during build.
- ✅ `npx tsup` → build success, `dist/index.js 9.04 KB` — CLI entry unaffected.
- ✅ `pnpm test` (turbo) → `saasaloy:test` 17/17, 1 task successful. Confirms the previously-unimplemented turbo `test` task now runs.
- ✅ `node .dev/patch-demo/demo.cjs` → on messy tab/comment inputs: wrangler append `changed:true` with comments + tabs preserved; **re-run `changed:false`, empty diff** (idempotent); never-clobber `changed:false`, `HIJACKED` absent; magicast push `changed:true`; **re-run byte-for-byte identical** (idempotent).

## Not covered / needs human judgment
- **Import brace spacing** — magicast/recast emits the new import as `import {stripe}` (no inner spaces), inconsistent with an existing `import { betterAuth }` in the same file. Cosmetic; a project formatter would normalize it. Flagged for a decision in TC-4.
- **Trailing newline** — the magicast codemod drops the file's final newline (`\ No newline at end of file` in the diff). Not asserted by the unit tests; may warrant a small fix in `ts-module.ts` (re-append the original EOL) if committed output must be newline-clean. Flagged in TC-4.
- **Real Cloudflare / Better Auth integration** — the codemods are verified structurally, not by deploying a Worker or booting a Better Auth server with the patched config. That end-to-end proof lands with the `api`/`auth` modules (#8/#12), not here.
- **CRLF / exotic formatting inputs** — the driver exercises LF with tabs and 2-space; Windows CRLF files and unusual nesting aren't in the manual pass (the engine infers EOL/indent, but it's untested by eye here).
- **No CLI surface** — there is no `saasaloy` subcommand to run the engine yet; `--dry-run`/`--diff` as a *user-facing flag* is exercised when the applier (#6) wires it in.
