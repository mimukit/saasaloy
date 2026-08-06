# Plan — `scripts/` to TypeScript with a real typecheck gate

Grilled: 2026-08-06
Tracked: [#54](https://github.com/mimukit/saasaloy/issues/54)

## Context

The three maintainer scripts under `scripts/` are plain ESM (`.mjs`) while everything in `packages/cli` is TypeScript. The payoff is concentrated in **`update-deps.mjs`** (798 lines), which resolves versions from the npm registry and rewrites package manifests and module descriptors — load-bearing shapes with nothing checking them. `verify-css.mjs` (112 lines) and `watch-template.mjs` (46 lines) come along for uniformity: one `.ts` next to two `.mjs` is worse than either consistent choice.

The runtime change is free. Node 24 strips types natively — verified on v24.19.0, a `.ts` file with `import type` and package imports runs with no flag, no warning, exit 0. But stripping is not checking, so a rename alone buys nothing. **The deliverable is the `tsc` gate**, and `scripts/` is currently invisible to it: root `typecheck` is `turbo run typecheck`, which walks pnpm workspace packages (`packages/*`) only.

**Success** = `pnpm typecheck` fails when `scripts/` has a type error, the three scripts run unchanged through `play:watch` / `deps:check` / `deps:update` / `deps:verify`, and `verify-css` is observed still catching a deliberately broken `@source` glob.

### Measurements taken during the grill

Typechecking the three files as-is under `tsconfig.base.json` with `allowJs`/`checkJs` (TypeScript 7.0.2, the root pin):

| | errors |
|---|---|
| `update-deps.mjs` | 80 |
| `verify-css.mjs` | 9 |
| `watch-template.mjs` | 2 |
| **total** | **91** |

By kind: **61 are TS7006** (implicit-`any` parameters), ~14 are null/undefined narrowing under `noUncheckedIndexedAccess`, 7 are TS7053 index-signature, and the remainder are inference gaps (`timer`, `deps`) plus one TS2339 that is a genuine design smell.

Two incidental findings:

- **`update-deps.mjs` contains a raw ESC byte** (`\x1b`) in a string literal at line 370, in the ANSI-stripping code. `grep` classifies the file as binary because of it, so every tool that skips binaries silently ignores the file. Replace it with the `"\x1b"` escape during conversion.
- **`verify-css.mjs`'s header claims** "Standalone ESM with no dependencies, like the other scripts here." Already false — `update-deps` imports `@clack/prompts` and `picocolors`.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Convert or `@ts-check`?** | **All three to `.ts`.** The measurement kills the "cheaper alternative": 61 of 91 errors are missing parameter types, which have to be written either way, and JSDoc writes them as `/** @param {string} name */` instead of `name: string`. `@ts-check` avoids a build step that Node already removed, and leaves the repo permanently bilingual. |
| **Where the gate lives** | Root `typecheck:scripts` = `tsc -p tsconfig.scripts.json`, and `typecheck` chains it: `pnpm run typecheck:scripts && turbo run typecheck`. `noEmit` lives in the tsconfig, not duplicated on the command line. No turbo caching for three files that TS 7 compiles in well under a second. |
| **Rejected: `scripts/` as a workspace package** | Would let turbo see it natively and give the deps a proper home, but promotes three maintainer scripts to a published-shaped package. Revisit only if `scripts/` grows well past three files. |
| **Rejected: turbo root task (`//#typecheck:scripts`)** | Buys caching, costs root-task config plus a recursion trap — today's root `typecheck` *is* `turbo run typecheck`. `turbo.json` declares no root tasks at all today; this is not the change to introduce the pattern. |
| **`@types/node`** | Root devDependency, exact-pinned **`26.1.1`** to match `packages/cli`. `tsconfig.base.json` sets `"types": ["node"]` and root `node_modules/@types` is currently empty. |
| **CI (#46)** | **Land the local gate now, independently.** #46 inherits a working `pnpm typecheck` and needs no scripts-specific knowledge — one line in a workflow it is already writing. There is no `.github/` in the repo yet. |
| **External JSON shapes** | **Local `interface`s in the script**, `unknown` out of `JSON.parse`, narrowed at each site. Four sites: `fetch` at line 150 (npm packument), `JSON.parse` at 273 and 325 (package manifests, module descriptors), `JSON.stringify` at 781 (write-back). The npm packument gets the careful type — it is the untyped input that decides version bumps. |
| **Rejected: `import type` from `packages/cli/src/lib/schema.ts`** | `RegistryItem`/`RegistryFile` already exist there and `import type` erases at runtime, so the coupling would be free at execution — but the script uses a thin slice (`dependencies`/`devDependencies` maps, a `files[]` list) and `packages/cli` has no `exports` entry, so the path is free to move. Not worth a cross-package reach for a shared name. |
| **Rejected: ajv runtime validation** | Genuinely validates against the existing `packages/cli/schemas/*.schema.json` rather than asserting, but adds `ajv` to root devDeps and converts a type gate into a runtime gate. Out of proportion to this issue. |
| **Strictness** | **Keep `tsconfig.base.json` as-is, including `noUncheckedIndexedAccess`.** The 14 narrowing errors cluster in one place — the semver capture path at lines 123, 197, 207, 413–414, where `String.match()` returns `null` and its groups get indexed. That is the code deciding whether a bump is within-major and safe to apply; a failed parse currently flows into a comparison as `undefined` and compares silently wrong. Fix with a `parseSemver()` returning `null` and one guarded call site, not four separate narrowings. A `!` is acceptable only at a capture proven unreachable, with a comment saying why. |
| **The `_json` monkey-patch** | Line 602 does `manifest._json = json` on an object built as `{ file, kind }` — the one error that is neither an annotation nor a null check. **`readManifestDeps` returns a new record** `{ file, kind, json, deps }` and the mutation disappears. Touches the loop at 599–603 and the writer at 781. |
| **Prose scope** | **Living docs plus a dated ADR amendment.** 20 of the 23 references live in dated documents; rewriting a dated record makes it describe a world that did not exist on its date. Update `CONTRIBUTING.md` and the `sentinel.ts` comment; append one line to ADR 0016 (`Amended 2026-08-06: the script is now scripts/update-deps.ts, see #54`). Leave `docs/qa/qa-dep-update-workflow-2026-07-24.md` (13 refs) and the two plan docs (5 refs) as history. |
| **The `sentinel.ts` coupling** | Reference the checker **without its extension** — `scripts/verify-css` — so the comment is immune to this rename recurring. The file ships inside `packages/cli/templates/base/`, so the edit changes scaffolded output for every downstream project; the comment is the only thing explaining why an unused constant must not be deleted. Fix the false "no dependencies" claim in `verify-css`'s own header in the same pass. |
| **Regression proof** | **A manual QA doc under `docs/qa/`**, matching the existing convention. `verify-css` is a smoke test for a *silent* failure, so a converted version that quietly stops asserting still exits 0 on a green build. **Run the negative case first**: break the `@source` glob, confirm non-zero, restore, confirm green. A smoke test never seen failing is not known to work. |
| **File extension** | `.ts`, not `.mts`. Root `package.json` is `"type": "module"`, so `.ts` is already ESM. |
| **Import extensions** | Non-issue. None of the three scripts has a relative import — only `node:*`, `@clack/prompts`, and `picocolors` — so the NodeNext extension requirement never fires. |
| **Erasable syntax** | Non-issue. Nothing here uses enums, parameter properties, or namespaces, and the conversion only adds annotations. |

## Approach

### Phase 1 — infrastructure

1. Add `@types/node` `26.1.1` to root `devDependencies` (exact, per `saveExact`).
2. Add `tsconfig.scripts.json` extending `tsconfig.base.json`: `noEmit: true`, `declaration: false`, `sourceMap: false`, `include: ["scripts/**/*.ts"]`.
3. Root `package.json` scripts:
   - `"typecheck:scripts": "tsc -p tsconfig.scripts.json"`
   - `"typecheck": "pnpm run typecheck:scripts && turbo run typecheck"`

At this point the gate exists and reports the ~91 errors as soon as the files are renamed.

### Phase 2 — conversion

Rename all three to `.ts` with `git mv` so history follows, then work the errors down:

- **`watch-template.ts`** (2 errors) — `timer` needs `ReturnType<typeof setTimeout> | null`.
- **`verify-css.ts`** (9 errors) — the rest-parameter at line 40, an empty-array-inferred `never` at 59, and a `string[]` passed where `null | undefined` was inferred at 74. Fix the header's dependency claim and the `sentinel.ts` back-reference here.
- **`update-deps.ts`** (80 errors) — parameter annotations, the `parseSemver()` extraction, local interfaces for the packument / manifest / descriptor shapes, the `readManifestDeps` restructure, index signatures on the status→color and accumulator maps at 543/550/726/728, `err: unknown` narrowing at 615, and the raw ESC byte at 370.

### Phase 3 — callers and prose

4. Root `package.json` callers: `play:watch`, `deps:check`, `deps:update`, `deps:verify` — `.mjs` → `.ts` (four `node scripts/…` invocations, five references).
5. `CONTRIBUTING.md`, `packages/cli/templates/base/packages/ui/src/lib/sentinel.ts`, and the ADR 0016 amendment line.

### Phase 4 — verification

6. `pnpm typecheck` green, and observed **red** when a deliberate type error is introduced into each of the three scripts.
7. `pnpm deps:check` produces the same report as before the conversion.
8. `pnpm deps:verify` end to end, with the negative `@source` case run first.
9. `pnpm play:watch` starts, re-scaffolds on a template edit, and stops cleanly.
10. QA doc written to `docs/qa/`.

## Out of scope

- `scripts/saasaloy-shim.sh` — a shell script.
- The template's own scripts under `packages/cli/templates/base/`.
- CI wiring, which belongs to #46.
- Any behaviour change to the three scripts beyond what the type errors force.
