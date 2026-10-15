---
name: saasaloy-env
description: Runbook for the env capability in packages/env — the one tracked key list, the pnpm env:setup distribution command, and the typed createEnv gate each service reads its values through. Use when adding an environment key, when a build or a request fails naming an unset key, when choosing which services read a key, when a value must stay blank, when a key is checkout-owned, when picking a value source, or when a leftover .dev.vars is hiding .env from wrangler.
---

# env — one key list, one command, one typed gate

`packages/env` (`@repo/env`) owns both halves of this project's environment story.

The **node half** is a tracked key list (`packages/env/.env.example`), a gitignored value file (`packages/env/.env`), and `pnpm env:setup`, which writes every service's own `.env` from the two. The **runtime half** is `createEnv`, which validates the values a service actually got and hands back typed ones.

A *service* is a workspace that reads a `.env`: `api`, `web`, `admin`, `infra`. The name is the workspace directory. `packages/env/src/services.ts` holds the table, and `saasaloy add api` appends a row to it.

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

## Value sources

`pnpm env:setup` reads its values from a source, selected by `ENV_SOURCE`:

- **`local`** (the default, always installed) reads the gitignored `packages/env/.env`. `saasaloy env` prompts for each unset key and writes that file, so a project develops with no vendor account and no network.
- **`infisical`** arrives with `saasaloy add env-infisical`.

A source that does not answer at all — no CLI, no network — is treated as offline: `env:setup` keeps every service file that is already complete and warns, and fails writing nothing when one is incomplete. A refusal the source *answered* with, such as no access, always fails.

## Production and `--env prod`

Each service row declares `dev` or `prod`. `pnpm env:setup --env prod` refuses to act without `--only <service>`, and refuses outright to write production values into a workspace under `apps/`. Two independent guards on the one command that can put a live credential on disk.

`saasaloy env` prints the `wrangler secret put` lines for a deploy. It never runs them.

## `env-exec`

`env-exec <file> -- <command>` runs a command with a `.env` loaded into its environment, so `infra`'s scripts need no `source infra/.env` first. A variable the shell already exports wins over the file.

## `.dev.vars` is gone

This project writes `.env` and nothing else. A leftover `.dev.vars` **hides** `.env` from wrangler — wrangler loads `.env` only while no `.dev.vars` sits beside it, and it does not warn — so `saasaloy doctor` reports one and `pnpm env:setup` carries its values across and deletes it.

## `process.env`

No file a Worker imports reads it. The Worker's `env` is the only source, and it arrives through `createEnv`. Node tooling — `scripts/`, `infra`, `env-exec`, a value source — reads it freely.
