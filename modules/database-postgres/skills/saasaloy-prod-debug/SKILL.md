---
name: saasaloy-prod-debug
description: Runbook for an AI agent that debugs a production problem from production rows and the api Worker's logs, read-only, on a Postgres project. Use when the owner reports what a user saw in production ("I cannot sign in", "the reset email never came", "I was signed out", "it says my account is banned", "it says I have no account"), or asks to "check production", "look at the prod database", "query production", "read the api logs" or "what happened to this user". Covers the rule (pnpm db:prod:query only, never the owner URL, never a write), answering against the last deploy tag, db:prod:query and its --auth-trace preset, pnpm logs:prod, what the read-only role cannot read, the masker, the symptom table and the report.
---

# saasaloy-prod-debug

Answer "what happened to this user" from production, as the read-only Postgres role `<project>_ro` and a logs token that cannot deploy. `<project>` is the dev database prefix without `_dev`: a project whose dev database is `acme_shop_dev` has the role `acme_shop_ro` and the production database `acme_shop_production`.

The server enforces the limits, not your care. The role has `SELECT` on the `pii` and `plain` columns only, no write grant on anything, `default_transaction_read_only = on`, a 15-second statement timeout and at most two connections. The grants come from the column classes in `packages/db/src/column-classes/`; the `saasaloy-database` skill has the class rule.

**The owner sets this up once.** Until then both commands refuse with a message that names the missing file. The steps are in the `saasaloy-database-postgres` skill, section "The read-only role": run `pnpm db:prod:readonly-grants`, set the role's password with `ALTER ROLE`, write `~/.config/<project>/prod-readonly.env` with mode 0600, and make a "Workers Observability: Read" token for `~/.config/<project>/cloudflare-logs.env`. Do not do these steps yourself: each one needs the owner's credentials. Report the refusal and point the owner at that section.

## The rule

- **Query production only with `pnpm db:prod:query`.** Never with `env-deploy --run api`, `pnpm --filter @repo/db exec`, `psql` with the owner URL, or any other command that loads `packages/env/.env.prod`. Those connect as the owner role, which can write, drop and migrate. `pnpm db:prod:dump`, `db:prod:migrate`, `db:prod:readonly-grants` and `db:prod:superadmin` also run as the owner: they are the owner's commands, not debugging tools.
- **Never write to production**, not even a "safe" fix such as ending a session, lifting a ban or verifying an email. Report the fix and the exact statement; the owner runs it.
- **Never open the credential files**: `~/.config/<project>/prod-readonly.env`, `~/.config/<project>/cloudflare-logs.env` and `packages/env/.env.prod`. Do not `cat`, `grep`, `source` or copy them. The commands read them. A URL or a token in the transcript is a leak.
- **Keep personal data out of the answer.** The output is masked; keep it that way. Never alias a `pii` column to get past the masker (`select email as e`, `select name || '' as n`). When the owner needs a full value, name the query the owner runs by hand.
- **When a command refuses to run, report its message.** Do not work around it: no other file, no other URL, no other role.

## Answer against the last deploy tag, not `main`

Production runs the commit the newest `deploy-*` tag names, and `main` may be ahead of it. Read the code that is live:

```sh
tag="$(git describe --tags --match 'deploy-*' --abbrev=0)"
git show "$tag":packages/auth/src/auth.ts   # the file as production runs it
git log --oneline "$tag"..main               # what main has that production does not
git diff "$tag" main -- packages/db/migrations/
```

A column in `main`'s schema that no migration since the tag has applied does not exist in production. A fix on `main` after the tag is not live. Say which commit you read in the report.

## The commands

| Command | Use it for |
| --- | --- |
| `pnpm db:prod:query --auth-trace <email>` | Any sign-in, password or session problem. Prints three result sets: the `users` row (role, `email_verified`, `banned`, `ban_reason`, `ban_expires`, times), the sign-in methods from `accounts` (`provider_id`, and `has_password`, true for a `credential` row), and the newest 20 `sessions` (times, `ip_address`, `user_agent`, `impersonated_by`). The email is trimmed and lowercased first, as Better Auth stores it. |
| `pnpm db:prod:query "<one statement>"` | Anything else. One statement per call, in a `begin read only` transaction that is rolled back. At most 200 rows; `--max-rows <n>` takes 1 to 5000. |
| `pnpm db:prod:query < query.sql`, or `echo "<sql>" \| pnpm db:prod:query` | A longer statement on stdin, when no SQL argument is given. Still one statement. |
| `pnpm logs:prod --since <time> [--until <time>] [--search <text>] [--limit <n>] [--worker <name>]` | What the api Worker served, and its errors. `--since` and `--until` take an ISO time (`2026-10-31T10:00Z`) or a span back from now (`30m`, `2h`, `3d`). `--search` matches the line text, case-insensitive, not a regex. `--limit` is 200 by default, at most 2000. `--worker` defaults to the `name` in `apps/api/wrangler.jsonc`. |

`db:prod:query` prints `Target: <project>_production on <host>, as <project>_ro.`, then one `-- <title>` line per result set, one JSON object per row, and a row count. `(first 200 rows; raise --max-rows to see more)` means the cap cut the result.

Before any statement it checks that the file is mode 0600, that the URL names `<project>_production` as `<project>_ro` on a server other than the dev one, and that the session really is that role with the read-only default on. Each failed check ends with `Nothing ran.`

## What the role cannot read

