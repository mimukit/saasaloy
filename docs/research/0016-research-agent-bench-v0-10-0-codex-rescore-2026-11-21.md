# Agent benchmark rescore for v0.10.0 with Codex

Date: 2026-11-21

All three products pass every applicable benchmark check after the scorer fixes. Each run records 11 PASS results, one N/A result and zero failures. The total is 33 passing checks and three N/A checks. Deployment remains N/A because all briefs request local builds.

This report supersedes the scores in [the original report](0015-research-agent-bench-v0-10-0-codex-2026-11-21.md). The original report retains the first scores and their evidence.

## Scorer fixes

The entity check now recognizes a root screen that calls the entity's Hono client. Shelfnote implements Books in `apps/app/src/routes/index.tsx` at `/`. The scorer accepts its `api.books.$get()` call without requiring `books` in the screen filename or route path. A screen that only names books in its copy still fails this check.

The validator check now recognizes the entity's filename in snake case or kebab case. Prepline's `packages/validators/src/prep-tasks.ts` exports generic validator names. The scorer recognizes that file without requiring `prep` in its contents. An unrelated validator filename still fails.

The audit parser now accepts lowercase statuses as well as uppercase statuses. Each audit correctly reports 12 passing checks. Failed audits with lowercase statuses also name the failed check.

Four regression tests fail before the fix. The scorer test suite passes after the fix. Additional tests cover camelCase and bracket API calls, and reject calls to another entity.

## Rescore method

The rescore runs against the same three generated products. Their git revisions and working-tree states remain unchanged. The scorer repeats `pnpm check`, both seed runs, authentication checks, the live audit and a fresh second-agent MCP check. The second agent uses the original Codex adapter with `gpt-6.2-sol`. Every rescore command exits 0.

```sh
node scripts/agent-bench.ts --score /tmp/saasaloy-bench-v0.10.0-codex/2026-11-21t08-09-53-323z
node scripts/agent-bench.ts --score /tmp/saasaloy-bench-v0.10.0-codex/2026-11-21t08-10-02-546z
node scripts/agent-bench.ts --score /tmp/saasaloy-bench-v0.10.0-codex/2026-11-21t08-10-03-323z
```

The raw headers retain the original build metadata. Their time, revision and clean-tree values describe the original builds, rather than the scorer fix. The original report explains why the headers name a planning-document commit after the 0.10.0 release. The CLI, templates and modules match 0.10.0. The rescore uses the uncommitted scorer fix in this working tree.

Scorer SHA-256: `527619755dd4dc06807d9c38f06e0d084774d0c3604b816d92342c46be13e024`

## Validation and evidence

The following checks pass:

- `node --test scripts/agent-bench/score.test.ts`, with 58 tests.
- `pnpm test`, including all 1,103 script tests.
- `pnpm build`.
- `pnpm typecheck`.
- `pnpm lint`.
- `pnpm docs:stale`.

The preserved rescore evidence is at `/home/dev/.cache/saasaloy-bench/v0.10.0-codex-2026-11-21/rescore-2026-11-21/`. It includes the new score tables, runtime logs, Codex transcripts, a scorer patch and verification logs. It excludes adapter credential state and installed tools. The parent directory retains the original products and original scores. The evidence has no remote backup.

## Raw rescore output

### Agent benchmark: shelfnote

Brief: shelfnote
Mode: interview
Revision: 5d1793159e5a1fc7072a240c9f0888543bde49d9
Tree: clean
Run: 2026-11-21t08-09-53-323z
Agent: node /home/dev/projects/saasaloy/scripts/agent-bench/agents/codex.ts
Port block: 628 (ports 16280, 16281, 16282, 16283, 16284, 16285, 16286, 16287, 16288, 16289)
Time: 15 min
Turns: unknown (the agent command did not report them)
Owner answers: 15
Cost: unknown (the agent command did not report it)
End: the build call exited 0 after the read-back

| #  | MVP bar line                                                                            | Result | Detail                                                                                                                                 |
| -- | --------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Landing page carries copy from the brief                                                | PASS   | names "Shelfnote", no default copy                                                                                                     |
| 2  | Sign up and sign in through `app`                                                       | PASS   | app answers; sign-up, sign-in and session work                                                                                         |
| 3  | Password reset mail in email-console output                                             | PASS   | reset mail logged by email-console                                                                                                     |
| 4  | One product entity end to end                                                           | PASS   | `books`: all 8 parts present                                                                                                           |
| 5  | `pnpm check` passes, `pnpm db:seed` twice same counts                                   | PASS   | pnpm check green, seed counts match                                                                                                    |
| 6  | One commit per stage on build/mvp, nothing pushed                                       | PASS   | 6 commits on build/mvp, nothing pushed                                                                                                 |
| 7  | docs/build-log.md records stages and human steps                                        | PASS   | 5 stages, 5 with a commit                                                                                                              |
| 8  | Interview ends with one read-back, no question after it                                 | PASS   | 1 read-back after 14 answer messages; no question after it                                                                             |
| 9  | Each entity of the spec end to end                                                      | PASS   | 1 entities, each with its log section, commit, table, api route, app screen, 401 with no session                                       |
| 10 | Preview answers when the brief asks for one                                             | N/A    | deploy: none, and no wrangler or deploy call                                                                                           |
| 11 | `pnpm agent:audit` exits 0 with a seeded key                                            | PASS   | exit 0; 12 checks pass, tools/list with the seeded key included                                                                        |
| 12 | A second agent with the address and a key creates and reads back one entity through MCP | PASS   | row 9ab60efa-55e6-48c4-9c94-5a25159295a1 created and read back; the scorer read it with books_list; 1 MCP tools/call in the transcript |

