# Plan — Audit remediation: security, driver split, engine drift, CI

Grilled: 2026-08-31

## Context

A four-part review on 2026-08-30 covered the 13 modules, the CLI architecture, the security surface,
and developer experience. It found the project in good shape structurally: the plan/execute split is
clean, the patch engine is pure, 361 CLI tests pass in about 5 seconds, and the comments cite ADRs
and issues. The problems are concentrated, not diffuse. Four of them are worth a plan.

**The install write path has no traversal guard.** `packages/cli/src/lib/applier.ts:162` builds every
destination as `join(root, ...target.split("/"))`. It never imports `resolveWithinRoot`, though
`remover.ts` uses that guard at six sites and `updater.ts` at six more. `add` is the one engine that
consumes an untrusted remote descriptor, and it is the one engine without the guard. The descriptor
schema does not close the gap either: `files[].target` matches `^@[a-z0-9][a-z0-9-]*/.+`, so
`@web/../../.git/hooks/pre-commit` passes validation. Third-party registries are a documented
coordinate form (`owner/repo/name`), so this is a reachable path, not a theoretical one.

**The driver split landed in `database` and stopped there.** [ADR
0023](../adr/adr-0023-database-driver-split-2026-08-28.md) split the core from `database-d1` and
`database-postgres` and claimed `auth` and `waitlist` need no branch. The shipped payloads
contradict it: `modules/auth/files/src/auth.ts` types `DB: D1Database` and passes
`provider: "sqlite"`, and both `auth` and `waitlist` declare their tables with `sqliteTable`. Neither
descriptor declares `conflictsWith: ["database-postgres"]`. A user who installs `database-postgres`
and then `auth` gets no refusal and no warning, just a typecheck failure later.

**Three engines that should share code have drifted apart.** `updater.ts` (1127 lines) hand-copies
`buildPlan`'s file enumeration, duplicates its patch preview, and byte-copies `samePatchEntry` from
`manifest.ts`. The duplication is why the safety rules diverged in the first place: `remover` and
`updater` re-check disk before writing, and `applier` does not.

**Nothing gates any of it.** There is no `.github/` directory, yet `lint-staged.config.js` says
"`pnpm lint` in CI is what catches those". The suite that would catch a regression takes 5 seconds
and runs only when a human remembers.

