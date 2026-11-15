---
name: saasaloy-env
description: Runbook for the env capability in packages/env — the one tracked key list, the pnpm env:setup distribution command, the pnpm deploy:production deploy with env-deploy, and the typed createEnv gate each service reads its values through. Use when deploying to Cloudflare, when a deploy stops naming a blank production key, adding an environment key, when a build or a request fails naming an unset key, when choosing which services read a key, when a value must stay blank, when a key is checkout-owned, when giving a worktree its own dev ports with pnpm dev:ports or DEV_HOST, when picking a value source, or when a leftover .dev.vars is hiding .env from wrangler.
---

# env — one key list, one command, one typed gate

`packages/env` (`@repo/env`) owns both halves of this project's environment story.

The **node half** is a tracked key list (`packages/env/.env.example`), a gitignored value file (`packages/env/.env`), and `pnpm env:setup`, which writes every service's own `.env` from the two. The **runtime half** is `createEnv`, which validates the values a service actually got and hands back typed ones.

A *service* is a workspace that reads a `.env`: `api`, `web`, `admin`. The name is the workspace directory. `packages/env/src/services.ts` holds the table, and `saasaloy add api` appends a row to it. Two rows have no workspace and no file: `deploy` holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, which a deploy loads in memory, and `dev-ports` holds `DEV_HOST`, which `pnpm dev:ports` reads. A row with a dev server also carries `devPort`, the port it listens on in the main checkout.

## Adding a key, in two steps

**1. Add its line to `packages/env/.env.example`**, under the `# @services` section naming every service that reads it. Write a comment above it saying where the value comes from and what unset looks like. Put the local development default on the line.

```
# @services api

# Sender address every outbound message uses. The domain must be one the selected
# provider may send from. Unset, the first send throws naming this key.
EMAIL_FROM=dev@localhost
```

A key with no `# @services` line above it fails `pnpm env:setup`. That is deliberate: a key that reaches no service is a key the Worker throws on, and failing here is the cheaper place to find out.

**2. Declare it in the preset** of the package that reads it, so `createEnv` validates it and the type reaches the calling code.

```ts
// packages/email/src/env-preset.ts
export const emailPreset = definePreset({
  module: "@repo/email",
  extends: [],
  server: {
    EMAIL_FROM: z.string().min(1).describe("Sender address every message uses."),
  },
});
```

The `.describe()` text is what the aggregate error prints, so write it for the person reading a failed deploy.

## Reading a key

On the server, pass the Worker's `env`:

```ts
import { apiEnv } from "@api/env";

app.get("/x", (c) => {
  const { EMAIL_FROM } = apiEnv(c.env);
});
```

In a frontend, call it with nothing — the values are inlined at build time:

```ts
import { webEnv } from "@web/env";

const base = webEnv().PUBLIC_API_URL;
```

`createEnv` validates on the **first call per `env` object** and memoizes the result in a `WeakMap`. A Worker cannot see its `env` at module scope, so the first request is the earliest honest point to check. One throw then names every failing key at once, with the module that declared it and that module's own wording, so a deploy with three unset keys takes one round trip to fix.

## Server, client, shared

- `server` — read only where `isServer` is true. A Worker, a build script.
- `client` — inlined into a public bundle. **Must** start with `PUBLIC_`, and the type system says so: a mis-prefixed key does not compile.
- `shared` — read on both sides.

`apps/web/src/env.ts` and `apps/admin/src/env.ts` set `isServer: false`, which arms a Proxy: reading a server key from client code throws by name. `typeof window === "undefined"` is not used, because it is true in a Worker *and* in a browser bundle before hydration.

The `runtimeEnvStrict` map in those files is hand-written, one literal `import.meta.env.PUBLIC_X` per key. Vite inlines a literal member expression and nothing else, so a spread, a loop or a computed key compiles to `undefined` in the built bundle and fails only in production. **Add the line by hand when you add a client key.**

## Blank on purpose

`pnpm env:setup` fails on a key the list carries with no value. When a key is meant to stay empty, say so in its comment block:

```
# Blank on purpose: unset means no proxy origin, and a link is root-relative.
STORAGE_PROXY_URL=
```

## Checkout-owned keys

