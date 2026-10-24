# Plan: close #252, the payments screen admin imports

Grilled: 2026-10-24

## Context

Issue #252 reports 22 typecheck errors in `@repo/admin` for any project that adds `payment`. `modules/payment/files/admin/routes/payments.tsx` imported seven `@admin/components/*` paths that `f7ff0a5` (the coss ui admin shell rebuild) removed. The #220 afkkit run found it in the full `database-d1` scaffold and filed it.

The fix is already on `main`. Plan 0082 (#217) took it into its Phase 6, and `f0d6928a` (`feat(payment): move the payments page onto the admin parts`, PR #258, merged 2026-10-24) moved every import to `@repo/ui`. `ed68964b` (`feat(shell)!: move the admin ui kit into a shell module`) later moved those paths again to `@repo/ui/{blocks,components,containers}/shell/*`, and `payments.tsx` follows them. #252 stayed open because #258 closed #217 only.

Goal: the tracker shows no open bug for a defect that `main` no longer has, and the evidence for the fix sits on the issue.

Target: no number fits a close-out. The check is the two #252 acceptance criteria, each with recorded evidence:

- Criterion 1 (typecheck): on `main` at `7eb3a584`, a fresh `.dev/r252` scaffold with `database-d1 admin payment` passes `pnpm --filter @repo/admin typecheck` (exit 0) and root `pnpm typecheck` (11 of 11 tasks). Run on 2026-10-24 during planning.
- Criterion 2 (list, filter, open): `docs/qa/0075-qa-admin-status-tones-detail-slots-table-cards-2026-10-24.md` records the browser checks of the payments table, the status chips and the detail panel at `122e9d2`, and the admin `vite build` and `typecheck` exit 0 there. At the base `32c6720` both exit 1 with the same 22 errors.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Code change | None. `main` already holds the fix in `f0d6928a`. |
| Visual change and mockup | None (grill Q4, defaulted). The plan changes no screen, so the AGENTS.md mockup rule does not apply. The payments layout was approved in the #217 mockup round 1 on 2026-10-24. |
| Regression guard | No new guard in this plan (grill Q3, defaulted). #268 (`ci(repo): typecheck every full scaffold in release smoke`, open) runs the real `tsc` over every full scaffold, which catches this class of error and more. |
| Fate of #252 | Close as completed by #258 (grill Q1, asked). Swap `needs-planning` for `ready` so the label history stays uniform, then close in the same step, so no unattended run picks up an issue with no work left. |
| Evidence for criterion 2 | QA 0075 at `122e9d2` plus the 2026-10-24 typecheck on `main` (grill Q2, asked). No fresh browser pass: `ed68964b` changed only the import paths of `payments.tsx`. |
| Approved outward actions | All four in Phase 1 (grill Q5, asked): the evidence comment on #252, ticking both criteria, closing #252, and a note on #268. The commit and push of this plan file to `main` were approved in the planning brief. |

## Approach

Close #252 as completed by #258, with the evidence above in a closing comment. Reuse: the #217 QA record (0075) and the scaffold commands from `docs/qa/0079-qa-admin-route-tree-typecheck-2026-10-24.md`.

Rejected alternatives:

- Port the imports again under #252. Nothing is left to port. The file already imports from `@repo/ui/*/shell`.
- Add a static test in `scripts/` that checks each `@admin/components/<name>` import in `modules/*/files` against the files a module ships. It is cheap and has no install step, but it covers one alias only, and #268 covers the same failure with the real compiler.

### Phase 1: close #252 with evidence

Attended: the owner approves the closing comment, because it is an outward action.

1. Post a comment on #252 that links this plan and names `f0d6928a` and PR #258, the `.dev/r252` typecheck result, and QA plan 0075 at `122e9d2` for criterion 2, with the note that `ed68964b` changed only import paths.
2. Tick both acceptance criteria in the #252 body.
3. Swap `needs-planning` for `ready`, then close #252 as completed.
4. Comment on #268 that #252 is closed. Keep its `blocked` label, because #253 and #266 stay open.

Done when: `gh issue view 252 --json state,stateReason` prints `CLOSED` and `COMPLETED`, and the last comment names `f0d6928a` and #258.

## Open questions

None. The grill on 2026-10-24 settled all of them.

## Non-goals

- The full-scaffold typecheck in `release:smoke`. #268 owns it.
- `SendEmail` in `@repo/email-react` (#253) and the auth test lint failure from the #220 run.
- Any change to the payments screen layout, which #217 settled.
