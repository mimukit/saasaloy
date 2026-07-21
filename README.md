# SaasAloy - Open source composable SaaS starter kit

An **open source SaaS accelerator** — a composable CLI + module system, not a static boilerplate, inspired by Shadcn UI copy-in modular architecture. It's Shadcn for fullstack SaaS application.

Saasaloy scaffolds by default a Cloudflare-native Turborepo monorepo with a near-inert base, then installs everything churny — API, database, auth, admin, and SaaS features — on demand. Every project it generates is **AI-agent-native**.

As mentioned above, it borrows [shadcn](https://ui.shadcn.com/)'s distribution mechanics (declarative, you-own-the-code descriptors).

## Stack

| Concern | Choice |
|---|---|
| Marketing (`apps/web`) | Astro |
| App (`apps/admin`) | TanStack Router + Vite (SPA) |
| Backend (`apps/api`) | Hono on Workers |
| Database | Drizzle, D1 (SQLite), Postgres (comming soon) |
| Auth | Better Auth|
| Monorepo | Turborepo + pnpm |

All-in on Cloudflare serverless architecture by default to develop & maintain initial version of the SaaS near zero cost.

## How it works

```bash
saasaloy init my-app        # scaffold the base: Astro landing + packages/ui + config
saasaloy add waitlist       # pulls api + database, drops in the feature
saasaloy add billing        # pulls auth + Stripe webhooks + pricing UI
saasaloy sync               # regenerate agent views (AGENTS.md, CLAUDE.md, skill links)
```

### Modules

- **Capability modules** — `api`, `database`, `email`, `auth`, `admin`. Each scaffolds an app or package and establishes convention-based extension points (file-based routes, schema barrels).
- **Feature modules** — `waitlist`, `billing`, `teams`, … Each extends capabilities by dropping files into those conventions and declares its `dependsOn`.

Dependencies resolve recursively, topologically sorted, behind a confirmation prompt.


## License

Licensed under the [MIT license](https://github.com/shadcn/ui/blob/main/LICENSE.md).