11/12 MVP bar lines pass, 1 N/A, 0 FAIL.

### Agent benchmark: prepline

Brief: prepline
Mode: interview
Revision: 5d1793159e5a1fc7072a240c9f0888543bde49d9
Tree: clean
Run: 2026-11-21t08-10-02-546z
Agent: node /home/dev/projects/saasaloy/scripts/agent-bench/agents/codex.ts
Port block: 641 (ports 16410, 16411, 16412, 16413, 16414, 16415, 16416, 16417, 16418, 16419)
Time: 19 min
Turns: unknown (the agent command did not report them)
Owner answers: 16
Cost: unknown (the agent command did not report it)
End: the build call exited 0 after the read-back

| #  | MVP bar line                                                                            | Result | Detail                                                                                                                                    |
| -- | --------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Landing page carries copy from the brief                                                | PASS   | names "Prepline", no default copy                                                                                                         |
| 2  | Sign up and sign in through `app`                                                       | PASS   | app answers; sign-up, sign-in and session work                                                                                            |
| 3  | Password reset mail in email-console output                                             | PASS   | reset mail logged by email-console                                                                                                        |
| 4  | One product entity end to end                                                           | PASS   | `prep_tasks`: all 8 parts present                                                                                                         |
| 5  | `pnpm check` passes, `pnpm db:seed` twice same counts                                   | PASS   | pnpm check green, seed counts match                                                                                                       |
| 6  | One commit per stage on build/mvp, nothing pushed                                       | PASS   | 7 commits on build/mvp, nothing pushed                                                                                                    |
| 7  | docs/build-log.md records stages and human steps                                        | PASS   | 6 stages, 6 with a commit                                                                                                                 |
| 8  | Interview ends with one read-back, no question after it                                 | PASS   | 1 read-back after 15 answer messages; no question after it                                                                                |
| 9  | Each entity of the spec end to end                                                      | PASS   | 2 entities, each with its log section, commit, table, api route, app screen, 401 with no session                                          |
| 10 | Preview answers when the brief asks for one                                             | N/A    | deploy: none, and no wrangler or deploy call                                                                                              |
| 11 | `pnpm agent:audit` exits 0 with a seeded key                                            | PASS   | exit 0; 12 checks pass, tools/list with the seeded key included                                                                           |
| 12 | A second agent with the address and a key creates and reads back one entity through MCP | PASS   | row f0297233-48a1-4601-b419-471cb0266c50 created and read back; the scorer read it with stations_list; 2 MCP tools/call in the transcript |

11/12 MVP bar lines pass, 1 N/A, 0 FAIL.

### Agent benchmark: receiptbox

Brief: receiptbox
Mode: interview
Revision: 5d1793159e5a1fc7072a240c9f0888543bde49d9
Tree: clean
Run: 2026-11-21t08-10-03-323z
Agent: node /home/dev/projects/saasaloy/scripts/agent-bench/agents/codex.ts
Port block: 161 (ports 11610, 11611, 11612, 11613, 11614, 11615, 11616, 11617, 11618, 11619)
Time: 21 min
Turns: unknown (the agent command did not report them)
Owner answers: 17
Cost: unknown (the agent command did not report it)
End: the build call exited 0 after the read-back

| #  | MVP bar line                                                                            | Result | Detail                                                                                                                                      |
| -- | --------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Landing page carries copy from the brief                                                | PASS   | names "Receiptbox", no default copy                                                                                                         |
| 2  | Sign up and sign in through `app`                                                       | PASS   | app answers; sign-up, sign-in and session work                                                                                              |
| 3  | Password reset mail in email-console output                                             | PASS   | reset mail logged by email-console                                                                                                          |
| 4  | One product entity end to end                                                           | PASS   | `receipts`: all 8 parts present                                                                                                             |
| 5  | `pnpm check` passes, `pnpm db:seed` twice same counts                                   | PASS   | pnpm check green, seed counts match                                                                                                         |
| 6  | One commit per stage on build/mvp, nothing pushed                                       | PASS   | 7 commits on build/mvp, nothing pushed                                                                                                      |
| 7  | docs/build-log.md records stages and human steps                                        | PASS   | 7 stages, 6 with a commit                                                                                                                   |
| 8  | Interview ends with one read-back, no question after it                                 | PASS   | 1 read-back after 15 answer messages; no question after it                                                                                  |
| 9  | Each entity of the spec end to end                                                      | PASS   | 2 entities, each with its log section, commit, table, api route, app screen, 401 with no session                                            |
| 10 | Preview answers when the brief asks for one                                             | N/A    | deploy: none, and no wrangler or deploy call                                                                                                |
| 11 | `pnpm agent:audit` exits 0 with a seeded key                                            | PASS   | exit 0; 12 checks pass, tools/list with the seeded key included                                                                             |
| 12 | A second agent with the address and a key creates and reads back one entity through MCP | PASS   | row ce8e6b2f-53fb-42c1-a3fd-d7da80f3a312 created and read back; the scorer read it with categories_list; 1 MCP tools/call in the transcript |

11/12 MVP bar lines pass, 1 N/A, 0 FAIL.