`CHECKOUT_OWNED_KEYS` in `packages/env/src/services.ts` lists keys this checkout sets for itself. A key named there keeps whatever value is already on disk, whoever wrote it, so a per-branch `DATABASE_URL` survives every `pnpm env:setup`. `packages/env` never learns what a database is — only that some key is the checkout's to set.

## Dev ports: `pnpm dev:ports`

`pnpm dev:ports` (`packages/env/scripts/dev-ports.ts`, core in `src/dev-ports.ts`) gives this checkout its own dev ports, so two worktrees of one project run `pnpm dev` at the same time. `pnpm env:setup` runs it at the end of every dev run, and it also runs alone.

- **The main checkout keeps the pinned ports**: each row's `devPort` (web 3000, admin 3001, app 3002, the email preview 3003, api 4000). It writes no cookie prefix.
- **A linked worktree takes a block.** The command hashes the checkout root to a block `k` from 0 to 999, and each port is `10000 + 10k + slot`. A frontend's slot is `devPort - 3000`, and a backend's slot is `devPort - 4000 + 5`. When a port in the block listens now, or another worktree's record claims the block, it tries `k+1`, then `k+2`. A rerun keeps the recorded block while it is free.
- **It writes a marked block into each service's `.env.local`**, between `# >>> dev:ports` and `# <<< dev:ports`: `DEV_PORT`, and the origin keys that service reads (`PUBLIC_API_URL`, `PUBLIC_SITE_URL`, `BETTER_AUTH_URL`, `CORS_ORIGINS`). In a linked worktree the api block also gets `AUTH_COOKIE_PREFIX`, so the session cookies of two worktrees on one host do not overwrite each other. Lines outside the block are yours, and the block always comes last, so it wins over a key typed above it. `pnpm env:setup` never touches `.env.local`.
- **It records the result in `.devports.json`** at the checkout root (gitignored): the block, the host, the cookie prefix and each service's port. `pnpm dev:stop`, the e2e suite and the collision check read it.
- **`DEV_HOST` names the host the browser uses.** Set it in `packages/env/.env` to a remote dev box's name (`DEV_HOST=devaloy`), or pass `pnpm dev:ports --host <name>` for one run. The URLs use that host, because a page and its api must share one host for the session cookie. `CORS_ORIGINS` lists both the `localhost` and the `DEV_HOST` origin of each browser service.
- **Restart `pnpm dev` after a change.** A dev server does not watch `.env.local`. The command prints "restart pnpm dev to load the new ports" when a value changed.
- **`pnpm dev:ports --clean`** removes every block and `.devports.json`. It deletes a `.env.local` that held only the block.

A dev config reads its port with `loadEnv` and `devPort()` from `@repo/env/dev-port`, with the row's `devPort` as the fallback, and keeps `strictPort`. A bad `DEV_PORT` fails at startup and names the file. `wrangler dev` reads no `DEV_PORT`, so in a worktree run it as `wrangler dev --port <DEV_PORT>`; `vite dev` in `apps/api` reads the key itself.

A new service with a dev server adds `devPort` to its `SERVICES` row: 3000 to 3004 for a frontend, 4000 to 4004 for a backend. Any other value fails `pnpm dev:ports`.

## Value sources

`pnpm env:setup` reads its values from a source, selected by `ENV_SOURCE`:

- **`local`** (the default, always installed) reads the gitignored `packages/env/.env`. `saasaloy env` prompts for each unset key and writes that file, so a project develops with no vendor account and no network. An agent with no terminal runs `saasaloy env --from-file <path>` instead, which writes the `KEY=VALUE` lines of a dotenv file with no prompt and refuses a key no installed module declares. Prefer it to `--set KEY=VALUE`, which leaves the value in shell history.
- **`infisical`** arrives with `saasaloy add env-infisical`.

A source that does not answer at all — no CLI, no network — is treated as offline: `env:setup` keeps every service file that is already complete and warns, and fails writing nothing when one is incomplete. A refusal the source *answered* with, such as no access, always fails.

## Production and `--env prod`

Each service row declares `dev` or `prod`. `pnpm env:setup --env prod` refuses to act without `--only <service>`, and refuses outright to write production values into a workspace under `apps/`. Two independent guards on the one command that can put a live credential on disk.

