# Plan: deps:update writes JSON in place

Grilled: 2026-08-31

## Context

`pnpm deps:update` rewrites every manifest it touches with `JSON.stringify(json, null, 2)` (`scripts/update-deps.ts:1336`). That is byte-stable for a `package.json`, whose arrays are rare and whose formatting prettier already normalizes. It is not byte-stable for a hand-authored module descriptor. Every compact one-line array in a `registry-item.json` (`dependsOn`, `files`, `agent.skills`, the `import` object) explodes onto its own lines, so a one-character version bump lands as a ~60-line diff.

A sweep over the repo confirms the split. All 16 `modules/*/registry-item.json` files reflow under `JSON.stringify(parse(src), null, 2)`. All 13 `packages/cli/templates/**/package.json` files are byte-stable. Descriptors are read and reviewed as text, and the repo already treats a byte-faithful edit as a value it pays for (`packages/cli/src/lib/patch/jsonc.ts`, `chained-route.ts`).

Success means a `hono` patch-range bump in `modules/waitlist/registry-item.json` produces a one-line diff, and template `package.json` output does not change at all.

### What the issue got wrong

Issue #93 was filed against an older `scripts/update-deps.ts`. Three of its claims no longer hold, and this plan drops that work:

- `buildCandidates` has **no** `patchIndex` skip today (`scripts/update-deps.ts:918`). Nothing to remove.
- `buildPatchDriftNotes` does not exist. Nothing to delete.
- `writeUpdates` **already** addresses a patch entry and sets `patch.range = target` (`scripts/update-deps.ts:1287-1299`).

So the whole remaining defect is the serializer on line 1336. That makes this a smaller job than the issue reads, and a more urgent one: the write path is live, not skipped, so a bump today lands the 60-line diff rather than refusing.

The doc comment on `Manifest` states the bug in one sentence (`scripts/update-deps.ts:130-133`). It says the parsed document is kept "because the write pass rewrites it in place to preserve key order". It preserves key order and destroys array formatting.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| How to edit | `jsonc-parser`'s `modify` + `applyEdits`. It is the tool `packages/cli/src/lib/patch/jsonc.ts` already uses for exactly this reason, so the repo keeps one answer to "edit JSON without reflowing it". |
| Where the dependency lives | Root `devDependencies`, exact-pinned at `3.3.1` to match `packages/cli/package.json:36`. `scripts/` runs under bare `node` with type stripping, so an import must resolve in the root `node_modules`; pnpm's isolated layout will not surface a `packages/cli` dependency there. |
| Which manifests use it | Every manifest. One write path, no branch on `manifest.kind`. Template `package.json` files are already 2-space and prettier-normalized, so `modify` reproduces today's bytes. |
| Whether the in-memory `json` mutation stays | No. Both the mutation and the serialize go. `json` becomes read-only scan input, and its doc comment is rewritten to say so. |
| Where the source bytes come from (Q1) | `Manifest` gains `raw: string`. `readManifestDeps:505` already reads it and discards it. One read per file, and no window in which the file changes between read and write. |
| How several bumps in one file apply (Q2) | Sequential `modify` + `applyEdits`, re-parsing per edit, as a `reduce` over the file's candidates: source in, source out. This matches `packages/cli/src/lib/patch/jsonc.ts:81,88`, which never batches edits. Batching hand-rolls offset reasoning that `jsonc-parser` does not promise across independent `modify` calls, and a wrong answer corrupts a file silently. |
| If the `package.json` round-trip fails (Q3) | Fix the formatting inference and keep one write path. A failure means the inference is wrong, which would mis-handle a descriptor too. Reverting to a descriptors-only branch is reconsidered only if the cause is a `jsonc-parser` behaviour that cannot be configured. |
| Recording the new root dependency (Q4) | A line in `CONTRIBUTING.md`, in the section that covers the deps workflow. No ADR. ADR 0016 is the cooldown gate, not a dependency-placement policy. |
| Where formatting options come from (Q5) | Copy the 8 lines of `inferFormatting` (`packages/cli/src/lib/patch/jsonc.ts:177-185`) into `scripts/update-deps.ts`, with a comment naming the original. Node's type stripping would resolve a relative import, but that couples a maintainer script to CLI internals and drags the wrangler helpers along. |
| Where test fixtures live (Q6) | Inline template literals in the test file. A fixture file on disk is a hazard here: `discoverManifests:482` matches any path ending `registry-item.json`, so a fixture descriptor would join the real scan. |
| Whether the test sweeps real files (Q7) | Yes. Every discovered manifest goes through a no-op edit and must come back byte-for-byte identical. That one assertion is stronger than the fixture cases combined, and it is what would have caught this bug. |
| Regression guard | Tests under `scripts/`, run by `node --test`. The root `test` script already runs `node --test "modules/*/files/**/*.test.ts"` (`package.json:27`), so this adds a glob, not a runner. |

