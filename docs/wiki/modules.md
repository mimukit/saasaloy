# Modules

Every installable module in the default registry, in one place. This table is the map; the per-module facts a doc page would repeat — dependencies, env vars, config patches — live in each module's `registry-item.json` and print truthfully with `saasaloy add <name> --dry-run`. The tiers (capability, feature, provider) are defined in [`CONTEXT.md`](../../CONTEXT.md).

| Module | Tier | What it gives you |
|---|---|---|
| `api` | capability | an `apps/api` Hono Worker, registered as the `@api` alias, on `logger` + `logger-console` |
| `logger` | capability | a `packages/logger` workspace with the provider interface, level threshold and field redaction |
| `logger-console` | feature (provider) | a `logger` provider that writes structured JSON to the Worker's console |
| `validators` | capability | a `packages/validators` workspace holding the zod request schemas and the shared `{ error: { code, message } }` envelope, on `api` |
| `database` | capability | a `packages/db` workspace with Drizzle ORM and `drizzle-kit`, on `api`. Ships no client: it names `database-d1` and `database-postgres` in `requiresOneOf`, so `add` makes you pick one |
| `database-d1` | feature (driver) | the Cloudflare D1 client, `drizzle.config.ts` and wrangler binding. Conflicts with `database-postgres` |
| `database-postgres` | feature (driver) | the Postgres client over `postgres.js`, a Hyperdrive-aware `getDb`, and a `withDb` callback helper that scopes a client to one handler and closes it. Conflicts with `database-d1` |
| `auth` | capability | a `packages/auth` workspace wrapping Better Auth, on `api` + `database`. Installs under either driver: it ships its schema and its db provider in a SQLite and a Postgres variant, and holds a request-scoped db client behind the module-scope singleton ([ADR 0029](../adr/adr-0029-auth-holds-a-request-scoped-db-client-2026-08-31.md)) |
| `admin` | capability | an `apps/admin` TanStack Router SPA behind the auth session, on `api` + `auth` |
| `email` | capability | a `packages/email` workspace with the provider interface, the escaping `html` tag and `safeUrl`, on `api` |
| `email-console` | feature (provider) | an `email` provider that logs messages instead of sending — no plan, no domain, no key |
| `email-cloudflare` | feature (provider) | an `email` provider on Cloudflare Email Sending — needs a paid Workers plan and a hand-onboarded domain, see [the reference](reference.md#email-providers) |
| `email-react` | feature | a `packages/email-react` workspace that adds opt-in JSX templates on [React Email](https://react.email), plus its preview server, on `email`. The tagged-template idiom stays; a JSX template returns a promise ([ADR 0031](../adr/adr-0031-react-email-is-an-opt-in-render-engine-2026-09-03.md)) |
| `sms` | capability | a `packages/sms` workspace with the provider interface and segment counting, on `api`. Cloudflare has no SMS product, so there is no Cloudflare-native provider |
| `sms-console` | feature (provider) | an `sms` provider that logs messages instead of sending |
| `waitlist` | feature | a waitlist form plus its API route and table, on `api` + `database` + `validators`. Its table ships in a SQLite and a Postgres variant, so it installs under either driver |
| `teams` | feature | Better Auth organizations, memberships and copy-ID invitations, plus a site-admin Teams screen, on `auth` + `admin` |
| `infra` | capability | an `infra` workspace holding the Pulumi program that deploys every Worker in the project. Depends on nothing |

Dependencies install automatically: `saasaloy add waitlist` brings `api`, `logger`, `logger-console`, `validators` and `database` with it, prerequisites first. The one thing it will not choose for you is the database driver. `database` names both drivers in `requiresOneOf`, so on a project that has neither, an interactive run asks which one and a `--yes` run stops and names the options:

```
Cannot add waitlist — unmet requirement:
  database (required by waitlist) needs one of: database-d1, database-postgres, and none is installed. Run `saasaloy add database-d1` first, or pick another from that list.
```

Add a driver first and the second run goes through. A capability brings its vendor SDK and encapsulates it, so nothing else in your project imports Hono, Drizzle or Better Auth directly ([ADR 0020](../adr/adr-0020-capability-owns-its-vendor-packages-2026-07-24.md)).

To see what any module would actually do to your project before installing it:

```bash
saasaloy add <name> --dry-run
```

To list what a registry offers, including third-party ones, see [`saasaloy list`](reference.md#saasaloy-list). To publish a module of your own, start at [Contribute a module](how-to/contribute-a-module.md).

_Verified against the descriptors in `modules/` on 2026-09-01._
