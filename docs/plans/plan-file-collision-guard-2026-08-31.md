# Plan: cross-module file collisions are a general error

Grilled: 2026-08-31

## Context

`database-d1` and `database-postgres` both write `packages/db/drizzle.config.ts`, `packages/db/tsconfig.json` and `packages/db/src/client.ts`. The applier does not notice. The only thing stopping the second install from overwriting the first is the `conflictsWith` pair the two descriptors happen to declare. That field records a deliberate product decision, and here it is also the sole guard against a data-loss bug. A third driver whose author forgets the field, or any two unrelated modules that pick the same target, overwrite each other with no warning.

Found while splitting the database capability (#85), and recorded as an accepted gap in the ADR that split landed. Nothing about this is database-specific, so the fix belongs in the applier.

### The exact failure site

`classify` reads `manifest.managed[target]` and ignores `entry.module` (`packages/cli/src/lib/applier.ts:285-289`):

```
const managed = manifest.managed[target];
if (managed) {
  return { action: managed.hash === oldHash ? "overwrite" : "drift", oldContent };
}
```

Install `database-postgres` over `database-d1`'s `client.ts` and the managed entry is found, its hash matches what d1 wrote, the action is `overwrite`, and the file goes. The guard is a module comparison at that line. It is not a new record.

### What the issue got wrong

Issue #91 was filed before #98 and #85 fully landed. Three of its premises no longer hold, and the grill corrected each:

- **Ownership is not missing.** `.saasaloy/manifest.json`'s `managed` map is already target-keyed and already carries `module` (`manifest.ts:14-45`). `remove` already trusts `entry.module` to decide what it owns (`remover.ts:139-143`). The issue's `saasaloy-lock.json` framing is dropped; the lock is module-keyed provenance (ADR 0012) and a file list there would duplicate the manifest.
- **Same-run overlap is deliberate.** `buildPlan` documents it at `applier.ts:338-346`. `database` and its driver both scaffold `packages/db/tsconfig.json`; #98 fixed a real bug by keying on target and letting the last, most specific planner win. Phase 1 as originally written ("`buildPlan` fails when two modules in the same run plan a write to the same target path") would refuse `add database-d1` on day one.
- **`auth` and `waitlist` do not depend on a bare `database`.** The issue's closing paragraph says both declare `dependsOn: ["api", "database"]` and therefore produce a project that does not compile. Both already name `database-d1` explicitly. So `add waitlist` on a clean project resolves a driver and compiles today. The real defect is the reverse: the driver is hardcoded, so `add waitlist` onto a Postgres project drags in `database-d1` and dies on its `conflictsWith`.
- **The Phase 3 mechanism already exists.** `requiresOneOf` is implemented and shipped (`requires.ts`, `resolve.ts:54`, the prompt loop at `add.ts:414`; ADR 0026, #98). `modules/database` already declares it, naming both drivers. Nothing needs designing.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Which same-run overlaps are legal (Q1) | An overlap is legal when one module reaches the other through `dependsOn` in the resolved graph. Otherwise it is refused. This keeps last-planner-wins for core-plus-driver and catches the unrelated pair the issue is about. |
| Where file ownership lives (Q2) | `.saasaloy/manifest.json`'s `managed` map. No new record, no lock change. |
| Whether `--force` overrides a collision (Q3) | No. `--force` never crosses module ownership, matching `conflictsWith`, which deliberately ignores it. The refusal names `remove <other>` as the way through, because that path already leaves ownership consistent. |
| How a module legitimately claims another's file (Q4) | `dependsOn` is the declaration. A module may write over a file owned by a module it depends on, and over nothing else. No new descriptor field. This one rule answers Q1's legal case and Q4 together. |
| Whether driver selection stays in scope (Q5) | Yes. Phase 3 stays in this issue, because the mechanism turned out to be built already. |
| Where the refusal fires (Q6) | `buildPlan`, for both checks, before any write. `add` is transactional, so a per-file fatal action would leave a plan that must not execute. `classify` gains the `managed.module` comparison and reports it; `buildPlan` collects every collision and raises one `RefusalError` naming all contested paths. |
| Where the tests go (Q7) | A new `lib/collisions.ts` with a paired `collisions.test.ts`, mirroring `conflicts.ts` / `conflicts.test.ts`. `applier.test.ts` is already 1903 lines, and #47's e2e harness does not exist yet, so blocking a data-loss fix on it is wrong. |
| Whether the hardcoded drivers come out (Q8) | Yes. Drop `database-d1` from `waitlist` and `auth`, letting `database`'s `requiresOneOf` prompt fire. A Postgres pick then yields `waitlist`'s `drizzle-orm/sqlite-core` schema, which fails loudly at typecheck. A loud failure on a combination that never worked beats a silent driver override. The dialect gap becomes its own issue. |

## Approach

Put the rule in one place. `lib/collisions.ts` answers two questions against the resolved graph and the manifest: may these two modules in this run share a target, and may this module write over this installed file. `buildPlan` calls it and refuses once.

**Reuses:** `listModuleFiles` (`applier.ts:167`), which already enumerates `files[]`, `scaffolds[].files[]` and `agent.skills` targets for a module, so the issue's "covers `files[]` and `scaffolds[].files[]` alike" criterion needs no new traversal; the `Graph` from `resolve.ts` for reachability; `manifest.managed` for ownership; `RefusalError` from `lib/exit.js`; the `conflicts.ts` module-and-test shape.

Rejected alternatives, one line each. A per-file `FileAction` surfaces the collision in `--dry-run` but produces a plan that must never execute. A new `overrides: []` descriptor field is explicit but makes every driver author maintain a list that goes stale.

### Phase 1: refuse a collision inside one `add` run

- [ ] `lib/collisions.ts` exposes the graph-reachability rule: an overlap between two modules is legal when one reaches the other via `dependsOn`
- [ ] `buildPlan` collects same-run target overlaps and refuses the illegal ones before planning any write
- [ ] the message names both modules and the contested path, and points at `conflictsWith` for a deliberate exclusion
- [ ] the check covers `files[]` and `scaffolds[].files[]` targets alike, which `listModuleFiles` already gives for free
- [ ] `add database-d1` still installs, with the core-plus-driver `tsconfig.json` overlap intact
- [ ] `collisions.test.ts` covers a legal core-plus-driver pair and an illegal unrelated pair

### Phase 2: refuse a collision against what is already installed

- [ ] `classify` compares `managed.module` to the installing module and reports a cross-module claim
- [ ] `buildPlan` raises one `RefusalError` naming every contested path, before any write
- [ ] a module re-installing or updating its own file is unaffected
- [ ] a module writing over a file owned by a module it depends on is allowed, per Q4
- [ ] `--force` does not override the refusal; the message names `remove <other>`
- [ ] `remove` leaves ownership consistent, so reinstalling the other driver afterwards is clean
- [ ] the `--force` behaviour is documented

### Phase 3: a feature names the capability, never the driver (built 2026-09-01)

- [ ] drop `database-d1` from `modules/waitlist`'s `dependsOn`, leaving `["api", "database", "validators"]`
- [ ] drop `database-d1` from `modules/auth`'s `dependsOn`, leaving `["api", "database"]`
- [ ] `add waitlist` on a clean project fires `database`'s existing `requiresOneOf` prompt and installs the picked driver
- [ ] the same command on a non-interactive terminal refuses, naming both drivers
- [ ] `create-module` and `create-provider` teach the rule: a feature names the capability, and `requiresOneOf` on the capability names the drivers
- [ ] file the follow-up issue for the dialect gap

## Open questions

None. The grill closed every branch.

One consequence is accepted rather than solved. After Phase 3, picking `database-postgres` and then adding `waitlist` installs a `drizzle-orm/sqlite-core` schema against a Postgres client. That combination has never worked; the change makes it fail at typecheck instead of silently overriding the user's driver choice. The follow-up issue owns it.

## Non-goals

- No change to `conflictsWith` semantics. This issue exists so that field stops carrying a job it was not designed for, not to replace it.
- No file list in `saasaloy-lock.json`.
- No new descriptor field. `dependsOn` and `requiresOneOf` cover both rules.
- No rewrite of `waitlist`'s or `auth`'s Drizzle schemas.
- No e2e harness. #47 owns that, and this fix does not wait for it.
