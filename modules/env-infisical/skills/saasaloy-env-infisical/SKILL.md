---
name: saasaloy-env-infisical
description: Runbook for env-infisical — the Infisical value source for pnpm env:setup. Use when setting up Infisical for a project, when choosing folders per service, when a machine identity is needed for CI, when env:setup reports Infisical did not answer, or when it refuses with no access.
---

# env-infisical — Infisical as a value source

`saasaloy add env-infisical` registers a second value source in `packages/env/src/sources.ts`. Select it with `ENV_SOURCE=infisical`; leave the variable unset and `pnpm env:setup` keeps using the built-in `local` source.

Nothing about this reaches a Worker. Values arrive in a deployed Worker as bindings and secrets exactly as before, and this module only fills the files `pnpm env:setup` writes.

## Setting it up

1. Install the Infisical CLI and run `infisical init` in the repository root. That writes `.infisical.json`, which names the project and holds no secret. Commit it.
2. Create one folder per service plus `/shared`: `/shared`, `/api`, `/web`, `/admin`, `/infra`. A key several services read lives in `/shared` and is stored once.
3. Put a value in Infisical for every key `packages/env/.env.example` lists for that service, in every environment that needs it.
4. Run `ENV_SOURCE=infisical pnpm env:setup`.

Each service takes `/shared` plus the folder named after it, merged in that order, so a service folder wins over `/shared`. Override that with `INFISICAL_FOLDERS_<SERVICE>` — a comma-separated list — when a project organized Infisical differently.

## Authenticating

On a laptop, the host's own `infisical login` is used and nothing else is needed.

In CI, set `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET` to a machine identity with read access. `pnpm env:setup` exchanges the pair for a short-lived token. Both travel in the child process's environment, never in argv, so neither reaches a process listing, and no value is ever printed.

These two are CI credentials for one command, not project environment keys. They are deliberately absent from `packages/env/.env.example`: nothing in the project reads them, and `createEnv` never sees them.

## When Infisical does not answer

The module separates two failures that look alike from a terminal.

**It did not answer** — the CLI is not installed, there is no network, there is no route to the host. `pnpm env:setup` keeps every service file that is already complete, warns, and exits zero. A file that is missing or incomplete fails the run and nothing is written.

**It answered and refused** — bad credentials, no access to the folder, an unknown project. That always fails, whatever the files on disk look like, because a wrong credential does not fix itself by waiting.

The distinction is read off the CLI's own output: it prints `Response Code:` whenever the server replied.

## Errors

Every failure arrives as `EnvError` with a `code`: `unreachable`, `denied`, `not_configured` or `invalid_response`. The vendor's own exit status is kept in `providerCode`, and `retryable` is true only for `unreachable`.