`saasaloy env` prints the `wrangler secret put` lines for a deploy. It never runs them, and `pnpm deploy:production` makes them unnecessary.

## Deploying: `pnpm deploy:production` and `env-deploy`

`pnpm deploy:production` (`packages/tooling/src/deploy-production.ts`) deploys every Worker in the project with wrangler. The `saasaloy-deploy` skill covers its gates, its flags, the go-ahead an agent needs, the hotfix branch and the rollback. This section covers the environment half:

1. Before any build, it runs `node packages/env/src/deploy.ts --check`. That loads every service's `prod` values from the selected source and exits non-zero, naming each blank key, when one is missing. It also stops when `CLOUDFLARE_API_TOKEN` is blank and wrangler holds no `wrangler login` session. `pnpm deploy:production --dry-run` runs the same check and reports its result.
2. It then runs each deploy target's `deploy` script, one at a time, in the order `packages/tooling/src/targets.ts` gives. That script is `env-deploy <service>`. No Worker deploy runs a migration. A production migration runs only through `pnpm deploy:production --migrate`.

`env-deploy <service>` loads that service's `prod` values and the `deploy` credentials, runs `pnpm run build` with them in the environment, and runs `wrangler deploy --secrets-file <file>`. Code and secrets land in one Worker version, so a Worker that throws at module scope on a missing secret deploys cleanly the first time. The secrets file is JSON, mode `0600`, under the OS temp directory, and deleted when the deploy ends, passed or failed. It holds the service's values minus every `CLOUDFLARE_*` key, minus each key the Worker's `wrangler.jsonc` already sets in `vars`, minus empty values. An assets-only Worker, one with no `main`, gets no secrets file.

**Where the production values come from.** The `local` source reads the gitignored `packages/env/.env.prod`, never `packages/env/.env`, so a deploy cannot ship a `localhost` URL by accident. Copy the keys from `packages/env/.env.example` into it and set each one. `env-infisical` reads its `prod` environment. A variable the shell already exports wins over both, which is how CI passes values. The base `turbo.json` keeps a `deploy` task with `passThroughEnv` for a project that runs `turbo run deploy` by hand, because turbo's strict env mode would drop the exported variables otherwise. `pnpm deploy:production` does not use turbo for the deploy.

**Why the dev `.env` stays out of the build.** Vite gives the environment priority over a `.env` file, but the Cloudflare adapters prerender inside workerd, and wrangler hands workerd the `.env` beside the workspace as its vars. So `env-deploy` builds with `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`, and it sets a key the source leaves out to an empty string rather than leaving it unset. `apps/web/.env` keeps its dev values, and nothing writes a production value under `apps/`.

Three more forms:

- `pnpm deploy:production --only <service>` deploys one Worker after the same gates, and runs its smoke checks. It writes no deploy tag.
- `pnpm --filter @repo/web run deploy -- --dry-run` builds one Worker with the production values and uploads nothing. Pass wrangler flags after `--`. Do not deploy with `pnpm --filter <package> run deploy` alone: it skips the gates, the order and the tag.
- `env-deploy --run <service> -- <command> [args...]` runs one command with that service's `prod` values and the credentials. The `db:prod:migrate` and `db:prod:dump` scripts use it: `--run api` under `database-postgres`, because `DATABASE_URL` is an `api` key, and `--run deploy` under `database-d1`, which needs only the Cloudflare credentials.
- `env-deploy --check` is step 1 on its own.

Two things the flow does not do. `--secrets-file` only adds: a secret you removed from the value source stays on the Worker until you run `wrangler secret delete <KEY>` in its workspace. And a key marked `# Blank on purpose` passes the check even where production needs it, such as `BETTER_AUTH_SECRET`; the Worker's own `createEnv` gate is what refuses it.

## `.dev.vars` is gone

This project writes `.env` and nothing else. A leftover `.dev.vars` **hides** `.env` from wrangler — wrangler loads `.env` only while no `.dev.vars` sits beside it, and it does not warn — so `saasaloy doctor` reports one and `pnpm env:setup` carries its values across and deletes it.

## `process.env`

No file a Worker imports reads it. The Worker's `env` is the only source, and it arrives through `createEnv`. Node tooling — `scripts/`, `env-deploy`, a value source — reads it freely.