Success means: no descriptor can write outside the project root, a mismatched driver is refused at
`add` time rather than at typecheck, the three engines share one enumeration and one set of guards,
and a push runs lint, typecheck, and tests.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| CI or security first | CI first. It is a few hours of work, it takes the 5-second suite off human memory, and every later phase lands behind it. Security is second, not third. |
| Point-fix the guards, or refactor first | Point-fix. Phase 2 adds `resolveWithinRoot` and `assertNoSymlinkPath` to `applier.ts` directly; Phase 4 removes the duplication that let them drift. Shipping a security fix behind a 1127-line refactor delays it for no safety gain. |
| Split CI out of [#46](https://github.com/mimukit/saasaloy/issues/46) | Yes. #46 bundles CI with npm publish at low priority, so the cheap half is blocked behind the hard half. CI becomes its own issue. |
| Driver split, near-term shape | Declare the constraint. `auth` and `waitlist` gain `dependsOn: ["database-d1"]` so `add` refuses the broken combination today. Driver-conditional payloads are the better end state and stay an open question. |
| Scope of the security fix | Both write-path findings together: the traversal guard and the `package-json-script` lifecycle namespace. They are the same trust boundary and the same review. |
| What this plan does not carry | The module roadmap (billing, teams, sms, infra, email providers). Those have issues and are feature work, not remediation. |
| Where the untracked findings go | issuekit files them after the grill. This plan is the source; the phases below map to issues roughly one-to-one. |
| Driver split end state | `dependsOn: ["database-d1"]` is a stopgap. File a follow-up issue for dialect-neutral `auth`/`waitlist` payloads, and amend ADR 0023 to retract the "no branch needed" claim. |
| How `database` requires one driver | A new descriptor schema field, `requiresOneOf: ["database-d1", "database-postgres"]`, enforced by `add`. The interactive path adds a driver prompt on top in the same phase. |
| `package-json-script` hardening | Denylist only, blocking install-lifecycle keys. The plan preview already shows every patch before the confirm, so no second prompt. The patch type stays scoped to the `scripts` map. |
| Traversal fix and the schema | Tighten now. No known descriptor (14 first-party, the example, every test fixture) uses a `.`/`..` target segment, and no third-party registry has ever been exercised. Skill link paths (`.agents/skills/<name>`) are a dot-leading namespace and stay on the runtime `resolveWithinRoot` guard, outside the schema pattern. |
| `nextSteps` | No descriptor field. `add` ends with a pointer to the installed skill and a re-print of the required env vars. The skill stays the single source of the procedure. |
| Partial apply ([#49](https://github.com/mimukit/saasaloy/issues/49)) | Reorder now: write deps only after `executePlan` succeeds, folded into Phase 4. The full journal stays deferred in #49; bump it only if the reorder proves insufficient. |
| Waitlist rate limiting | Wait for the `ratelimit` capability. The waitlist skill and docs name the exposure and point at Turnstile as the interim. |
| The `web` pseudo-module | Migrate to a first-class `base` field in `saasaloy.json`. About 10 edits: it deletes the `managedModules` plumbing (`manifest.ts:60-77`, three sites in `conflicts.ts`, `add.ts:296-300`) instead of teaching it to every new engine. Lands in Phase 6. |
| Phase 6 issue shape | One issue. The `git init` decision is made here: implement `git init` in `commands/init.ts`; do not amend the documents. Three documents and a QA plan already promise it, and without it husky and turbo misbehave. |

## Approach

Six phases, ordered so each one lands behind the gate the previous one built. Phases 1 through 3 are
sequential by dependency. Phases 4 through 6 are independent of each other and can run in any order
once 3 is done.

What this reuses, rather than invents:

- `resolveWithinRoot` and `assertNoSymlinkPath` in `packages/cli/src/lib/fs-utils.ts:37` and `:81`
  already exist, are documented, and are already used by two of the three engines.
- `recheckFile` (`remover.ts:358`) and `stillMatches` (`updater.ts:928`) are the re-check pattern
  the applier is missing. Copy the shape, do not invent a new one.
- `validateManifest` / `validateLock` in `schema.ts` exist and are called only by tests.
- The `diff` package (already a dependency, used by `patch/diff.ts`) replaces the hand-rolled LCS.
- `conflictsWith` and `detectConflicts` already enforce driver exclusion for `add`; the driver work
  extends the existing mechanism rather than adding one.

### Phase 0: CI gate (#98) (built 2026-08-31)

The cheapest phase and the one everything else leans on.

- Add `.github/workflows/ci.yml` running `pnpm lint`, `pnpm typecheck`, `pnpm test` on push and PR.
- Add `pnpm verify:content` to the same workflow. It is fast, textual, and offline.
- Add `--coverage` to the CLI test script so the untested applier paths that
  [#47](https://github.com/mimukit/saasaloy/issues/47) worries about become visible.
- Leave `deps:verify` out of per-push CI. It rebuilds the playground and installs; a nightly job
  fits it better. `verify:preset` stays manual, as CONTRIBUTING intends.

Verifiable by: a red build on a deliberately broken lint rule.

### Phase 1: Close the two write-path holes (#98) (built 2026-08-31)

- Route every planned write in `applier.ts` through `resolveWithinRoot`: module file targets
  (`:162`), skill link paths (`:272`, `:273`), and patch files (`:308`).
- Call `assertNoSymlinkPath` before each write, matching `remover.ts:236` and `:449`.
- Tighten `schemas/registry-item.schema.json` to forbid `.` and `..` path segments in
  `files[].target`, scaffold targets, and `patches[].file`. Defense in depth, not the primary fix.
- Restrict `package-json-script` patches (`patch/pkg-json-script.ts:33`) so they cannot create an
  install lifecycle key (`preinstall`, `install`, `postinstall`, `prepare`, `prepublish*`).
- Add tests for each refusal, including a malicious-descriptor fixture.

Verifiable by: a descriptor whose target escapes the root fails with a named refusal, and the
existing suite stays green.

### Phase 2: Close the driver split (#98) (built 2026-08-31)

- Declare `dependsOn: ["database-d1"]` on `auth` and `waitlist` so `add` refuses a mismatched driver
  instead of failing at typecheck. This is a stopgap; file a follow-up issue for dialect-neutral
  payloads and amend ADR 0023 to retract the "no branch needed" claim.
- Give `database` a machine-checkable "requires one driver" gate via a new descriptor schema field,
  `requiresOneOf: ["database-d1", "database-postgres"]`, enforced by `add`, with a driver prompt on
  the interactive path. Without it, `add auth` can leave a project whose `@repo/db/client` import
  resolves to nothing: `modules/database/files/package.json` exports `./client`, but only a driver
  ships `src/client.ts`.
- Ship a `withDb`-style helper or middleware for `database-postgres`, so the
  `waitUntil(db.$client.end())` requirement in its client docstring stops being a per-route
  obligation nobody demonstrates. A forgotten `end()` leaks a socket per request.
- Update the `auth`, `waitlist`, and `database` skills, which currently document only the D1 script
  names (`db:migrate:local`, `wrangler d1 execute`).

Verifiable by: `add database-postgres` then `add auth` refuses with a clear message; `add database`
alone either refuses or prompts for a driver.

### Phase 3: Fail-closed auth secret (#98) (built 2026-08-31)

Small, separable, and security-relevant, so it does not wait behind the refactor.

- `modules/auth/files/src/auth.ts:87` falls back to Better Auth's development default with a console
  warning when `BETTER_AUTH_SECRET` is unset. A production Worker missing the secret signs sessions
  with a well-known key. Throw outside local dev instead of warning.
- Add unit tests for `deriveCookieDomain` here, since the file is already open.

### Phase 4: Unify the three engines (#98) (built 2026-08-31)

The structural fix. It removes the duplication that produced the Phase 1 drift.

- Extract one "enumerate a module's files" function from `buildPlan` and `updater.ts:458-486`, which
  currently hand-copies the three rules and says so in a comment.
- Extract one patch-preview helper shared by `applier.ts:305-343` and `updater.ts:763-803`.
- Delete the private `samePatchEntry` (`updater.ts:1121-1127`) in favor of the export in
  `manifest.ts:54-60`.
- Add a plan-to-execute re-check to `add`, so a file edited while the confirm prompt is open is not
  clobbered. This is the drift-is-sacred invariant, honored by two engines out of three.
- Stop `executePlan` rewriting byte-identical files. `WRITABLE` includes `unchanged`
  (`applier.ts:32-36`); `executeUpdatePlan` already skips this case and explains why.
- Reorder the `add` dep write so `package.json` changes land only after `executePlan` succeeds. The
  common mid-`add` failure then leaves no half-state. The full rollback journal stays deferred in
  [#49](https://github.com/mimukit/saasaloy/issues/49).

### Phase 5: `update` command correctness (#98) (built 2026-08-31)

Four defects in one command, worth one pass.

- Carry `conflictsWith` through `ModuleUpdatePlan` and write it back to the lock
  (`updater.ts:1065-1071`). Today one update silently drops it, degrading the driver-exclusion check.
- Run `detectConflicts` over each update's prerequisite graph. `commands/update.ts` never imports it,
  so an update can install a second driver that `add` would refuse.
- Stop auto-approving on a non-TTY stdout (`update.ts:376-384`). `saasaloy update | tee log` applies
  everything unconfirmed. Gate on stdin instead, or require `--yes`.
- Report new `envVars` on update. `planOneModule` never reads them, so a version that adds a required
  secret updates silently while `add` prints a note.
- Validate the manifest and lock on load with the existing `validateManifest` / `validateLock`.

### Phase 6: DX papercuts and doc truth (#98)

Independent, individually small, collectively the difference between a tool that feels finished and
one that does not.

- **Next steps after `add`.** `add waitlist` ends at "Applied" while the project 500s until
  `db:generate` and `db:migrate:local` run, and env vars print at plan time and scroll away. Fix: no
  `nextSteps` descriptor field; `add` ends with a pointer to the installed skill and a re-print of
  the required env vars.
- **`.dev.vars.example`.** The base `_gitignore` carves out an exception for it; no module or
  template ships one. Generate it from the descriptors' `envVars` maps.
- **`--version`, `--help`, non-TTY guards.** No `--version` handler exists, so bug reports cannot
  name the build. `add --help` dies with "Unknown argument(s)". `init` and `list` silently ignore
  unknown flags, while `add`/`remove`/`update` reject them.
- **Exit codes and error causes.** Every failure exits 1, so a script cannot tell "refused by design"
  from "network broke". The top level prints `error.message` and discards the `cause` chain set at
  `registry.ts:287`. Add a debug env var.
- **Registry fetch timeout.** `registry.ts:405` has no timeout or retry, so a hung connection hangs
  the CLI. The failure hint never mentions `SAASALOY_REGISTRY_DIR` as the offline path.
- **`list` cannot tell installed from available**, and the `add` picker offers installed modules.
- **The `git init` regression.** ADR 0024, CONTRIBUTING, and `docs/qa/` all say `init` creates the
  repository. Neither `commands/init.ts` nor the built bundle contains it. Without the repo, husky
  hooks do not install and turbo serves a stale cache, so `deps:verify` can validate a cached build
  of the old template. Decision: implement `git init` in `commands/init.ts`; do not amend the
  documents.
- **Retire the `web` pseudo-module.** Move the base app to a first-class `base` field in
  `saasaloy.json`, drop `installed: ["web"]` from the template, and delete the `managedModules`
  plumbing (`manifest.ts:60-77`, the three excuse sites in `conflicts.ts`, `add.ts:296-300`). About
  10 edits plus test fixtures.
- **Docs truth pass.** The wiki says "four commands" and never names `update`, a 797-line command
  with its own flags. `docs/wiki/modules.md` lists 7 of 13 modules. `templates/base/README.md`
  advertises a `billing` module that does not exist, and its `AGENTS.md` tells agents to run a
  `pnpm test` that does not exist. CONTRIBUTING claims changesets the repo does not use.
- **Five ADRs share number 0023**, so the bare "ADR 0023" citations in module comments are
  ambiguous. Renumber the three late 2026-08-28 files and fix the cross-references.
- **Node floor drift.** Root says `>=24.0.0`, the CLI says `>=24.13.0`, `.nvmrc` pins 24.18.0, the
  README says 24.13.0+, and `engineStrict` is on.
- **Dependency drift across modules.** `@cloudflare/workers-types` is pinned at two versions;
  `@tanstack/react-router` and `@tanstack/router-plugin` are out of lockstep; `api` pre-bakes `zod`
  and `@hono/zod-validator` that no base file imports.
- **Tests for payload logic.** `email/render.ts` (`escapeHtml`, `safeUrl`), `logger/define.ts`
  (`redact`), and `auth.ts` (`deriveCookieDomain`) are security-relevant and untested. No scaffolded
  package ships a `test` script. `scripts/update-deps.ts` is 1355 lines with zero tests and a known
  write bug ([#93](https://github.com/mimukit/saasaloy/issues/93)).
- **`WaitlistForm.tsx` ignores the typed error envelope** the API builds on purpose, so the proof
  module never exercises its own `{ error: { code, message } }` contract.

### Rejected alternatives

- **Refactor the three engines first, then fix the guards.** Cleaner in principle, but it holds a
  reachable path-traversal fix behind a 1127-line restructure.
- **Fix the driver split by making `auth` and `waitlist` dialect-neutral now.** The right end state,
  but it is a payload rewrite across two modules and their skills. Declaring the constraint stops
  the silent failure this week; neutrality can follow.
- **One "hardening" issue for everything.** Too large to review or to stop halfway.

## Open questions

None. The 2026-08-31 grill settled all nine, plus the `git init` direction. The resolutions live in
the "Design decisions (settled)" table above and are folded into the phases.

## Non-goals

- **New modules.** billing ([#14](https://github.com/mimukit/saasaloy/issues/14)), teams
  ([#16](https://github.com/mimukit/saasaloy/issues/16)), sms, infra, and the email providers are
  feature work with their own issues and plans.
- **npm publish.** [#46](https://github.com/mimukit/saasaloy/issues/46) keeps it. This plan takes
  only the CI half.
- **Admin authorization.** [#97](https://github.com/mimukit/saasaloy/issues/97) owns it. The review
  confirmed no unprotected admin data route ships today.
- **The security items that checked out clean.** CORS allowlisting, cookie-domain derivation, email
  HTML escaping, `safeUrl`, login enumeration, Drizzle parameterization, and the SHA-pinned registry
  fetch were all read and found sound. They need no work here.
- **Waitlist rate limiting.** It waits for the `ratelimit` capability. Until then, the waitlist
  skill and docs name the unthrottled endpoint and point at Turnstile as the interim.
- **Security response headers** (CSP, HSTS, `X-Frame-Options`). Real but low severity, and better
  placed with the infra module than in a remediation pass.
- **An exhaustive nitpick sweep.** Filename-case drift, timestamp-mode drift between the two schema
  files, and similar small inconsistencies are recorded in the review but not scheduled here.
