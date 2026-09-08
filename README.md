# Saasaloy

**Open source, composable SaaS starter kit for Cloudflare.** A CLI plus a module registry, not a boilerplate. Think shadcn/ui for a full-stack SaaS: you scaffold a small base, then copy in the API, database, auth, and product features one command at a time, as source files you own.

[![npm version](https://img.shields.io/npm/v/saasaloy)](https://www.npmjs.com/package/saasaloy)
[![CI](https://github.com/mimukit/saasaloy/actions/workflows/ci.yml/badge.svg)](https://github.com/mimukit/saasaloy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)

## Why Saasaloy

- **You own the code.** Nothing is imported from a Saasaloy package at runtime. The CLI writes files into your repo and gets out of the way.
- **Start small, add on demand.** `saasaloy init` gives you a landing page and a UI package. API, database, auth, admin, email, SMS, and features arrive later with `saasaloy add`, each with its dependencies resolved.
- **Cloudflare-native, near zero cost.** Workers, D1, and static assets by default. Most modules run on the free tier, and the ones that do not say so up front.
- **Agent-native.** Every generated project ships `AGENTS.md`, `CLAUDE.md`, a `DESIGN.md` contract, and per-module skills for Claude Code and other agents.
- **Reversible.** `saasaloy remove` undoes a module from its manifest, and `saasaloy update` re-applies at a newer version with a merge plan for your edits.

## Quick start

Requires Node 24.13.0+ and pnpm 11+. No Cloudflare account is needed until you deploy.

```bash
npm install -g saasaloy      # or: pnpm add -g saasaloy, or prefix commands with npx
saasaloy init my-app
cd my-app
pnpm install
pnpm dev                     # landing page on http://localhost:3000
```

Then compose the product:

```bash
saasaloy list                # what the registry offers, and what you already have
saasaloy add database-d1     # pulls api + database, then binds them to D1 (or pick database-postgres)
saasaloy add admin           # pulls auth, then an auth-gated admin SPA
saasaloy add waitlist        # a feature: form, API route, table
saasaloy env                 # fill in the variables your modules declare (--check gates a deploy)
```

Full walkthrough: [Getting started](docs/wiki/getting-started.md), then [Make the project yours](docs/wiki/how-to/make-it-yours.md) for the bundled skills that write your product brief, landing copy, and theme.

## What you get

```text
my-app/
  apps/web/            Astro landing page (the base)
  apps/api/            Hono Worker            (saasaloy add api)
  apps/admin/          TanStack Router SPA    (saasaloy add admin)
  packages/ui/         shared React + Tailwind components
  packages/db/         Drizzle schema + client (saasaloy add database-d1 | database-postgres)
  packages/auth/       Better Auth            (saasaloy add auth)
  packages/email/      email provider interface (saasaloy add email)
  packages/queue/      background jobs + schedules (saasaloy add queue)
  .agents/skills/      agent skills, symlinked from .claude/skills/
  DESIGN.md            the design contract
  saasaloy.json        installed modules + alias map
```

| Concern | Choice |
|---|---|
| Marketing site (`apps/web`) | Astro on Workers static assets |
| App (`apps/admin`) | TanStack Router + Vite SPA |
| Backend (`apps/api`) | Hono on Cloudflare Workers |
| Database | Drizzle ORM on D1 (SQLite) or Postgres |
| Auth | Better Auth |
| Email | Cloudflare Email Sending, Plunk, or a console logger |
| Background work | Cloudflare Queues and Cron Triggers, or an in-process runner |
| Infra | wrangler per workspace, or Pulumi via the `infra` module |
| Monorepo | Turborepo + pnpm |

## Commands

| Command | What it does |
|---|---|
| `init` | scaffold a new project (Astro landing + ui + config) |
| `add` | apply a module into the current project, resolving `dependsOn` |
| `env` | fill in the environment variables the installed modules declare (`--check` gates a deploy) |
| `outdated` | report the base template and each installed module, current vs latest (`--check` gates CI) |
| `update` | re-apply the base and modules at a newer version, with a merge plan for anything you edited |
| `remove` | undo a module's applied files via the manifest, offline |
| `list` | list the modules a registry offers, marking the ones installed here |
| `new` | scaffold a new module in a registry repo (descriptor + files + skill stub) |
| `doctor` | validate module descriptors, or a project's state files against each other |

Every command answers `--help`. Flags, exit codes, coordinate grammar, and environment variables are in the [Reference](docs/wiki/reference.md).

## Modules

Modules come in tiers. A **capability** scaffolds a workspace and sets conventions. A **feature** drops files into those conventions. A **provider** supplies one implementation behind a capability's interface. A **driver** supplies the connection half of a stateful capability, and only one may be installed.

| Tier | Modules |
|---|---|
| Capability | `api`, `database`, `validators`, `logger`, `auth`, `admin`, `email`, `sms`, `queue`, `infra` |
| Feature | `waitlist`, `teams`, `email-react` |
| Provider | `email-console`, `email-cloudflare`, `email-plunk`, `logger-console`, `sms-console`, `queue-cloudflare`, `queue-memory` |
| Driver | `database-d1`, `database-postgres` |

`saasaloy add <name> --dry-run` prints what a module would do to your project before it does it. The one-table map of every module, what it gives you, and what it depends on is on the [Modules](docs/wiki/modules.md) page.

The default registry is this repo. `saasaloy add waitlist` fetches `modules/waitlist/` from GitHub at a pinned commit SHA. Any repo with a `modules/` directory can serve as a registry with `saasaloy add owner/repo/<name>`. To publish your own, start at [Contribute a module](docs/wiki/how-to/contribute-a-module.md).

## Cost and requirements

`init`, `api`, `database` + `database-d1`, `validators`, `logger`, `auth`, `admin`, `waitlist`, and `teams` all run on Cloudflare's free tier. Cloudflare's limits are Cloudflare's to change, and a project that grows past them should expect to pay.

A few modules need something the free tier does not cover:

| Module | Needs |
|---|---|
| `email-cloudflare` | a Workers paid plan and a sending domain onboarded by hand in the Cloudflare dashboard |
| `email-plunk` | a [Plunk](https://www.useplunk.com) account and `PLUNK_API_KEY` |
| `database-postgres` | a Postgres server reachable from a Worker, with its URL in `DATABASE_URL`. Install instead of `database-d1`, never alongside |
| `sms` | a third-party SMS account for any real send. Cloudflare has no SMS product. `sms-console` is free |
| `queue-cloudflare` | a Workers paid plan, and the two queues created once with `wrangler queues create`. Install `queue-memory` instead for local work |

The local providers (`email-console`, `sms-console`, `logger-console`, `queue-memory`) log or run inline instead of calling a service, so local development needs no plan, domain, or key. Details for each are in the [Reference](docs/wiki/reference.md#email-providers).

## Deploy

Each deployable workspace owns its `wrangler.jsonc` and `deploy` script. Run them one at a time, or install the `infra` module and deploy every Worker with one Pulumi program. See [Deploy to Cloudflare](docs/wiki/how-to/deploy-to-cloudflare.md).

## Documentation

All docs live in [`docs/wiki/`](docs/wiki/index.md).

**Use Saasaloy**

- [Getting started](docs/wiki/getting-started.md): install the CLI, scaffold a project, run it.
- [Make the project yours](docs/wiki/how-to/make-it-yours.md): the bundled skills for the product brief, landing copy, and theme.
- [Modules](docs/wiki/modules.md): every module in the default registry, in one table.
- [Add a module](docs/wiki/how-to/add-a-module.md): install a feature and its prerequisites.
- [Remove a module](docs/wiki/how-to/remove-a-module.md): take one back out, and what stays behind.
- [Deploy to Cloudflare](docs/wiki/how-to/deploy-to-cloudflare.md): ship each workspace.

**Build a module**

- [Contribute a module](docs/wiki/how-to/contribute-a-module.md): authoring guides and how to test a module before it ships.
- [A bad descriptor reached `main`](docs/wiki/runbooks/bad-descriptor-on-main.md): the registry is live, so this is an incident.

**Both tracks**

- [Architecture](docs/wiki/architecture.md): how the CLI, the registry, and a generated project fit together.
- [Reference](docs/wiki/reference.md): every command, flag, environment variable, and config file.
- [`CONTEXT.md`](CONTEXT.md): the vocabulary. Module, capability, provider, coordinate, applier.
- [`docs/adr/`](docs/adr/): why the design is what it is, one decision per file.

## Contributing

Issues and pull requests are welcome. [`CONTRIBUTING.md`](CONTRIBUTING.md) covers the `.dev/playground`, the lint and test gates, and the dependency update flow. The `billing` module is tracked in [#14](https://github.com/mimukit/saasaloy/issues/14).

## License

[MIT](LICENSE.md)
