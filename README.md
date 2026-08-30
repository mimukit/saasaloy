# SaasAloy - Open source composable SaaS starter kit

An **open source SaaS accelerator** — a composable CLI + module system, not a static boilerplate, inspired by Shadcn UI copy-in modular architecture. It's Shadcn for fullstack SaaS application.

Saasaloy scaffolds by default a Cloudflare-native Turborepo monorepo with a near-inert base, then installs everything churny — API, database, auth, and SaaS features — on demand; an admin app is coming soon ([#13](https://github.com/mimukit/saasaloy/issues/13)). Every project it generates is **AI-agent-native**.

As mentioned above, it borrows [shadcn](https://ui.shadcn.com/)'s distribution mechanics (declarative, you-own-the-code descriptors).

## Stack

| Concern | Choice |
|---|---|
| Marketing (`apps/web`) | Astro |
| App (`apps/admin`) | TanStack Router + Vite (SPA) — coming soon ([#13](https://github.com/mimukit/saasaloy/issues/13)) |
| Backend (`apps/api`) | Hono on Workers |
| Database | Drizzle, on D1 (SQLite) or Postgres |
| Auth | Better Auth|
| Monorepo | Turborepo + pnpm |

All-in on Cloudflare serverless architecture by default to develop & maintain initial version of the SaaS near zero cost.

## How it works

```bash
saasaloy init my-app        # scaffold the base: Astro landing + packages/ui + config
saasaloy add database-d1    # pulls api + database, then binds them to D1 (or pick database-postgres)
saasaloy add waitlist       # pulls api + database, drops in the feature
saasaloy list               # see available modules
saasaloy remove waitlist    # undo an applied module via the manifest
```

### Modules

- **Capability modules** — `api`, `database`, `email`, `logger`, `auth`. Each scaffolds an app or package and establishes convention-based extension points (file-based routes, schema barrels). `admin` is coming soon ([#13](https://github.com/mimukit/saasaloy/issues/13)).
- **Feature modules** — `waitlist`. Each extends capabilities by dropping files into those conventions and declares its `dependsOn`. `billing` ([#14](https://github.com/mimukit/saasaloy/issues/14)) and `teams` ([#16](https://github.com/mimukit/saasaloy/issues/16)) are coming soon.
- **Provider modules** — `email-cloudflare`, `email-console`, `logger-console`, … Each supplies one implementation of a capability's provider interface, so a project picks its email or log sink (later: SMS) service without any calling code learning which one is active.
- **Driver modules** — `database-d1`, `database-postgres`. Each supplies the connection half of a stateful capability, and only one may be installed. The `database` core owns the tables, the schema barrel and `db:generate`; the driver owns the client, the dialect and the migrate commands. `saasaloy add` refuses the second driver rather than letting both sit behind an interface.

Dependencies resolve recursively, topologically sorted, behind a confirmation prompt.

## Requirements

Node 24.13.0+ and pnpm 11+. A Cloudflare account is needed only once you deploy, or once you install a Cloudflare-backed module — `saasaloy init` needs none at all. Most of the stack then runs on Cloudflare's free tier: `base`, `api`, `database` + `database-d1`, `logger`, `auth`, and `waitlist` all work on it.

A few modules ask for something Cloudflare's free tier doesn't cover, and it's worth knowing before you install one rather than at the first failed send:

| Module | Needs |
|---|---|
| `email-cloudflare` | Workers **paid plan**, plus a sending domain onboarded by hand in the Cloudflare dashboard (Email Service → Email Sending). Neither is something the CLI can do or verify for you. |
| `email-console` | Nothing — it logs the rendered message instead of sending it, so local development and tests need no plan, no domain, and no API key. |
| `database-postgres` | A Postgres server you run or rent, reachable from a Worker, with its URL in `DATABASE_URL`. Neon, Supabase and a plain managed instance all work. Cloudflare's Hyperdrive is an optional pooler in front of it, not a substitute for it. Install this **instead of** `database-d1`, never alongside. |

No free-tier promise is made either way: Cloudflare's limits are Cloudflare's to change, and a project that grows past them should expect to pay. The point is only that the constraint is visible up front.

## Documentation

Getting started, how-to guides, the architecture overview and the full command reference live in [`docs/wiki/`](docs/wiki/index.md).

## License

Licensed under the [MIT license](LICENSE.md).

