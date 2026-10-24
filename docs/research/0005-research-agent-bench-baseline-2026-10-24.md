# Agent benchmark baseline

Date: 2026-10-24. Base: `main` at `e3501d6`, before the CLI work of #223 and the base-guide work of #224. Plan: [0074](../plans/0074-plan-agent-native-mvp-build-2026-10-21.md), phase 2 (#222).

## Goal

Measure how far an unattended agent gets today, given only the repo URL, a complete product brief and an env file. Later runs of the same benchmark show what each phase of plan 0074 changes.

## The run

`node scripts/agent-bench.ts`, run `2026-10-24T02-44-17-861Z`.

| Item | Value |
|------|-------|
| Agent | Claude Code 2.1.309, headless, `--permission-mode bypassPermissions --max-turns 400` |
| Model | `claude-sonnet-5-5`, the CLI's default for a fresh config folder |
| Input | `scripts/agent-bench/brief.md` (Shelfnote, a reading log, `autonomy: afk`), `scripts/agent-bench/env`, `scripts/agent-bench/prompt.md` |
| CLI and modules | this worktree's build, through `scripts/saasaloy-shim.sh` and `SAASALOY_REGISTRY_DIR` |
| End | the agent stopped on its own: result `success` after 50 turns and 8 minutes |
| Cost | $1.23, as the CLI reported it |

## Score

| # | MVP bar line | Result | Detail |
|---|--------------|--------|--------|
| 1 | Landing page carries copy from the brief | PASS | names "Shelfnote", no default copy |
| 2 | Sign up and sign in through `app` | FAIL | no `apps/app`; sign-up and sign-in from `http://localhost:3002` return 403, because the origin is not trusted |
| 3 | Password reset mail in email-console output | FAIL | 400 `RESET_PASSWORD_DISABLED`: `auth` sets no `sendResetPassword` |
| 4 | One product entity end to end | FAIL | `books` has a table, migration, seed slice, validator, api route and admin list; no `app` screen, no route test |
| 5 | `pnpm check` passes, `pnpm db:seed` twice same counts | FAIL | no `check` script; the two seed runs match (users 4, accounts 4, books 2, verifications 0, sessions 0) |
| 6 | One commit per stage on `build/mvp`, nothing pushed | FAIL | no `build/mvp` branch; one commit, `c042e2d`, on `main` |
| 7 | `docs/build-log.md` records stages and human steps | FAIL | no build log |

1 of 7 lines pass. With no build log, the scorer prints no stop point from the log.

## Where the agent stopped

The first step the agent did not reach is the signed-in product UI. `main` has no `app` module, and `admin` admits only admin roles, so the agent put the reader screens (`/signup`, `/login`, `/books`) into `apps/web` as Astro pages. From there it never had an `app` screen, and it moved on.

Then it declared the work done at turn 50 of 400, with these gaps it named itself:

- `pnpm lint` fails. The agent says the errors are only in the scaffolded `apps/api/src/routes/auth.test.ts` (`vitest(prefer-expect-resolves)`, lines 190, 210 and 225), a file it did not touch. This report has not checked that claim against a fresh scaffold.
- It wrote no api test for the book routes.
- It committed once, on `main`, and wrote no build log. Nothing on `main` asks for a branch, a commit per stage or a log, so this is the expected result until phases 6 and 11.

What it did on its own, from the brief and the base skills: it ran `saasaloy init`, installed `database-d1`, `auth`, `admin`, `email-console`, `logger-console` and `validators`, copied the env values, set `siteName`, rewrote `landing.ts` with no draft approval because of `autonomy: afk`, and built `books` across the database, the api and the admin app.

## What this tells the plan

Each FAIL line maps to a phase that has not landed:

| Line | Phase |
|------|-------|
| 2, part of 4 | 8 and 9: `shell` and the `app` module |
| 3 | 7: the password reset mail |
| 5 | 6: `pnpm check` in the base |
| 6, 7 | 6 and 11: the "Unattended work" rules and `saasaloy-build` |
| the route test in 4 | 11: `saasaloy-feature` |

The CLI's no-TTY work (#223) did not block this run. The agent passed `--yes` to `add` and wrote `packages/env/.env` by hand, so no prompt stopped it.

## Limits of this run

- **The agent can read this repo.** The run folder sits inside `.dev/bench/`, as the issue requires. The agent ran `cd ../../..` and read the README, `docs/wiki/getting-started.md`, `docs/wiki/how-to/make-it-yours.md` and the first 60 lines of `scripts/agent-bench.ts`, which say that it is under a benchmark. It did not read the scorer or `scripts/agent-bench/expect.json`.
- **This repo's project skills load.** The agent's skill list held `create-module` and `create-provider` from `.claude/skills/`. It did not invoke them.
- **The first attempt was stopped.** A probe showed that `~/.claude/CLAUDE.md` reached the agent despite a fresh `CLAUDE_CONFIG_DIR`, and that file forbids commits. Run `2026-10-24T02-39-18-846Z` was stopped after 3 minutes and not scored. Commit `0b58314` adds the file to `claudeMdExcludes`, and a second probe confirmed that no instruction file reached the agent.
- **The agent can touch the box.** It ran `pkill -f "wrangler|vite"` to free its ports, which would also stop another session's dev servers. A later run should happen when no other dev server is running on the box.
- **One run, one model.** A second run can stop at a different step. The plan's cadence (before a release, and after a change to a base skill or the CLI's unattended contract) is what makes the numbers comparable.

Only a run folder outside the repo, or a mount namespace, would close the first two leaks.

## Reproduce

```sh
pnpm install
node scripts/agent-bench.ts                    # this run took 8 minutes and $1.23
node scripts/agent-bench.ts --score .dev/bench/<run-id>   # score a run again
```

The transcript, the scorer's logs and `score.md` land in `.dev/bench/<run-id>.out/`, which git ignores.