The role holds no grant on a `secret` column: `accounts.password`, `accounts.access_token`, `accounts.refresh_token`, `accounts.id_token`, `sessions.token`, `api_keys.key`, and both `verifications.identifier` and `verifications.value`. `identifier` is secret because a password reset stores its token there (`reset-password:<token>`). So no readable column ties a `verifications` row to a user, and `--auth-trace` has no verifications query. You can count rows and read their times, but not say whose they are.

`permission denied for table <table>` means the statement names a column the role cannot read, perhaps through `select *` or `count(<column>)`, or in a `WHERE` or `JOIN`. List the columns you need. When the column should be readable, it has no class yet, or production gained it in a migration and the grants have not run since. Report it: the owner runs `pnpm db:prod:readonly-grants`.

`cannot execute <statement> in a read-only transaction` or `permission denied` on a write is the server doing its job. `canceling statement due to statement timeout` means the query ran past 15 seconds: narrow it with a time window or an indexed column.

## Masking

`db:prod:query` masks each output column whose name some table classes `pii`. An email prints as `***@example.com`, a phone-shaped value as its first four and last four characters (`+155****4567`), other text as `[masked, 14 chars]`, a number or JSON as `[masked]`, and `null` stays `null`.

- **The masker goes by the output column name, not the table.** `users.name` is `pii`, so `projects.name`, `organizations.name` and `api_keys.name` are masked too. `storage_objects.key` is `pii`, so `feature_flags.key` is masked too. To read such a column on a table where it holds nothing personal, alias it: `select key as flag_key from feature_flags`. That alias is allowed. An alias on a personal column is not.
- **A `WHERE` clause still matches the raw value.** Search with the full email the owner gave you: `where email = 'ana@example.com'`.
- `ban_reason` and `payments.sender_account` are `pii`, so they print masked. The owner reads them in the admin app.

`pnpm logs:prod` masks the local part of every email address in a line. A name in a log line stays as it is, so do not copy log lines into the report wholesale.

## What the logs hold

Workers Observability records one line per request the api Worker served, with its time and request id, and a line for each `console` call and unhandled error. The api logs no request body. Find a user's request by its time, not by their email: take the times from the database first (a `sessions.created_at`, an `accounts.updated_at`, a `users.created_at`), then read the logs in a window of a minute or two around them, with `--search` set to a path such as `/auth/sign-in` or `/auth/request-password-reset`.

**Workers Logs keeps 3 days (Free) or 7 days (Paid).** The command warns when the window starts more than 7 days ago, and it prints the time of the oldest line it returned. For an older report, answer from the database and say the logs are gone. Never read an empty log result as "nothing happened".

## Symptom table

| Symptom | First step | What to look for |
| --- | --- | --- |
| "I cannot sign in" | `--auth-trace <email>` | No `users` row: see "No account exists". `banned` true: see "Account banned". No `credential` row (`has_password` never true): the account signed up through a social provider and has no password, so email and password cannot work; the user signs in with that provider or sets a password through a reset. On the admin app: a `role` outside the admin group (`admin`, `superadmin`, and any `adminAppExtraRoles`) is refused by design. Then `logs:prod --search /auth/sign-in` around the report time for the request and any error line. |
| "The reset email did not work" | `--auth-trace <email>`, then `logs:prod --search /auth/request-password-reset` around the report time | No `users` row: the endpoint answers 200 for an unknown address and sends nothing. No request line: the request never reached the api. A project without the `email` module ships no reset mail at all. A request line with an error after it: the send failed (a missing `EMAIL_PROVIDER`, or the provider refused it), and Better Auth logged the error and still answered 200; read the error. A request with no error: the provider accepted it, so check spam and the provider's own log. A reset link lives 60 minutes and works once. The role cannot read the reset rows in `verifications`. |
| "I was signed out" | `--auth-trace <email>` | A session whose `expires_at` has passed: it expired. No session rows at all: something deleted them, such as a password change that ended other sessions, an admin revoke, a ban, or `pnpm db:prod:superadmin` setting a password. Sessions belong to one audience (`client` or `admin`); read `audience` with `select id, audience, created_at, expires_at from sessions where user_id = '<id>' order by created_at desc limit 20`. |
| "My account is banned" | `--auth-trace <email>` | `banned` true and `ban_expires` (null means no end date). `ban_reason` is masked; the owner reads it in the admin app. Lifting a ban is a write: report it, and the owner does it in the admin app. |
| "It says I have no account" | `--auth-trace <email>` | No `users` row: check the address with the owner for a typo, and look for a near match by domain, `select id, email, created_at from users where email like '%@<domain>'` (the emails print masked). A row exists: the user typed another address, or signed up through a social provider whose email differs. With the `waitlist` module, a `waitlist_entries` row means the person joined the waitlist, which makes no account. |

## Report

Give the owner the facts with their UTC timestamps, the cause you infer, and how sure you are. Name the deploy tag you read the code at and the commands you ran. When the answer needs a production write, give the exact statement and say that the owner runs it. Keep every personal value masked, as the commands printed it.

```markdown
**Production check:** <the symptom, in the owner's words>

Code read at: <deploy tag> (<short sha>)
Ran: `pnpm db:prod:query --auth-trace <masked email>`, `pnpm logs:prod --since ... --search ...`

Facts:
- <UTC time> <what the row or log line shows>

Cause: <the inferred cause> (<sure | likely | a guess>, because <reason>)

Fix for the owner to run: <none | the exact statement or admin-app step>
```

## Next

Run `saasaloy-deploy` when the fix is code: it ships from `main`, or from a hotfix branch cut from the deploy tag. Run `saasaloy-auth` for how sign-in, sessions, bans and roles work.
