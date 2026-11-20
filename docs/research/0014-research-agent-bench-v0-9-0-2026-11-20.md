# Agent benchmark for v0.9.0

Date: 2026-11-20

All three briefs pass with 11 PASS results and one N/A result each. Each brief selects a local build, so the deployment check does not apply.

## Method

Shelfnote and Prepline use Claude Code. Receiptbox uses Codex CLI 0.171.0 with `gpt-6.2-sol`. The agents differ, so these results do not support a direct comparison of time or cost. Codex reports no dollar cost or turn count.

All three builds use interview mode at `340da5ea06e3cd3921a02ad9124b7856efeeea07`. The dirty runs change only benchmark files in this repository. No gated source file changes after that revision.

The Receiptbox build completes before the scorer supports Codex command events. A parser fix adds that support. A fresh rescore checks the unchanged product and starts another Codex agent for the MCP check. The test for this fix fails before the parser change and passes after it.

The following scores come from the benchmark output.

## Agent benchmark: shelfnote

Brief: shelfnote
Mode: interview
Revision: 340da5ea06e3cd3921a02ad9124b7856efeeea07
Tree: clean
Run: 2026-11-20t10-06-44-615z
Agent: /home/dev/.local/share/mise/installs/node/24.22.3/bin/node /home/dev/projects/saasaloy/scripts/agent-bench/agents/claude.ts
Port block: 677 (ports 16770, 16771, 16772, 16773, 16774, 16775, 16776, 16777, 16778, 16779)
Time: 16 min
Turns: 104 over 11 agent calls
Owner answers: 10
Cost: $6.24, the sum of what each agent call reported
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
| 8  | Interview ends with one read-back, no question after it                                 | PASS   | 1 read-back after 8 answer messages; no question after it                                                                              |
| 9  | Each entity of the spec end to end                                                      | PASS   | 1 entities, each with its log section, commit, table, api route, app screen, 401 with no session                                       |
| 10 | Preview answers when the brief asks for one                                             | N/A    | deploy: none, and no wrangler or deploy call                                                                                           |
| 11 | `pnpm agent:audit` exits 0 with a seeded key                                            | PASS   | exit 0; 0 checks pass, tools/list with the seeded key included                                                                         |
| 12 | A second agent with the address and a key creates and reads back one entity through MCP | PASS   | row c0ad1989-7d67-4bce-b6c3-849aa6d12d3f created and read back; the scorer read it with books_list; 2 MCP tools/call in the transcript |

11/12 MVP bar lines pass, 1 N/A, 0 FAIL.

## Agent benchmark: prepline

Brief: prepline
Mode: interview
Revision: 340da5ea06e3cd3921a02ad9124b7856efeeea07
Tree: dirty
Run: 2026-11-20t13-00-22-226z
Agent: /home/dev/.local/share/mise/installs/node/24.22.3/bin/node /home/dev/projects/saasaloy/scripts/agent-bench/agents/claude.ts
Port block: 988 (ports 19880, 19881, 19882, 19883, 19884, 19885, 19886, 19887, 19888, 19889)
Time: 22 min
Turns: 119 over 4 agent calls
Owner answers: 3
Cost: $4.09, the sum of what each agent call reported
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
| 8  | Interview ends with one read-back, no question after it                                 | PASS   | 1 read-back after 1 answer messages; no question after it                                                                                 |
| 9  | Each entity of the spec end to end                                                      | PASS   | 2 entities, each with its log section, commit, table, api route, app screen, 401 with no session                                          |
| 10 | Preview answers when the brief asks for one                                             | N/A    | deploy: none, and no wrangler or deploy call                                                                                              |
| 11 | `pnpm agent:audit` exits 0 with a seeded key                                            | PASS   | exit 0; 0 checks pass, tools/list with the seeded key included                                                                            |
| 12 | A second agent with the address and a key creates and reads back one entity through MCP | PASS   | row e73b76fd-2ef7-4642-9809-beb8f102fd7b created and read back; the scorer read it with stations_list; 2 MCP tools/call in the transcript |

11/12 MVP bar lines pass, 1 N/A, 0 FAIL.

## Agent benchmark: receiptbox

Brief: receiptbox
Mode: interview
Revision: 340da5ea06e3cd3921a02ad9124b7856efeeea07
Tree: dirty
Run: 2026-11-20t13-49-31-627z
Agent: node /home/dev/projects/saasaloy/scripts/agent-bench/agents/codex.ts
Port block: 871 (ports 18710, 18711, 18712, 18713, 18714, 18715, 18716, 18717, 18718, 18719)
Time: 27 min
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
| 7  | docs/build-log.md records stages and human steps                                        | PASS   | 6 stages, 6 with a commit                                                                                                                   |
| 8  | Interview ends with one read-back, no question after it                                 | PASS   | 1 read-back after 15 answer messages; no question after it                                                                                  |
| 9  | Each entity of the spec end to end                                                      | PASS   | 2 entities, each with its log section, commit, table, api route, app screen, 401 with no session                                            |
| 10 | Preview answers when the brief asks for one                                             | N/A    | deploy: none, and no wrangler or deploy call                                                                                                |
| 11 | `pnpm agent:audit` exits 0 with a seeded key                                            | PASS   | exit 0; 0 checks pass, tools/list with the seeded key included                                                                              |
| 12 | A second agent with the address and a key creates and reads back one entity through MCP | PASS   | row d3804118-420e-4611-9518-27c5571d7835 created and read back; the scorer read it with categories_list; 2 MCP tools/call in the transcript |

11/12 MVP bar lines pass, 1 N/A, 0 FAIL.
