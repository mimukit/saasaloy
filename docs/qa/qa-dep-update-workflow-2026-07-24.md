# QA Plan: Maintainer dependency-update workflow (issue #31)

_Generated 2026-07-24 · covers the uncommitted work on branch `issue-31-deps-check-deps-update-maintainer-workflow`: the pinned-`dependencies[]` convention + new `devDependencies[]` descriptor bucket (schema, `RegistryItem`, applier, `pkg-json`, `add` TUI), the new `scripts/update-deps.mjs` scanner, its **Phase 7 presentation refactor** (clack + picocolors UI, semver-colored grouped output, resolving spinner) and the **merged interactive flow** (`deps:update` is now a select-and-confirm command by default, with majors surfaced in their own selectable group and a `--yes` escape for non-interactive runs), the `deps:check` / `deps:update` / `deps:verify` scripts, and the docs (`CONTRIBUTING.md`, `AGENTS.md`, create-module skill, build-spec, `modules/README`)._

## Summary
- A maintainer runs **`deps:update`** to see every outdated dep across the pnpm-invisible files (base template + module descriptors), **pick which bumps to apply**, and confirm — writing **exact** versions that honor the repo's 3-day cooldown, with an optional verify step that re-scaffolds and builds a generated project.
- The single interactive command replaces the old check-then-update dance: in a TTY it always shows a grouped picker (within-major bumps pre-checked; **majors in their own group, unchecked**) then a confirm; `--yes` / a non-TTY pipe applies all eligible without prompting. `deps:check` remains only as the read-only **CI gate** (exits non-zero on actionable drift).
- "Working" means: the report groups drift honestly and colors it by bump level; cross-major bumps like `astro 5 → 7` always surface in a dedicated section; the picker + confirm write exactly the selected exact pins; descriptors now carry a `devDependencies[]` bucket that lands in the consumer's `devDependencies`.

