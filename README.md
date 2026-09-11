# Saasaloy

**Open source, composable SaaS starter kit for Cloudflare.** A CLI plus a module registry, not a boilerplate. You scaffold a small base, then copy in the API, database, auth, billing and product features one command at a time, as source files you own. Think shadcn/ui for a full-stack SaaS.

[![npm version](https://img.shields.io/npm/v/saasaloy)](https://www.npmjs.com/package/saasaloy)
[![CI](https://github.com/mimukit/saasaloy/actions/workflows/ci.yml/badge.svg)](https://github.com/mimukit/saasaloy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)

> [!WARNING]
> **Saasaloy is at a very early stage.** It is a working proof of concept, not a finished product. Use it at your own risk, and do not build a production project on it yet. The CLI, the module contracts, the generated code and the conventions can all change or break between releases until a stable `1.x.x` version ships. Pin the version you install, read the changelog before you update, and expect to do some manual merging along the way.

## Why Saasaloy exists

You know the feeling. It is Saturday morning, you have an idea, and you are sure about it. You open a terminal to build the landing page. Three hours later you are wiring up OAuth callbacks, picking an ORM, arguing with yourself about multi-tenancy, and the landing page does not exist yet. By Sunday night you have a login screen, an empty admin panel and no idea whether a single person wants the product.

Every technical founder has a folder of dead SaaS projects. Open one. There is a polished auth flow, a role system, a Stripe webhook handler with retries, a multi-tenant schema with careful indexes. But there are no real users. The idea was never tested because the builder spent the first month building the parts every SaaS needs and never reached the part that made this one different.

In the age of AI, a vibe-coded demo takes an afternoon. A production-grade SaaS still takes the same components it always did: API, database, auth, admin, teams, billing, email, jobs, rate limits. Each one has to be crafted with precision. None of them proves that your idea is worth building.

The ready-made boilerplates promise to fix this, and they make it worse. You clone one and inherit forty features, twelve environment variables and someone else's opinions about billing, all on a day when the only thing you need is a form that collects email addresses. You spend the first week deleting code instead of testing an idea.

Saasaloy starts the other way around. Saasaloy is built on one rule: a SaaS has stages, and the code scaffold should match the stage. `saasaloy init` gives you a landing page and nothing else. Proably then add a waitlist module to collect potential customer's data. When the waitlist fills up, you add auth to make them registered users. When users ask for a team account, you add teams and tenancy. When someone wants to pay, you add billing. Every module is production-grade code copied into your repo, arriving on the day the product earns it, and not one day sooner.

The second philosophy is that validation stage of a SaaS idea should be free. Saasaloy is Cloudflare-native serverless architecture by default, it runs on Cloudflare by default because you never should be worried about server managment and cost just to explore your SaaS ideas. Workers, D1, KV and R2 keep most modules on the free tier, so you can go from a Saturday idea to a first paying customer with a hosting bill close to zero.

Cloudflare is the default, not the cage. Every vendor sits behind a swappable provider, and every capability ships a console or in-memory version so you can build the whole thing offline, with no cloud account at all.

These are the reasons behind the born of Saasaloy.

## How it works

- **You own the code.** Nothing is imported from a Saasaloy package at runtime. The CLI writes files into your repo and gets out of the way. Edit anything.
- **Start small, add on demand.** `saasaloy init` gives you an Astro landing page and a UI package. Everything else arrives with `saasaloy add <module>`, with its dependencies resolved and installed first.
- **Swappable providers.** `email`, `sms`, `queue`, `kv`, `storage`, `logger` and `billing` each expose one interface. Pick the vendor with a `*_PROVIDER` env var, or drop in a `-console` or `-memory` provider for local work.
- **Agent-native.** Every generated project ships `AGENTS.md`, `CLAUDE.md`, a `DESIGN.md` contract, and a skill per installed module for Claude Code and other coding agents.
- **Reversible and updatable.** `saasaloy remove` undoes a module from its manifest. `saasaloy update` re-applies the base and modules at a newer version with a merge plan for the files you edited.

The full picture of how the CLI, the registry and a generated project fit together is in [Architecture](docs/wiki/architecture.md).

## Quick start

Requires Node 24.13.0+ and pnpm 11+. No Cloudflare account is needed until you deploy.

```bash
npm install -g saasaloy
# or: pnpm add -g saasaloy, or prefix commands with npx

saasaloy init my-app
cd my-app
pnpm install

pnpm dev

# landing page on http://localhost:3000
```

Then add modules as the product grows:

```bash
saasaloy list                
# what the registry offers, and what you already have

saasaloy add waitlist        
# pulls api, validators and database, then asks for a database driver

saasaloy add admin           
# pulls auth, then an auth-gated admin SPA
```

`saasaloy add <name> --dry-run` prints what a module would do to your project before it does it.

Full walkthrough: [Getting started](docs/wiki/getting-started.md), then [Make the project yours](docs/wiki/how-to/make-it-yours.md) for the bundled skills that write your product brief, landing copy and theme.

## A project through its stages

| Stage | What you need | What you add |
|---|---|---|
| Validate the idea | a landing page and a waitlist | `init`, then `waitlist` |
| Build the MVP | sign-in, an admin app, transactional email | `auth`, `admin`, `email` + a provider |
| Onboard teams | organizations, tenant isolation, roles | `teams`, `multitenant`, `rbac` |
| Charge money | subscriptions, plan limits, webhooks | `billing`, `billing-stripe`, `entitlements` |
| Scale the backend | jobs, caching, files, rate limits, API access | `queue`, `kv`, `storage`, `ratelimit`, `api-keys` |

Each row installs on top of the previous one. Nothing from a later row lands in your repo until you ask for it.

## The stack

| Concern | Choice |
|---|---|
| Marketing site (`apps/web`) | Astro on Workers static assets |
| App (`apps/admin`) | TanStack Router + Vite SPA |
| Backend (`apps/api`) | Hono on Cloudflare Workers |
| Database | Drizzle ORM on D1 (SQLite) or Postgres |
| Auth | Better Auth |
| Billing | Stripe, or a console provider |
| Email | Cloudflare Email Sending, Plunk, or a console logger |
| Storage | Cloudflare R2, or in memory |
| Background work | Cloudflare Queues and Cron Triggers, or an in-process runner |
| Infra | wrangler per workspace, or Pulumi via the `infra` module |
| Monorepo | Turborepo + pnpm |

## Modules

Modules come in tiers. A **capability** scaffolds a workspace and sets conventions. A **feature** drops files into those conventions. A **provider** supplies one implementation behind a capability's interface and is picked at runtime. A **driver** supplies the connection half of a stateful capability, and only one may be installed.

| Tier | Modules |
|---|---|
| Capability | `api`, `database`, `validators`, `logger`, `auth`, `admin`, `email`, `sms`, `queue`, `kv`, `storage`, `billing`, `infra` |
| Feature | `waitlist`, `teams`, `multitenant`, `rbac`, `api-keys`, `entitlements`, `email-react`, `ratelimit`, `feature-flags` |
| Provider | `email-console`, `email-cloudflare`, `email-plunk`, `logger-console`, `sms-console`, `queue-cloudflare`, `queue-memory`, `kv-cloudflare`, `kv-memory`, `storage-cloudflare`, `storage-memory`, `billing-console`, `billing-stripe` |
| Driver | `database-d1`, `database-postgres` |

What each module gives you and what it depends on is on the [Modules](docs/wiki/modules.md) page. Which ones need a paid Cloudflare plan or a third-party account is in the [Reference](docs/wiki/reference.md#email-providers). The short version: the base, `api`, `database-d1`, `auth`, `admin`, `waitlist` and `teams` run on the free tier, and every local provider runs with no account at all.

The default registry is this repo. `saasaloy add waitlist` fetches `modules/waitlist/` from GitHub at a pinned commit SHA. Any repo with a `modules/` directory can serve as a registry with `saasaloy add owner/repo/<name>`. To publish your own, start at [Contribute a module](docs/wiki/how-to/contribute-a-module.md).

## Commands

`init`, `add`, `remove`, `update`, `outdated`, `env`, `list`, `new` and `doctor`. Every command answers `--help`. Flags, exit codes, the coordinate grammar and the project files are in the [Reference](docs/wiki/reference.md).

## Deploy

Each deployable workspace owns its `wrangler.jsonc` and `deploy` script, or the `infra` module deploys every Worker with one Pulumi program. See [Deploy to Cloudflare](docs/wiki/how-to/deploy-to-cloudflare.md).

## Documentation

Everything lives in [`docs/wiki/`](docs/wiki/index.md). Start with [Getting started](docs/wiki/getting-started.md), then [Modules](docs/wiki/modules.md) and the [Reference](docs/wiki/reference.md). [`CONTEXT.md`](CONTEXT.md) defines the vocabulary, and [`docs/adr/`](docs/adr/) records why the design is what it is, one decision per file.

## Status and roadmap

Saasaloy is pre-1.0 and under active development. Open work, planned modules and known gaps are tracked in the [issues](https://github.com/mimukit/saasaloy/issues). Breaking changes are called out in the [changelog](packages/cli/CHANGELOG.md).

## Contributing

Issues and pull requests are welcome. [`CONTRIBUTING.md`](CONTRIBUTING.md) covers the `.dev/playground`, the lint and test gates, and the dependency update flow.

## License

[MIT](LICENSE.md)
