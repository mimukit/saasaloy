# Modules

Every installable module in the default registry, in one place. This table is the map; the per-module facts a doc page would repeat — dependencies, env vars, config patches — live in each module's `registry-item.json` and print truthfully with `saasaloy add <name> --dry-run`. The tiers (capability, feature, provider) are defined in [`CONTEXT.md`](../../CONTEXT.md).

| Module | Tier | What it gives you |
|---|---|---|
| `api` | capability | an `apps/api` Hono Worker, registered as the `@api` alias |
| `admin` | capability | an `apps/admin` role-gated admin SPA (TanStack Router + Vite), on `api` + `auth` |
| `database` | capability | a `packages/db` workspace with Drizzle ORM and `drizzle-kit`, on `api` |
| `database-d1` | feature (driver) | the Cloudflare D1 connection behind `packages/db`, on `database` |
| `database-postgres` | feature (driver) | the Postgres connection (over postgres.js) behind `packages/db`, on `database` |
| `auth` | capability | a `packages/auth` workspace wrapping Better Auth, on `api` + `database` |
| `email` | capability | a `packages/email` workspace with the provider interface, on `api` |
| `email-console` | feature (provider) | an `email` provider that logs messages instead of sending — no plan, no domain, no key |
| `email-cloudflare` | feature (provider) | an `email` provider on Cloudflare Email Sending — needs a paid Workers plan and a hand-onboarded domain, see [the reference](reference.md#email-providers) |
| `sms` | capability | a `packages/sms` workspace with the provider-agnostic SMS sender, on `api` |
| `sms-console` | feature (provider) | an `sms` provider that logs messages instead of sending |
| `logger` | capability | a `packages/logger` workspace with structured, request-correlated logging, no prerequisites |
| `logger-console` | feature (provider) | a `logger` provider that writes to the console / Workers Logs |
| `validators` | capability | a `packages/validators` workspace of shared Zod input schemas, on `api` |
| `infra` | capability | a root-level `infra` workspace deploying every service to Cloudflare via Pulumi, no prerequisites |
| `waitlist` | feature | a waitlist form plus its API route and table, on `api` + `database` |

Dependencies install automatically: `saasaloy add waitlist` brings `api` and `database` with it, prerequisites first. A capability brings its vendor SDK and encapsulates it, so nothing else in your project imports Hono, Drizzle or Better Auth directly ([ADR 0020](../adr/adr-0020-capability-owns-its-vendor-packages-2026-07-24.md)).

Every module also installs a `saasaloy-<name>` agent skill into your project's `.agents/skills/`, with a `.claude/skills/` symlink. The skill is that module's runbook: how to add a route, a table, a template, or a provider the way the module expects. [Add a module](how-to/add-a-module.md#the-skill-that-comes-with-it) explains where they land.

To see what any module would actually do to your project before installing it:

```bash
saasaloy add <name> --dry-run
```

To list what a registry offers, including third-party ones, see [`saasaloy list`](reference.md#saasaloy-list). To publish a module of your own, start at [Contribute a module](how-to/contribute-a-module.md).

_Verified against `main`@`a21fcce` on 2026-08-31._
