# QA Plan: typecheck every full scaffold in release smoke

_Generated 2026-10-26 · against `80e5524` · covers issue #268_

## Summary

- `pnpm release:smoke` now runs `pnpm typecheck` after `pnpm lint` in every full scaffold. The list of checks is `FULL_SCAFFOLD_CHECKS` in `scripts/release-smoke.ts`, and `scripts/release-smoke.test.ts` pins it.
- Working means: a type error in a module file fails the smoke, and removing `typecheck` from the list fails the unit test.

## Environment

- Branch `issue-268-typecheck-every-full-scaffold-in-release-smoke`, commit `80e5524`.
- The smoke needs the network and a free port 3000 for its `astro dev` step.

## Test cases at a glance

| # | Test case | Result |
|---|-----------|--------|
| C1 | `pnpm release:smoke` runs `pnpm typecheck` in every full scaffold and exits 0 | ❌ unmet, see below |
| C2 | `release-smoke.test.ts` fails when `typecheck` leaves `FULL_SCAFFOLD_CHECKS` | ✅ |
| G1 | Repo gates: `pnpm lint`, `pnpm typecheck:scripts`, `node --test scripts/release-smoke.test.ts` | ✅ at `80e5524` |

## Results (agent, at `5ac0c7c`; the fix commit `80e5524` only removes a doubled comment opener, and G1 and C2 were re-run on it)

### C1: full smoke

- ❌ `pnpm release:smoke` did not exit 0. Run 1 stopped at its one-hour limit. Run 2 hung for about 10 hours in the `husky` prepare step of `pnpm install` in `full-database-d1-api-keys-user`, and the agent stopped it.
- In run 1, `pnpm lint` exits 1 in every complete full scaffold, before `typecheck` starts: `packages/ui/src/blocks/shell/data-table.tsx:271:5: error typescript(consistent-return): Function expected no return value.` The file ships from `modules/shell/files/ui/blocks/shell/data-table.tsx`, is identical on `main`, and this branch does not change it. The acceptance check confirmed the claim. The branch diff touches only `scripts/release-smoke.ts`, `scripts/release-smoke.test.ts` and `.github/workflows/smoke.yml`.
- The agent ran `pnpm typecheck` by hand in the scaffolds run 1 left on disk:

| Scaffold | `pnpm lint` | `pnpm typecheck` |
|---|---|---|
| full-database-d1-api-keys-organization | ❌ data-table.tsx:271 | ✅ 23/23 tasks |
| full-database-d1-api-keys-user | ❌ data-table.tsx:271 | ✅ 23/23 tasks |
| full-database-postgres-api-keys-user | ❌ data-table.tsx:271 | ✅ 23/23 tasks |
| full-database-postgres-api-keys-organization | not complete, run 1 stopped during `add` | not run |

### C2: the pin

- ✅ With `FULL_SCAFFOLD_CHECKS` set to `["lint"]`, `node --test scripts/release-smoke.test.ts` exits 1 with one failure. With the shipped value it exits 0.

## Manual cases

- [ ] After the `data-table.tsx` lint error is fixed on `main`, run `pnpm release:smoke` on a box with port 3000 free and confirm it exits 0 with all four full scaffolds, `full-database-postgres-api-keys-organization` included.