## Approach

Replace the serialize step in `writeUpdates` with a text-edit step. The function keeps its existing shape: dedupe candidates by `depKey`, group by file, log a step per bump. Only the part that turns "this dep becomes this version" into bytes changes.

**Reuses:** `jsonc-parser` and the `inferFormatting` implementation from `packages/cli/src/lib/patch/jsonc.ts`; the existing `Dep` shape, which already carries `bucket`, `name` and `patchIndex` (`scripts/update-deps.ts:99-117`); the `raw` string `readManifestDeps` already reads; the root `node --test` runner.

Rejected alternatives, one line each. A hand-rolled regex over the version string is smaller but cannot tell a `range` inside `patches[3]` from an identical string elsewhere in the file. Keeping `JSON.stringify` and post-formatting with prettier does not help, because prettier expands those arrays too.

### Phase 1: address a bump as a JSON path

Turn each candidate into a `jsonc-parser` path instead of an object mutation.

- [ ] add a helper that maps a `Dep` to its JSON path: `["patches", patchIndex, "range"]` for a patch entry, `[bucket, name]` for a `package.json` bucket, `[bucket, idx]` for a descriptor's `dependencies[]` / `devDependencies[]` array form
- [ ] the array form resolves `idx` by the same `name@version` split `writeUpdates` uses today (`scripts/update-deps.ts:1315-1319`), and the value written stays `${name}@${target}`
- [ ] preserve today's error behaviour: a missing bucket or a non-object patch entry throws with the manifest path in the message, rather than inventing the node
- [ ] `writeUpdates` no longer mutates `manifest.json`
- [ ] add `raw: string` to `Manifest`, populated in `readManifestDeps`, and rewrite the `Manifest` doc comment: `json` is read-only scan input, `raw` is what the write pass edits

### Phase 2: write with `modify` + `applyEdits`

- [ ] add `jsonc-parser` at `3.3.1` to the root `devDependencies`
- [ ] copy `inferFormatting` into `scripts/update-deps.ts`, with a comment naming `packages/cli/src/lib/patch/jsonc.ts:177` as the original
- [ ] `writeUpdates` folds a file's candidates over its `raw` string, one `modify` + `applyEdits` per candidate, re-parsing each time, then writes the result
- [ ] `--dry-run` still writes nothing and still logs the same steps
- [ ] add the `CONTRIBUTING.md` line covering why `jsonc-parser` sits in the root `devDependencies`

### Phase 3: prove it, and keep it proved

- [ ] a test under `scripts/` sweeps every manifest `discoverManifests` finds, applies a no-op edit (write a dep back to its current value), and asserts the output equals the input byte-for-byte
- [ ] an inline fixture with a compact one-line array takes a real bump, and the test asserts the diff is exactly one line
- [ ] an inline fixture covers a descriptor `dependencies[]` array entry, which no module ships yet, so nothing else exercises it
- [ ] an inline fixture takes two bumps in the same document, which is the only case that exercises the per-edit re-parse from Q2
- [ ] the root `test` script picks up `scripts/**/*.test.ts`
- [ ] `pnpm lint` passes over the new file (oxlint type-aware covers `scripts`, per AGENTS.md)

### Phase 4: land the pins that were blocked

- [ ] run `pnpm deps:update` and confirm `modules/waitlist/registry-item.json`'s `hono` range moves as a one-line diff
- [ ] `pnpm deps:check` exits 0 with no hand edit left over
- [ ] `pnpm deps:verify` passes

## Open questions

None. The grill closed every branch.

Two claims stay unverified until the code runs, and Phase 3 is where each is settled rather than argued:

- `modify` reproduces today's bytes for all 29 manifests. The sweep test is the check. If it fails, the settled answer to Q3 applies: fix the inference, do not branch.
- Re-parsing per edit is correct for several bumps in one file. The sweep exercises one edit per file, so a multi-bump case needs a fixture with two bumps in the same document.

## Non-goals

- No change to which pins `deps:update` selects, to the cooldown gate, to the interactive picker, or to the major opt-in.
- No reformat of any descriptor. The point is that the tool stops reformatting them; a repo-wide normalization pass is the opposite of that.
- No change to `packages/cli/src/lib/patch/jsonc.ts`. The script copies eight lines rather than importing them, because the two run under different resolution rules.
- No new module descriptor, and no adding an npm dependency to a descriptor just to exercise the array path. An inline fixture covers it.
- No ADR.
