# 0043 — Deploy is wrangler-native and lives in the base template

A Saasaloy project deploys with `pnpm deploy:production`. The base template owns the command: a root script checks every service's production values, then `turbo run deploy` runs `env-deploy <service>` in each deployable workspace, which builds with the production values in its environment and runs `wrangler deploy --secrets-file`. Wrangler creates the D1, KV, R2 and queue resources itself. The `infra` module and its Pulumi program are deleted. Settled while grilling plan `docs/plans/0070-plan-wrangler-native-deploy-2026-10-18.md` for issue [#198](https://github.com/mimukit/saasaloy/issues/198).

## Status

accepted. Supersedes [ADR 0021](0021-adr-pulumi-iac-engine-for-infra-2026-07-25.md). Leaves [ADR 0001](0001-adr-all-in-on-cloudflare-2026-07-22.md) and [ADR 0033](0033-adr-transient-state-capabilities-take-providers-2026-09-08.md) unchanged: Cloudflare is still the only runtime, and a provider still registers its handlers through `apps/api/src/worker.ts`. **Amended by [ADR 0048](0048-adr-production-deploy-is-gated-ordered-and-tagged-2026-10-23.md):** the root command is now `node packages/tooling/src/deploy-production.ts`, which gates, orders, smoke checks and tags the deploy, and the `deploy` task no longer runs `db:migrate:prod`, so a D1 project migrates production only with `--migrate`. The values, the `env-deploy` build and the secrets file below are unchanged.

## Why ADR 0021 no longer holds

ADR 0021 picked Pulumi for provider optionality, so a later non-Cloudflare target would extend the engine rather than replace it. After several shipped projects nobody has used that option, and every service still runs on Cloudflare. What the choice cost is concrete:

- The translator accepted `vars` and `d1_databases` and nothing else, so a project with `kv-cloudflare`, `storage-cloudflare`, `queue-cloudflare`, `email-cloudflare` or `ratelimit` could not deploy through it. Each new provider module needed a matching translator case.
- It re-implemented wrangler: its own `.assetsignore` rules, a single-chunk bundle reader, a refusal of `main` plus `assets`, and a `wrangler secret put` loop beside Pulumi anyway.
- It read the source `apps/web/wrangler.jsonc`, while the file that deploys is the Astro adapter's redirected `dist/client/wrangler.json`.
- It built with the dev `.env`, so `PUBLIC_SITE_URL` and `PUBLIC_API_URL` shipped as `localhost` values.
- A project that is one landing page needed an extra module and a Pulumi stack to deploy one assets-only Worker.

Wrangler already does each of those things correctly. The one part it cannot know is which production values a service reads, and `packages/env` already knows that.

## The shape

- **The engine is `wrangler`, and nothing else.** No Pulumi, and no dependency on the `cf` CLI while it is in beta.
- **The base owns deploy.** Root `deploy:production` is `node packages/env/src/deploy.ts --check && turbo run deploy`. The `deploy` task depends on `^build` and `^db:migrate:prod`, so D1 migrations run before the api Worker uploads, and it passes the shell environment through so CI can export values.
- **Values come from the value source, in memory.** `env-deploy` loads a service's `prod` values with the selected source (`local` reads the gitignored `packages/env/.env.prod`, `env-infisical` reads its `prod` environment) and never writes a production value under `apps/`. A variable the shell exports wins.
- **The dev `.env` stays out of the build.** A listed key the source leaves out is set to an empty string, and the build runs with `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`, because the Cloudflare adapters prerender in workerd and wrangler would otherwise hand workerd the dev `.env` as vars.
- **Secrets travel with the code.** `wrangler deploy --secrets-file` puts code and secrets in one Worker version, so `auth`'s module-scope check passes on the first deploy. The file is `0600` under the OS temp directory and deleted in `finally`. It never holds a `CLOUDFLARE_*` key or a key the Worker's `vars` already sets, and an assets-only Worker gets none.
- **Credentials are a service with no file.** The `deploy` row in `SERVICES` holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the names wrangler reads. `Service.file` is optional, and `env:setup` skips a row without one.
- **Resources need no ids.** D1, KV, R2 and producer queues are created by wrangler on deploy and found by name, or by the deployed Worker's binding, on the next one. `db:migrate:prod` creates a missing D1 database first, because it runs before the deploy that would.

## Considered options

- **Keep Pulumi and extend the translator per binding kind.** Every provider module would need a translator case, and wrangler already handles all of them.
- **Keep `infra` as a thin wrangler orchestrator module.** A landing-page project would still need an extra module to deploy.
- **`wrangler secret bulk` after the deploy.** The first deploy fails on `auth`'s module-scope check, and each run adds a second Worker version.
- **A `build:production` turbo task.** Two build tasks per workspace, and a cached dev build could still ship.

## Consequences

- No state, no diff and no teardown command. `wrangler deploy --dry-run` is the preview, `wrangler rollback` is the rollback, and teardown is the per-resource `wrangler delete` commands the deploy wiki lists.
- A partial failure is accepted: turbo stops the remaining tasks and the finished ones stay live. Migrations must stay backward compatible.
- `--secrets-file` only adds. A removed secret stays on the Worker until `wrangler secret delete`.
- Every Worker redeploys on every run. Revisit when a project has more than five.
- A project on the old module moves with the runbook at `docs/wiki/runbooks/move-off-the-infra-module.md`, and `saasaloy doctor` warns while an `infra/` directory remains.
- `@pulumi/*` no longer appears in anything Saasaloy ships.

## References

Issues #198 (this change), #197 (project-name prefixes), #199 (`infra-ci-deploy`). Supersedes #130, #136 and #182. Plan: `docs/plans/0070-plan-wrangler-native-deploy-2026-10-18.md`.
