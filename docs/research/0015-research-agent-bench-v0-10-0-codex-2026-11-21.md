# Agent benchmark for v0.10.0 with Codex

Date: 2026-11-21

The full benchmark records 31 PASS results, three N/A results and two FAIL results across three briefs. Receiptbox passes every applicable check. Shelfnote and Prepline each have one scorer detection failure. The generated products contain the parts that those checks report as missing.

## Method

All three briefs use interview mode, Codex CLI 0.171.0 and `gpt-6.2-sol`. The repository's Codex adapter starts each interview and resumes the same session for each scripted owner answer. After the build, the scorer starts another Codex session with only the product address and a scoped key. All three second-agent checks create and read back an entity through MCP.

The runs start in parallel with separate folders and port blocks. Each run uses the local CLI build and a copy of the module registry. The run folders sit outside the repository. The harness removes GitHub tokens from the agent environment. It stops the processes that each run starts.

npm reports 0.10.0 as the latest published version at the start. The checkout initially matches release commit `df6fe482196f3f7fa78fdd90f6e8fefcadd2529a`, the target of the annotated `v0.10.0` tag. Another session adds commit `5d1793159e5a1fc7072a240c9f0888543bde49d9` during the builds. That commit changes only `docs/plans/0117-plan-postgres-only-2026-11-20.md`. The harness records the revision when a build ends, so the raw scores name that later revision. The CLI, templates, modules and benchmark code still match the release.

A Claude run starts before the owner requests Codex. That run stops during the interview and contributes no result to this report. All scored builds and second-agent calls use Codex.

The commands are:

```sh
node scripts/agent-bench.ts --interview --brief shelfnote --agent 'node scripts/agent-bench/agents/codex.ts' --runs /tmp/saasaloy-bench-v0.10.0-codex
node scripts/agent-bench.ts --interview --brief prepline --no-build --agent 'node scripts/agent-bench/agents/codex.ts' --runs /tmp/saasaloy-bench-v0.10.0-codex
node scripts/agent-bench.ts --interview --brief receiptbox --no-build --agent 'node scripts/agent-bench/agents/codex.ts' --runs /tmp/saasaloy-bench-v0.10.0-codex
```

The first command builds the release CLI. The other commands reuse that build. The adapter supplies its default model, `gpt-6.2-sol`.

## Results

| Brief | PASS | FAIL | N/A | Build time | Agent calls | Owner answers |
| --- | --- | --- | --- | --- | --- | --- |
| Shelfnote | 10 | 1 | 1 | 15 min | 16 | 15 |
| Prepline | 10 | 1 | 1 | 19 min | 17 | 16 |
| Receiptbox | 11 | 0 | 1 | 21 min | 18 | 17 |

Build time excludes the independent scorer. The runs overlap, so their build times must not be added as elapsed time. Codex reports no dollar cost or internal turn count through this adapter. All three briefs request local builds, so deployment is N/A.

Each product passes `pnpm check`, authentication, password reset, and two seed runs with equal row counts. Each product also passes the second-agent MCP check. The audit logs contain 12 checks with lowercase `pass` statuses for each product. The scorer counts uppercase `PASS` statuses, so its detail incorrectly says `0 checks pass`. Each audit exits 0.

## Scorer detection failures

Shelfnote fails line 9 because `entityParts` in `scripts/agent-bench/score.ts` requires `books` in a screen filename or route path. The product implements Books in `apps/app/src/routes/index.tsx`, at `/`. That file defines the `Books` component and uses `api.books.$get()`. The transcript also records browser checks for book creation and editing. The failure identifies a naming limit in the scorer, rather than an absent screen.

Prepline fails line 4 because `checkEntity` searches validator file contents for the brief's word `prep`. The validator lives in `packages/validators/src/prep-tasks.ts`. Its exports use generic names such as `createInput`, so its contents do not contain `prep`. The API route imports that validator and calls `zValidator` for create and update requests. The failure identifies a content-search limit in the scorer, rather than an absent validator.

The raw scores below retain both failures. No generated product or scorer code changes after scoring. A corrected scorer and a fresh score run would establish revised totals.

## Evidence

The original products and output folders are under `/tmp/saasaloy-bench-v0.10.0-codex/`. A copy of the products, transcripts and score logs is under `/home/dev/.cache/saasaloy-bench/v0.10.0-codex-2026-11-21/`. The copy excludes installed dependencies, build output and adapter credential state. Each `<run>.out/` folder contains `score.md`, `run.json`, `interview.json`, audit logs and second-agent evidence. Each product contains its build log and local git history. No product commit is pushed.

The cache copy survives a container rebuild because it sits under `/home/dev`. It has no remote backup.

The following tables reproduce the raw benchmark output.

## Agent benchmark: shelfnote

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
| 9  | Each entity of the spec end to end                                                      | FAIL   | `books` missing: app screen                                                                                                            |
| 10 | Preview answers when the brief asks for one                                             | N/A    | deploy: none, and no wrangler or deploy call                                                                                           |
| 11 | `pnpm agent:audit` exits 0 with a seeded key                                            | PASS   | exit 0; 0 checks pass, tools/list with the seeded key included                                                                         |
| 12 | A second agent with the address and a key creates and reads back one entity through MCP | PASS   | row c7509338-0255-4991-87b4-6dd3ecd5afc9 created and read back; the scorer read it with books_list; 1 MCP tools/call in the transcript |

FAIL 9: stop point: after stage "Feature: books"

10/12 MVP bar lines pass, 1 N/A, 1 FAIL.

## Agent benchmark: prepline

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
| 4  | One product entity end to end                                                           | FAIL   | `prep_tasks` missing: validator                                                                                                           |
| 5  | `pnpm check` passes, `pnpm db:seed` twice same counts                                   | PASS   | pnpm check green, seed counts match                                                                                                       |
| 6  | One commit per stage on build/mvp, nothing pushed                                       | PASS   | 7 commits on build/mvp, nothing pushed                                                                                                    |
| 7  | docs/build-log.md records stages and human steps                                        | PASS   | 6 stages, 6 with a commit                                                                                                                 |
| 8  | Interview ends with one read-back, no question after it                                 | PASS   | 1 read-back after 15 answer messages; no question after it                                                                                |
| 9  | Each entity of the spec end to end                                                      | PASS   | 2 entities, each with its log section, commit, table, api route, app screen, 401 with no session                                          |
| 10 | Preview answers when the brief asks for one                                             | N/A    | deploy: none, and no wrangler or deploy call                                                                                              |
| 11 | `pnpm agent:audit` exits 0 with a seeded key                                            | PASS   | exit 0; 0 checks pass, tools/list with the seeded key included                                                                            |
| 12 | A second agent with the address and a key creates and reads back one entity through MCP | PASS   | row 800f099c-fec9-410d-ae25-968225b22d3b created and read back; the scorer read it with stations_list; 4 MCP tools/call in the transcript |

FAIL 4: stop point: after stage "Feature: prep_tasks"

10/12 MVP bar lines pass, 1 N/A, 1 FAIL.

## Agent benchmark: receiptbox

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
| 11 | `pnpm agent:audit` exits 0 with a seeded key                                            | PASS   | exit 0; 0 checks pass, tools/list with the seeded key included                                                                              |
| 12 | A second agent with the address and a key creates and reads back one entity through MCP | PASS   | row f44c5035-5f31-465f-956b-b401f2cbc064 created and read back; the scorer read it with categories_list; 2 MCP tools/call in the transcript |

11/12 MVP bar lines pass, 1 N/A, 0 FAIL.

