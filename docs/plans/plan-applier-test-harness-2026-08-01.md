# Plan — Applier test harness: commands, remote registry, e2e, and a conflict matrix

> Tracked in [#47](https://github.com/mimukit/saasaloy/issues/47) (single issue — all phases folded).

## Context

Saasaloy's entire job is writing files into someone else's repository. The bar for confidence is
high, and the current suite doesn't clear it. Roughly 1,100 lines of test cover ~2,400 lines of
source, and the coverage is unevenly distributed in exactly the wrong way:

- **`packages/cli/src/commands/` has zero tests.** Every piece of argument parsing (`parseArgs` in
  `add.ts`, `--force`/`--no-install` in `init.ts`), the lock-pinning branch, `--force`'s
  requested-module-only semantics, unknown-flag rejection, and the already-installed early return
  are verified only by a human running them.
- **`RemoteRegistrySource` is untested** while its `LocalRegistrySource` sibling is well covered.
  That is precisely backwards: the remote path — GitHub API SHA resolution, giget
  `downloadTemplate`, temp-dir `cleanup()`, rate-limit and 404 handling — is what *every real user
  hits*, and the local path is a dev/offline override.
- **Cycle detection is implemented but unproven.** `resolve.ts` maintains an `onPath` set and throws
  `Dependency cycle detected: …`. No test ever drives it, so nothing would catch a regression that
  silently disabled it.
- **No end-to-end test exists anywhere.** Nothing spawns the built binary and runs `init` then `add`
  against a temp directory. `applier.test.ts` is integration-ish at the *library* level — it uses
  real `mkdtemp` directories, which is good — but it constructs `Plan` objects directly and never
  passes through `commands/`. Verification today is 10 hand-written manual QA documents plus a human
  driving `.dev/playground`.
- **Nothing tests module combinations.** The signature failure mode of a module system is *module A
  plus module B*: two descriptors targeting the same file, colliding aliases, or dependency versions
  that disagree. The applier detects these at runtime and correctly holds them back rather than
  clobbering — but no test asserts that, and Phase 3 is about to roughly quadruple the module count.

**Success:** the paths users actually take are covered by automated tests; adding a module to
`modules/` automatically extends the combination matrix without anyone maintaining a list; and a
third-party module author can validate a descriptor before publishing it rather than discovering the
problem on a stranger's machine.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Scope** | Tests plus `saasaloy doctor` only. Making `add` transactional is a **behavior** change with its own design question and lives in `plan-transactional-add-2026-08-01.md`. This plan is purely additive — it may *expose* bugs, but it fixes none. |
| **`doctor` folded in here** | `saasaloy doctor` validates descriptors against `registry-item.schema.json` via `ajv` — the same machinery the test suite exercises, and the same fixtures. Splitting it would duplicate both. |
| **E2E spawns the real binary** | Tests run `node dist/index.js` as a subprocess, not the command functions in-process. That is the only way to catch what actually breaks a release: argument parsing, the preserved shebang, exit codes, and whether the `files` array shipped `templates/`. |
| **Remote tests are hermetic** | A local HTTP fixture server, so tests are fast, offline-capable, and immune to GitHub rate limits (which the code already has explicit handling for). Rejected hitting a real pinned GitHub repo — network flakiness in a gate that must be trusted is worse than slightly lower fidelity. |
| **A testability seam is required** | `RemoteRegistrySource` calls global `fetch` against a module-level `GITHUB_API` constant, and fetches modules through giget's `github:` provider. Neither is redirectable today. This plan introduces an explicit seam — an overridable API base and a way to point giget at the fixture server — rather than reaching for broad module mocks. **Whether giget's `github:` provider can be redirected at all, or whether that boundary must be stubbed instead, is the open technical risk.** |
| **The matrix is derived, not maintained** | The combination test enumerates `modules/*/registry-item.json` from disk and generates pairs. Nobody hand-maintains a list; a new module joins the matrix by existing. |
| **Matrix assertion depth** | A pair passes when both modules apply with **no conflicts and no alias collisions**, and the resulting project **typechecks**. Full `build` per pair is too slow for a PR gate — see Open questions on cadence. |
| **Coverage is reported, not gated** | Add a v8 coverage reporter so the gaps are visible, but set no failing threshold initially. A threshold chosen before the suite exists would be arbitrary, and a low one is worse than none. |
| **Fixtures over the real registry** | Test modules are purpose-built fixtures (tiny, deliberately conflicting where needed), not copies of `api`/`database`/`waitlist`. Real modules change for product reasons; test fixtures should only change for test reasons. |

## Approach

Ordered so the cheapest, highest-density coverage lands first and the infrastructure-heavy work
comes after the seam it depends on.

### Phase 1 — Command-layer unit tests

The largest coverage gap and the one needing no new infrastructure.

- Extract or export `parseArgs` from `add.ts` so it's testable in isolation.
- Cover: unknown-flag rejection, extra-positional rejection, every flag combination, and each
  `parseCoordinate` form reaching the command (`name`, `owner/repo/name`, `owner/repo@ref/name`,
  bare `owner/repo`).
- Cover the **lock-pinning branch**: an entry in the lock pins the coordinate to its recorded SHA
  *unless* `SAASALOY_REGISTRY_DIR` is set, an explicit `@ref` was given, or the entry is `local`.
  That is three conditions and none is tested.
- Cover `--force` applying only the *requested* module and not its dependencies.
- Cover the already-installed early return, and `init`'s name validation, `--force`, `--no-install`.

### Phase 2 — The remote-registry seam and its tests

- Introduce the seam: an injectable GitHub API base and a redirectable module-download path.
  Prototype this **first** — if giget's `github:` provider can't be pointed at a fixture server, the
  design changes here and the rest of the phase follows from that answer.
- Stand up a fixture HTTP server that serves the two API responses `resolve()` needs
  (`default_branch`, then the commit SHA via the `application/vnd.github.sha` accept header) plus a
  module tarball.
- Test: SHA resolved once and reused across every module in one install; explicit `@ref` honored;
  `provenance()` throwing when called before resolution; `cleanup()` removing every temp dir;
  `listModules()` parsing the recursive tree response; and the three error paths the code already
  distinguishes — rate limit (403 with `x-ratelimit-remaining: 0`), 404, and generic API error.

### Phase 3 — Close the remaining library gaps

- **`resolve.ts`** — assert the topological post-order puts prerequisites first, and drive the
  existing cycle detection so its error message is pinned.
- Cover the currently untested `project.ts` (`findProjectRoot`), `saasaloy-config.ts`, `manifest.ts`,
  `scaffold.ts` (the `init` template copy and `PROJECT_NAME` substitution — completely unverified
  today), `diff.ts`, and `fs-utils.ts`.
- Add the v8 coverage reporter to `vitest.config.ts`.

### Phase 4 — End-to-end: the real binary against a real temp project

- A harness that builds the CLI, creates a temp directory outside the workspace, spawns
  `node dist/index.js init`, then `add` against a fixture registry via `SAASALOY_REGISTRY_DIR`.
- Assert on the artifacts, not the log output: files at their alias targets, `saasaloy.json`,
  `.saasaloy/manifest.json`, `saasaloy-lock.json`, `.claude/skills/` symlinks, and the merged root
  `package.json`.
- Cover the flows a unit test can't: `--dry-run` and `--diff` writing **nothing**, re-running `add`
  being idempotent, and a hand-edited managed file being reported as drift and **held back** rather
  than clobbered.
- **Seam with `plan-ship-the-cli-2026-08-01.md`:** that plan's Phase 5 release smoke test wants to
  run this same harness against an installed tarball rather than `dist/`. Build the harness so the
  binary under test is a parameter.

### Phase 5 — The combination matrix

- Enumerate `modules/*/registry-item.json` and generate every pair (plus each module alone).
- For each combination: scaffold a temp project, apply both, and assert no unexpected conflicts, no
  alias redefinition, and no dependency version disagreement — then typecheck the result.
- Report a conflict as a *named pair*, so a failure says which two modules disagree rather than
  which test index failed.
- Pairs are `n²`; see Open questions on where this runs.

### Phase 6 — `saasaloy doctor`

The author-facing half, for the third-party registry story (#39).

- `saasaloy doctor [path]` validates a descriptor against `registry-item.schema.json` with `ajv`,
  reporting every violation with a path, not just the first.
- Beyond schema: check that every `files[].path` exists on disk, that every `target` uses a known
  alias, that `dependsOn` names resolve within the registry, that `dependencies[]` are pinned
  `name@version` (per ADR 0017 and the deps workflow), and that declared `agent.skills` folders
  exist and carry the `saasaloy-` prefix required by ADR 0014.
- Reuse the CLI's existing `@clack/prompts` + `picocolors` presentation.

## Open questions

Targets for grillkit before this is filed as issues.

- **Can giget's `github:` provider be redirected?** The whole hermetic-remote approach rests on it.
  If not, does the seam move up to a `downloadModule` function that tests substitute — and does that
  weaken the test enough to want the nightly live check after all?
- **Where does the matrix run?** Pairs grow quadratically and Phase 3 quadruples the module count. On
  every PR, only when `modules/` changes, or nightly?
- **Is typecheck-per-pair fast enough** to gate a PR, or does the matrix need to assert on the
  applier's conflict report only and leave typechecking to a nightly job?
- **Do we want a live-GitHub canary** on a schedule, so a real GitHub API change still gets caught
  even though PRs are hermetic?
- **Should `doctor` validate remote coordinates** (`saasaloy doctor owner/repo/name`), or only local
  folders? Remote validation is what a *consumer* wants before installing a stranger's module;
  local is what an *author* wants.
- **Coverage threshold** — introduce one once the suite exists, and at what number?
- **Fixture location.** Under `packages/cli/src/__fixtures__`, or a top-level `test/fixtures/` shared
  with the e2e harness?

## Non-goals

- **Making `add` transactional** — `plan-transactional-add-2026-08-01.md`.
- **CI wiring** — `plan-ship-the-cli-2026-08-01.md` owns the workflows; this plan owns the tests
  those workflows run.
- **Replacing the manual QA docs.** The 10 documents in `docs/qa/` stay; automated tests cover
  regression, human QA covers whether the result is any good.
- **Testing generated-project behavior** beyond typecheck — whether a scaffolded Astro app renders
  correctly is the module's concern, not the applier's.
- **Reverse config patches (#36) and `remove` (#27)** — separately tracked.