This feature is **mostly machine-verifiable** — schema enforcement, dep-bucket routing, the scanner's exit codes, the writer's diff, and the full `deps:verify` chain were all run by the agent and are recorded under [Automated verification](#automated-verification-by-ai-agent). What genuinely needs a human is **judgment**: is the new clack-styled report readable and well-colored, does the interactive select-and-confirm flow feel right (including the majors group and cancel/decline paths), are the resolved bumps ones the maintainer wants to bless, and does the interactive `add` TUI surface `devDeps` correctly. Those are the manual cases below.

## Preconditions
- Node ≥ 24, pnpm 11, this repo checked out on branch `issue-31-deps-check-deps-update-maintainer-workflow` with the uncommitted changes present.
- **Network access** — the scanner queries `https://registry.npmjs.org`. On an air-gapped machine, skip TC-1..TC-4 and TC-7 (they need the registry) and say so.
- Working tree clean of unrelated edits, so a `deps:update` diff is easy to read and revert:

```sh
git status --short
```

- For TC-5 (the `add` TUI), build the CLI and scaffold a playground:

```sh
pnpm cli:dev            # terminal 1: rebuild CLI on change — leave running
pnpm play:init          # scaffold .dev/playground + the ./saasaloy shim
```

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | `deps:check` report is readable — grouped, semver-colored, majors in their own section | 🔴 Critical |
| TC-2 | Bless a real `deps:update` — pick all, confirm; exact pins, nothing collateral touched | 🔴 Critical |
| TC-3 | Majors cross only on purpose — via the picker's Major group or `--allow-major` | 🟡 Normal |
| TC-4 | `--allow-fresh` overrides the cooldown for a within-cooldown dep | 🟡 Normal |
| TC-5 | `saasaloy add` shows `devDeps` and lands them in `devDependencies` | 🟡 Normal |
| TC-6 | create-module guidance reads correctly for a descriptor author | 🟢 Low |
| TC-7 | Interactive `deps:update` — select + confirm, majors opt-in, cancel is safe | 🔴 Critical |

## Test cases

### TC-1 — `deps:check` report is readable — grouped, semver-colored, majors in their own section  ·  🔴 Critical
`deps:check` is the read-only CI gate and shares its report renderer with `deps:update`, so this case validates the whole presentation: is each status justified, and does the colored, grouped layout — with cross-major bumps broken out into their own box — read well in a real terminal.

**Steps**
1. Run in a real (TTY) terminal so colors render:

```sh
pnpm run deps:check
```

2. Read the output top to bottom. Confirm the chrome renders cleanly: the `deps:check` intro banner, the dim **policy line** (`exact pins · within-major · <n>min (<d>d) cooldown`), the resolving **spinner** that ends `Resolved N dependencies from npm`, then the grouped `note` boxes, a one-line status summary, and the outro.
3. For each row judge: does `current → target  <path>` tell you plainly what will happen? A within-major target's changed segment is colored by bump level (cyan minor / green patch) with the unchanged leading part dimmed; a **Major available** row shows `current → <highest major>` entirely in red.
4. Sanity-check a couple of statuses against reality — e.g. pick a `within-cooldown` dep and confirm on npm that its newest version really is < 3 days old; pick a **Major available** dep (e.g. `astro`, `typescript`) and confirm a newer major really exists on npm.

**Expected**
- Rows are grouped **by action / bump level**, each in its own titled `note` box, in this order (empty groups are omitted): **Minor** (cyan), **Patch** (green), **Pin / migrate to exact** (cyan), **Major available — crosses a major** (red), **Within cooldown — held back** (yellow), **Unresolved — registry error** (red). Each title carries a dim `(count)`.
- The **Major available** box lists *every* dep with a newer major (e.g. `astro 5.x → 7.1.3`, `typescript dev 5.x → 7.0.2`), pointing at the **highest existing major** in red — regardless of whether that dep also has a within-major bump. This is the dedicated cross-major section (a bump like `astro 5 → 7` never hides inside a migration/minor row).
- Each row reads `name  current → target  <manifest-path>`, with the package name cyan and the manifest path dimmed at the end of the line (the file is a per-row suffix, not a group header).
- `devDependencies` entries carry a dim ` dev` tag after the name.
- `within-cooldown` rows point the arrow at the **held-back** highest-within-major version (yellow) — never a phantom downgrade.
- The `typescript` major divergence appears as a dim bullet inside a **Notes** box (template major 5 vs repo's 7), reading as informational, not an error.
- The status summary line tallies each status (e.g. `2 major-available · 8 within-cooldown (skipped) · 6 up-to-date`).
- **Exit code is the CI gate:** non-zero *only* when there is actionable within-major drift (`outdated` / `range→exact` / `bare→pinned`), with the outro `N pending — run pnpm deps:update`. When the templates are already exact-pinned and only cooldown/major items remain (the state today), it exits **0** with an `up to date` outro — majors and cooldown items are *not* actionable and don't fail the gate. (Running `deps:check` locally on real drift will surface pnpm's `ELIFECYCLE … exit code 1`; that's the gate doing its job — the daily human command is `deps:update`, not `deps:check`.)
- Long rows wrap inside the `note` rail rather than overflowing it (narrow the terminal to confirm the wrap holds and colored words aren't cut mid-escape).

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-2 — Bless a real `deps:update` — pick all, confirm; exact pins, nothing collateral touched  ·  🔴 Critical
This is the core maintainer act: the tool proposes exact versions, the human selects and confirms, and only then does it write. A human must eyeball the diff — the agent can confirm the *shape* of the write but not that the chosen versions are acceptable to release. (The picker mechanics themselves — deselect/cancel/majors — are TC-7; here just accept the pre-checked defaults and bless the result.)

**Steps**
1. Run the update in a real (TTY) terminal:

```sh
pnpm run deps:update
```

> If the **Minor / Patch / Pin-migrate** groups are all empty today (templates are already exact-pinned) the picker will only offer the unchecked **Major** group. To exercise a genuine within-major write, pull the held-back cooldown bumps into the picker instead — they arrive **pre-checked**:
> ```sh
> node scripts/update-deps.mjs --allow-fresh
> ```

2. Leave the pre-checked (within-major / cooldown) rows selected, leave the **Major** group **unchecked**, and press Enter. At the `Apply N updates?` prompt choose **Yes**.
3. Review the resulting diff:

```sh
git --no-pager diff packages/cli/templates modules
```

4. Judge each bump: is this a version you're willing to ship to downstream projects? Cross-check anything surprising against the package's changelog.
5. When done judging, restore the files (blessing/committing them is a separate, deliberate act):

```sh
git checkout -- packages/cli/templates modules
```

**Expected**
- After you press Enter (and before the confirm), a bright **Selected N updates** box lists the chosen bumps in bold, solid colors — a legible recap of what's about to be written.
- Every rewritten value is an **exact** version (no `^`/`~`/ranges remain in touched entries).
- `workspace:*`, `@repo/*`, `{{PROJECT_NAME}}`, and `engines`/`packageManager` are **untouched**.
- Key order and formatting (2-space, trailing newline) are preserved — the diff shows only the version strings changing.
- **Major** bumps you left unchecked are **not** written — only within-major (and, with `--allow-fresh`, cooldown) rows land.
- The per-write `log.step` lines and the outro count (`updated N dependencies`) match the number of changed lines in the diff.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-3 — Majors cross only on purpose — via the picker's Major group or `--allow-major`  ·  🟡 Normal
Majors are where the template breaks; the maintainer must consciously opt in and judge the blast radius. There are now two deliberate ways in — checking the **Major** group in the interactive picker, or passing `--allow-major` for a non-interactive run — and neither happens by default.

**Steps**
1. **Interactive path.** Run `pnpm run deps:update` in a TTY. Confirm the **Major** group is present and **unchecked**. Check `astro` (only), Enter, and **Yes** at the confirm. Then inspect and revert:

```sh
git --no-pager diff packages/cli/templates modules   # expect only astro → 7.x
git checkout -- packages/cli/templates modules
```

2. **Non-interactive path.** Preview all majors without writing and compare to a plain run:

```sh
node scripts/update-deps.mjs --dry-run                 # majors listed but NOT in the would-update lines
node scripts/update-deps.mjs --dry-run --allow-major   # majors now crossed
```

3. Judge whether any surfaced major (e.g. `astro`, `typescript`) is one you'd actually take — this is the human call the gate exists to force.

**Expected**
- In the picker, majors sit in their own **unchecked** group; a within-major bump for the same dep (if any) stays in its own pre-checked group. Checking only `astro` writes only `astro`'s cross-major pin (e.g. `→ 7.1.3`) and nothing else.
- Plain `--dry-run` lists every major in the **Major available** report section but writes none of them (`Nothing to update`, or only the within-major rows).
- `--dry-run --allow-major` adds the majors to the `would update` `log.step` lines (target shown in red) and the dim policy line shows a `· --allow-major` segment.
- If a dep has both a within-major bump and a selected/`--allow-major` major, only **one** write lands for it — the major (higher version) wins.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-4 — `--allow-fresh` overrides the cooldown for a within-cooldown dep  ·  🟡 Normal
The audited escape hatch for a security fix that must land inside the 3-day window.

**Steps**
1. From TC-1, note a dep reported `within-cooldown (skipped)` (e.g. a `wrangler` or `@cloudflare/*` devDep). If none exists today, mark this case N/A and say so.
2. Dry-run with the override:

```sh
node scripts/update-deps.mjs --dry-run --allow-fresh
```

**Expected**
- The previously `within-cooldown` dep now appears in the "would update" list, targeting the freshest within-major version, and moves out of the **Within cooldown — held back** group into a bump group (and, in an interactive run, into the picker as a **pre-checked** row).
- The dim policy line shows a `· --allow-fresh` segment.
- Without the flag, that same dep stays skipped (re-run plain `--dry-run` to confirm).

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-5 — `saasaloy add` shows `devDeps` and lands them in `devDependencies`  ·  🟡 Normal
The applier half of the feature. No shipped module declares `devDependencies[]` yet, so author a throwaway fixture to exercise the path end-to-end in the playground.

**Steps**
1. In this checkout, temporarily add a `devDependencies[]` line to a local module descriptor — e.g. edit `modules/api/registry-item.json` to include:

```sh
# add this key alongside "dependencies": []
#   "devDependencies": ["@types/node@26.1.1"]
```

2. From the playground, add the module through the shim:

```sh
cd .dev/playground
./saasaloy add api
```

3. Read the plan summary the TUI prints, then inspect the resulting root `package.json`:

```sh
cat package.json
```

4. When done, discard the fixture edit:

```sh
git checkout -- modules/api/registry-item.json
```

**Expected**
- The plan summary shows a `devDeps:` line listing `@types/node@26.1.1` (distinct from the `deps:` line).
- After apply, `@types/node` lands in the playground root's **`devDependencies`**, pinned to `26.1.1` — not in `dependencies`.
- If you instead put the same package name in **both** buckets, it lands in `dependencies` only (no duplicate in `devDependencies`).

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-6 — create-module guidance reads correctly for a descriptor author  ·  🟢 Low
Docs UX — an author following the skill should end up with a valid pinned descriptor.

**Steps**
1. Read the `dependencies` / `devDependencies` field notes and example in:

```sh
.agents/skills/create-module/SKILL.md
```

2. Judge: is it clear that both buckets are exact-pinned, that `@types/*` go in `devDependencies[]`, and that `pnpm deps:update` fills versions?

**Expected**
- The example descriptor shows `zod@4.0.5` and a `devDependencies` entry (not a bare `zod`).
- The field note and authoring checklist both state the exact-pin rule and point at `pnpm deps:update`.

**Actual:** _(tester fills in)_

- [x] Pass
- [ ] Fail

### TC-7 — Interactive `deps:update` — select + confirm, majors opt-in, cancel is safe  ·  🔴 Critical
This is the headline of the merge: `deps:update` in a TTY is now a grouped picker (within-major bumps pre-checked, majors unchecked) followed by a confirm, and nothing is written until you say Yes. Only a human can drive it, so this is the core manual case.

> ⟳ **Re-test needed** (flow changed by the 2026-07-24 feedback pass): `--dry-run` is now **print-only** — it never opens the picker — so explore the picker with a **real** run and lean on the safe-exit paths (cancel / decline / select-none all write nothing). There is also a new **Selected N updates** summary box between the picker and the confirm.

**Steps**
1. Launch a **real** run in a TTY (the safe-exit paths below write nothing, so you can learn the controls without touching files). Add `--allow-fresh` so there are pre-checked within-major rows to see today (otherwise only the unchecked **Major** group appears):

```sh
node scripts/update-deps.mjs --allow-fresh
```

2. Confirm the group picker appears (`Select updates to apply`) with the bump groups (**Patch / Minor / Pin / migrate to exact**) rows **pre-checked**, and any **Major — crosses a major…** group present but **unchecked**. Each row reads `name [dev]  current → target`, with the manifest path as the hint.
3. **Deselect one** pre-checked bump (Space), leave the rest, Enter. A bright **Selected N updates** box lists exactly what you chose in **bold, solid colors** (name bold-cyan, target colored by bump level, majors bold-red) — no dim. Confirm it's clearly legible and matches your selection. At `Apply N updates?` choose **No** to keep exploring safely, or **Yes** to write (then revert with `git checkout -- packages/cli/templates modules`).
4. Exercise the safe-exit paths (each must leave the tree untouched, exit 0):
   - Re-run, press **Esc / Ctrl-C** at the picker → `Update cancelled — no files changed.`
   - Re-run, accept the selection, then choose **No** at the confirm → `Update cancelled — no files changed.`
   - Re-run, **deselect everything**, Enter → `Nothing selected — no files changed.`
5. Exercise a real write of a single dep, then inspect + revert:

```sh
node scripts/update-deps.mjs --allow-fresh   # keep just one row checked, confirm Yes
git --no-pager diff packages/cli/templates modules
git checkout -- packages/cli/templates modules
```

6. Confirm the print-only and non-interactive escapes:

```sh
node scripts/update-deps.mjs --dry-run                    # print-only: report + "would update" preview, NO picker, writes nothing
node scripts/update-deps.mjs --yes | cat                  # piped/non-TTY apply: all eligible (majors excluded), prints the Non-TTY notice, no hang
```

**Expected**
- The picker pre-checks only within-major (and, with `--allow-fresh`, cooldown) bumps; the **Major** group is always present-but-unchecked. Deselecting the group or a row removes exactly those from the write.
- After you press Enter, a **Selected N updates** note lists the chosen bumps in **bold, fully-colored** text (not dimmed) — readable at a glance, distinct from clack's dim echo of the raw multiselect submission.
- The dep you deselected is **absent** from the `would update` / `updated` step lines and the outro count; kept rows are present. A real run's diff touches exactly the kept deps.
- **Cancel at the picker, No at the confirm, and empty selection all write nothing and exit 0** — with the messages above.
- `--dry-run` never prompts: it prints the report and the default "would update" list (primaries; add `--allow-major` for majors) and writes nothing.
- `--yes` (or a non-TTY pipe) skips both prompts and applies every eligible bump (majors only if `--allow-major` is also passed). A pipe prints `Non-TTY — applying all eligible updates (pass -y in a TTY to skip the picker).` instead of hanging.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks
- [x] `saasaloy add` for a module with only `dependencies[]` (no dev bucket) still lands them in `dependencies` exactly as before.
- [x] A descriptor with **no** dep buckets applies with no dep-related output and no crash.
- [x] Existing schema validation for `scaffolds[]` / `files[]` still passes (unchanged by this work).
- [x] `pnpm play:init` / `pnpm play:reset` still scaffold a buildable playground.

## Automated verification (by AI agent)
_Checks the agent ran itself — no action needed from the tester; listed here for context and sign-off._

**2026-07-24 feedback iteration** (post-manual-QA): three changes to `scripts/update-deps.mjs` —
(1) registry resolution now runs in **parallel** (bounded concurrency 12; the in-flight packument
promise is cached so duplicate deps share one fetch), (2) `--dry-run` is now **print-only** — it
prints the report + "would update" preview and never opens the picker, and (3) a bright **Selected
N updates** summary (bold, solid colors) is shown between the picker and the confirm so the final
selection is legible rather than dimmed. Commands run this iteration:

```sh
node --check scripts/update-deps.mjs                      # parallel resolver + print-only dry-run + selection summary parse clean
node scripts/update-deps.mjs --dry-run --allow-major      # print-only preview, no picker, majors crossed
```

- ✅ `node --check` → parses clean after the feedback edits (`mapWithConcurrency`, promise-cached `fetchPackument`, `selectionLine`, dry-run print-only branch).
- ✅ `deps:update --dry-run --allow-major` (non-TTY) → **print-only, no picker**, `would update 6` against the current template state (`astro → 7.1.3` + `typescript → 7.0.2` majors in red, `wrangler`/`turbo` range→exact, `drizzle-orm`/`drizzle-kit` outdated); policy line tagged `· --allow-major`; resolution visibly overlapped (spinner ticks fast, ~44% CPU on wall-clock).
- ⏳ **Interactive picker + confirm + the new "Selected N updates" summary** (TC-2/TC-7) → not machine-run: `groupMultiselect`/`confirm` need a TTY. Left for manual re-test.
- ↩︎ `vitest` / `typecheck` / `build` / `deps:verify` → **not re-run this iteration**; the change lives entirely in the root `scripts/update-deps.mjs`, which no TS test/build touches. Worth one run before final sign-off.

> _Prior iteration (merged flow):_ `node --check` clean; `deps:check` gate exit code reflects actionable drift; the dedicated **Major available — crosses a major** report box and `Notes` (typescript major divergence) render as designed. Those checks are unchanged by this feedback pass.

## Not covered / needs human judgment
- Whether a specific resolved version is **safe to ship** to downstream projects — the tool proposes; the maintainer blesses (TC-2/TC-3).
- The visual readability / scannability and coloring of the clack-styled report in a real terminal — colors, group ordering, the dedicated Major section, spinner, and `note`-box wrapping can't be asserted headlessly (TC-1).
- The interactive `deps:update` experience — group picker pre-selection, the unchecked Major group, the confirm step, and the cancel / decline / select-none paths all need a human at a real terminal (TC-2/TC-3/TC-7).
- The interactive `add` TUI rendering of the `devDeps:` line — the agent can assert the data but not the on-screen presentation (TC-5).
- Registry-error / offline behavior: rows surface as `unresolved (registry error)` on a failed fetch, but a real DNS/registry outage wasn't simulated.
- Very large `versions` maps (thousands of releases) resolve fine in practice (`wrangler` has ~4900) but no pathological-size perf test was run.
