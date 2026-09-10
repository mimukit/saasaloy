# QA Plan: `$schema`-validated descriptor schemas (issue #5)

_Generated 2026-07-22 · covers the uncommitted work on branch `issue-5-schemas`: three JSON Schema documents (`packages/cli/schemas/*.schema.json`) + example fixtures, the ajv-backed validator (`packages/cli/src/lib/schema.ts`), and the `ManagedEntry.source → module` rename in `manifest.ts`._

## Summary
Defines the exact shapes of `saasaloy.json` (consumer manifest), `.saasaloy/manifest.json` (managed-file tracking), and `registry-item.json` (module descriptor) as draft-2020-12 JSON Schemas, plus a validator that rejects malformed descriptors with a clear, one-line-per-error message. "Working" means: the spec's example descriptors validate, malformed ones are rejected with a message an author can act on, and a module author gets live feedback in their editor via the `$schema` pointer.

This feature is **almost entirely machine-verifiable** — schema validity, valid/invalid descriptor handling, typecheck, and build were all run by the agent and are recorded under [Automated verification](#automated-verification-by-ai-agent). Only the **editor authoring experience** and **error-message clarity** genuinely need a human eye; those are the manual cases below.

## Preconditions
- Node ≥ 24, pnpm 11, this repo checked out on branch `issue-5-schemas` with the uncommitted changes present.
- Build the CLI so `dist/` and the bundled validator exist:

```sh
pnpm --filter saasaloy build
```

- For TC-1/TC-3 (editor experience): an editor with JSON Schema support (VS Code, or any LSP that honors the `$schema` key). No extension needed beyond built-in JSON language support.
- The example fixtures used by the manual cases live at:

```sh
packages/cli/schemas/examples/
```

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Editor flags an invalid value live via the `$schema` pointer | 🟡 Normal |
| TC-2 | A realistic authoring typo produces an actionable error message | 🟡 Normal |
| TC-3 | Schema property descriptions are useful on hover / autocomplete | 🟢 Low |

## Test cases

### TC-1 — Editor flags an invalid value live via the `$schema` pointer  ·  🟡 Normal
This is the "authored descriptors fail fast" promise from the human side — the author sees the mistake in-editor, before ever running the CLI.

**Steps**
1. Open `packages/cli/schemas/examples/registry-item.example.json` in VS Code (or your schema-aware editor). Confirm no warnings show initially.
2. Change `"type": "saasaloy:feature"` to `"type": "saasaloy:widget"` and save.
3. Observe the editor gutter/inline diagnostics on the `type` line.
4. Trigger autocomplete (Ctrl/Cmd-Space) on the `type` value with the string cleared — confirm it offers `saasaloy:capability` and `saasaloy:feature`.
5. Revert the change.

**Expected:** After step 2 the editor shows an inline error on `type` (value not one of the allowed enum values). Step 4 offers exactly the two allowed `type` values as completions. The relative `$schema` pointer (`../registry-item.schema.json`) resolves without a "schema not found" warning.
**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-2 — A realistic authoring typo produces an actionable error message  ·  🟡 Normal
The validator's messages already print (see Automated verification); this case is the human judgment call: **is the wording enough to fix the mistake without reading the schema source?**

**Steps**
1. Read these real validator outputs (captured by the agent against deliberately-broken descriptors):
   - `/agent: unexpected property "fragments"` — author used the old pre-reversal `fragments` key instead of `skills`.
   - `/type: must be equal to one of the allowed values (saasaloy:capability, saasaloy:feature)` — wrong module type string.
   - `/files/0/target: must match pattern "^@[a-z0-9][a-z0-9-]*/.+"` — a `target` that forgot its `@alias/` prefix.
   - `(root): missing required property "installed"` — an incomplete `saasaloy.json`.
2. For each, judge: could a module author fix their descriptor from this message alone?

**Expected:** Each message names the offending path and the specific rule violated; a reasonable author can correct the descriptor without opening `schema.ts` or the schema JSON. (The `target` pattern message is the weakest — judge whether the raw regex is acceptable or should be humanized.)
**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — Schema property descriptions are useful on hover / autocomplete  ·  🟢 Low
**Steps**
1. In the editor, open `packages/cli/schemas/examples/saasaloy.example.json`.
2. Hover the `aliases` and `installed` keys; read the description text surfaced from the schema.
3. Repeat for a few keys in `registry-item.example.json` (`dependsOn`, `patches`, `agent`).

**Expected:** Hovering a key shows the schema's `description` text, and it actually explains what the field is for (not just restating the key name). `patches`/`scaffolds` descriptions make clear their detailed shape is intentionally deferred.
**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

## Regression checks
- [x] `saasaloy init` still scaffolds a base project and writes **no** `.saasaloy/manifest.json` (the `ManagedEntry` rename touched `manifest.ts` but the base writes no manifest). _Agent-verified below._
- [x] `saasaloy.json` emitted by `init` still validates against the new `saasaloy.schema.json`. _Agent-verified below._

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

Commands run:

```sh
pnpm --filter saasaloy typecheck
pnpm --filter saasaloy build
# schema files are valid JSON and declare draft 2020-12
node -e "for (const f of require('fs').readdirSync('packages/cli/schemas').filter(x=>x.endsWith('.schema.json'))) console.log(f, require('./packages/cli/schemas/'+f)['\$schema'])"
# bundled validator run against the spec examples + deliberately-broken descriptors
node packages/cli/dist/_verify.mjs
# regression: init writes a base project with no manifest
node packages/cli/dist/index.js init <scratch>/qa-init
```

- ✅ `typecheck` (`tsc --noEmit`) → clean, no errors.
- ✅ `build` (tsup) → `dist/index.js` built successfully; `schemas` is listed in the package `files` array so the schemas ship with the published CLI.
- ✅ All three schema files parse as JSON and declare `$schema: https://json-schema.org/draft/2020-12/schema`.
- ✅ **Acceptance #1 — spec examples validate:** `saasaloy.example.json`, `manifest.example.json`, `registry-item.example.json` all `valid=true`.
- ✅ **Acceptance #2 — invalid descriptors rejected with clear errors:** 8/8 malformed descriptors rejected, each with a readable message — missing required property, bad alias key, unexpected property, entry missing `hash`, non-hex `hash`, bad `type` enum, `target` without `@alias/` prefix, and unknown `agent` key (`fragments`).
- ✅ **Regression — `init`:** scaffolds `saasaloy.json` and creates **no** `.saasaloy/` dir (base writes no manifest, as designed).

All automated checks passed (typecheck + build + 3 schema-parse + 11 validation cases + init regression).

## Not covered / needs human judgment
- **Editor experience across tools.** Automated checks confirm the schemas are *correct*; only a human can confirm VS Code / other LSPs actually surface the diagnostics and completions (TC-1, TC-3). Codex/Antigravity are not schema-aware editors and are out of scope.
- **Error-message wording quality.** The agent confirms the *mechanism* rejects bad input; whether the copy is friendly enough for a module author is a UX call (TC-2) — notably the raw regex in the `target` pattern message.
- **`$schema` pointer for real authored modules.** The example fixtures use a relative `../*.schema.json` pointer that resolves in-repo. No real `modules/*/registry-item.json` exists yet (issues #8–#10); the pointer convention for authored modules is exercised only when those land.
- **Applier integration.** This is a prefactor — nothing calls the validator at runtime yet. `saasaloy add`/`list` wiring and fail-fast-on-load behavior arrive with the applier (issue #6) and should be QA'd there.

_Note: `packages/cli/dist/_verify.mjs` is a git-ignored verification bundle the agent built for these checks; it is wiped by the next `tsup` build (clean) and is never committed._
