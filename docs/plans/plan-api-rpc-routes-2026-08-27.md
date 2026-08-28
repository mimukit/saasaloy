# Plan — api module on Hono RPC with a typed `AppType`

**Grilled:** 2026-08-28

**Issue:** [#86](https://github.com/mimukit/saasaloy/issues/86) · **Created:** 2026-08-27 · **Status:** hardened

## Context

Issue #86 cites this path, but the file was never committed to any ref. This document reconstructs it from the issue body and hardens it with a second grill on 2026-08-28, run after an unattended afkkit pass stopped at its spec gate with two unsettled decisions.

`modules/api` mounts routes by scanning a directory. `modules/api/files/src/index.ts:46-53` runs `import.meta.glob("./routes/*.ts", { eager: true })` and calls `app.route("/" + basename, module.default)` for each hit. A module adds a route by dropping one file into `@api/routes/` and touching nothing else. That is cheap to author and it gives a caller nothing: the mounted app's type is `Hono` with no route information, so `hc<typeof app>` infers no paths, no request bodies, and no response shapes.

The rework makes the route chain static. `src/index.ts` chains every route with `.route()` in one expression and exports the resulting type as `AppType`. A consumer imports `type { AppType }` and gets full inference from `hc`. Registration moves from the glob to the `chained-route` patch kind that #83 landed, so the CLI edits `src/index.ts` when a module is added and reverses the edit when it is removed.

Two modules put a file in `@api/routes/` today, `auth` and `waitlist`, so removing the glob loop unmounts exactly those two and nothing else.

Success: `hc<AppType>` against the dev Worker infers `/health` and the waitlist POST, `saasaloy add waitlist` wires the route through a patch instead of a drop, `saasaloy remove waitlist` leaves an api that compiles, and the typecheck cost of a wide chain is measured and written down.

## What the grill established

The first grill (2026-08-27) produced the issue as filed. The second (2026-08-28) settled seven decisions the issue left open. Two of them were blocking, and the rest fell out of the first two.

The blocking pair was the `Blocked by #84` prerequisite, which was not satisfied, and a Phase 2 acceptance criterion that contradicted a shipped skill.

## Design decisions (settled)

**Route files export chained sub-apps.** Carried over from the first grill. A route file default-exports a Hono sub-app built as one chained expression, so the sub-app's own type carries its paths.

**4xx and 5xx bodies use `errorSchema` from `@repo/validators/common`.** Carried over. The envelope is `{ error: { code, message } }`, built with `errorBody(code, message)`. `code` is a stable machine-readable string; `message` is for a human and may change.

**The better-auth catch-all mounts before the chain and stays out of `AppType`.** Carried over. Its routes are opaque to RPC inference by design.

**Consumers own a three-line `hc` client.** Carried over. `@repo/api` exposes a type-only `"./client"` export, and each consumer builds its own client against `PUBLIC_API_URL`. Per-feature clients are the documented mitigation if a wide chain gets expensive to typecheck.

**#84 lands in this branch by merge, not by waiting.** `modules/validators/` exists only on `origin/issue-84-add-the-validators-capability-module`, behind open PR #88. This branch merges that branch in, so Phase 2 can import `@repo/validators/common` before #88 is reviewed. A test merge against the current head is clean and brings seven commits. Because the merge shares commits rather than copying them, git treats them as common ancestry once #88 lands on `main`, and #86's own diff shrinks to its own work at that point.

**PR #88 stays open and merges first.** Merging #88 before reviewing #86 is what keeps #86's diff honest. Review them in that order, or #86 shows twelve files it did not author. Closing #88 and letting #86 carry validators was rejected: #84's work would land under a PR whose title says nothing about it, and #88's existing review comments would go nowhere.

**Issue #86's opening line changes from `Blocked by #84` to `Depends on #84, whose branch is merged into this issue's branch.`** issuekit refuses a `ready` issue whose body names an open blocker, and #84 stays open until #88 merges. The first afkkit run only reached the spec gate because #86 was already `in-progress`, which sends issuekit down its adopt path and skips the check. Rewriting the line states the true dependency and lets the guard pass on its own terms rather than by a skipped check.

**The waitlist route keeps returning success for a duplicate email. The 409 is struck from Phase 2.** This is the decision the spec gate refused to make on its own, and it reverses a criterion in the issue as filed.

`modules/waitlist/files/api/routes/waitlist.ts:23` inserts with `.onConflictDoNothing()`, so a resubmitted address returns the same `{ ok: true }` and inserts no second row. `modules/waitlist/skills/saasaloy-waitlist/SKILL.md` documents that twice, once as a section titled "Duplicate submissions are a success, not an error" and once as a boundary bullet at line 69 that says not to change it to a 409 without reconsidering the membership-leak tradeoff.

The tradeoff is real. A 409 tells an unauthenticated caller whether an address is already on the list, which turns the public form into a membership oracle. Issue #86 asked for `explicit 201/400/409 responses` without saying the tradeoff had been revisited, so the 409 reads as a reflex toward explicit status codes rather than a considered reversal.

Phase 2 therefore ships **201 and an `errorSchema`-shaped 400**, and leaves the duplicate on its success path. The envelope work still lands: the route today returns Hono's default 400 body from a bare `zValidator`, and it moves to the shared envelope through `zValidator`'s third-argument hook, exactly as the validators skill prescribes. Adding the 409 would also have required replacing `.onConflictDoNothing()` with `.returning()` and an empty-result check, since the route cannot currently tell a new address from a duplicate at all.

**Phase 2 fixes the waitlist skill's file-drop claim.** `modules/waitlist/skills/saasaloy-waitlist/SKILL.md:65` tells a reader the route is a pure file-drop and not to reach into `src/index.ts`. Phase 1 makes that false. Phase 3's docs work names `create-module`, `create-provider`, and the base template's `AGENTS.md`, which are the generic teaching surfaces, not this module-specific bullet. The bullet describes the waitlist route, Phase 2 is where that route changes, so Phase 2 corrects it rather than leaving a false statement shipped for a phase.

**A bad typecheck measurement changes the docs, not the design.** Phase 1 measures `pnpm typecheck` with roughly 30 synthetic chained routes and records the number in the api skill. There is no threshold that blocks the phase. Per-feature clients are already the settled mitigation, so a slow result changes the skill's guidance on when to reach for one. The number goes in the PR body so a reviewer sees it without opening the skill. Setting a threshold before any data existed was rejected as inventing a number, and spiking it before Phase 1 was rejected as a throwaway step against a design the first grill already settled.

## Approach

### Phase 1 — rework the api module to the RPC shape (built 2026-08-28)

- `modules/api/files/src/index.ts` keeps the `Bindings` type and the credentialed `CORS_ORIGINS` middleware, drops the `import.meta.glob` loop at lines 46-53, chains routes statically, and exports `AppType`.
- `routes/health.ts` follows the chained-export contract with an explicit 200.
- `apps/api`'s `package.json` gains a type-only `"./client"` export.
- Typecheck time with roughly 30 synthetic chained routes is measured and recorded in the api skill.
- `hc<AppType>` against the dev Worker infers `/health`.

### Phase 2 — migrate the waitlist module

- The waitlist route is chained with explicit **201 and 400** responses, the 400 shaped by `errorSchema` through `zValidator`'s failure hook. A duplicate email keeps its current success response.
- The input schema moves to `@repo/validators/waitlist`, dropped through the `@validators` alias that `modules/validators/registry-item.json` declares, and waitlist's `dependsOn` gains `validators`.
- `WaitlistForm.tsx` calls the api through `hc<AppType>` with `PUBLIC_API_URL`.
- `saasaloy remove waitlist` leaves a compiling api through the chained-route inverse.
- `modules/waitlist/skills/saasaloy-waitlist/SKILL.md` drops the route file-drop claim at line 65 and points at the chained-route patch.

### Phase 3 — auth mount, docs, and ADR

- The auth module's handler mounts before the typed chain and stays out of `AppType`.
- An ADR records the drop-to-patch route convention change.
- `create-module`, `create-provider`, and the base template's `AGENTS.md` teach the patch instead of the drop.
- The CLI test suite and `pnpm deps:verify` pass.

## Rejected alternatives

**Wait for PR #88 to merge before starting.** Cleanest diff, but it parks #86 behind a review that has no date. The merge-in reaches the same end state, and the shared-ancestry property means the diff self-corrects once #88 lands.

**Ship Phase 1 and Phase 3 and defer Phase 2 entirely.** Not viable. Phase 1 unmounts the waitlist route and Phase 3 only remounts auth, so a deferred Phase 2 ships a waitlist form that posts to a 404.

**Split Phase 2, chaining the route now and deferring the validators work.** Viable but wasteful. Waitlist would be migrated onto the chain twice, once with its local `z.object({ email })` and again when the shared schema arrives.

**Accept the membership leak and ship the 409.** Rejected on the merits above. It would also have pulled a SKILL.md rewrite and a reversal ADR into scope.

## Non-goals

- **The update flow for already-generated projects.** Tracked as #48. The chain patch relies on manifest hashes and three-way merge, with no anchor comments.
- **An email-confirmation flow on the waitlist.** Unchanged from the module as it ships.
- **Any second vendor or provider work.** This is one capability's internal shape.

## Verification

`pnpm exec turbo run test --force` and `pnpm typecheck` both pass on this branch as it stands, at 237 tests across 13 files. Two invocation notes for whoever runs the gate: a bare `pnpm test` replays another worktree's turbo cache on the shared dev box, and `pnpm test -- --force` fails because `--force` reaches vitest rather than turbo.
