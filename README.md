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

- **Capability modules** — `api`, `database`, `email`, `logger`, `auth`, `admin`. Each scaffolds an app or package and establishes convention-based extension points (file-based routes, schema barrels).
- **Feature modules** — `waitlist`, `billing`, `teams`, … Each extends capabilities by dropping files into those conventions and declares its `dependsOn`.
- **Provider modules** — `email-cloudflare`, `email-console`, `logger-console`, … Each supplies one implementation of a capability's provider interface, so a project picks its email or log sink (later: SMS) service without any calling code learning which one is active.

Dependencies resolve recursively, topologically sorted, behind a confirmation prompt.

## Requirements

Node 24+ and pnpm 11+. A Cloudflare account is needed only once you deploy, or once you install a Cloudflare-backed module — `saasaloy init` needs none at all. Most of the stack then runs on Cloudflare's free tier: `base`, `api`, `database` (D1), `logger`, `auth`, and `waitlist` all work on it.

One module does not, and it's worth knowing before you install it rather than at the first failed send:

| Module | Needs |
|---|---|
| `email-cloudflare` | Workers **paid plan**, plus a sending domain onboarded by hand in the Cloudflare dashboard (Email Service → Email Sending). Neither is something the CLI can do or verify for you. |
| `email-console` | Nothing — it logs the rendered message instead of sending it, so local development and tests need no plan, no domain, and no API key. |

No free-tier promise is made either way: Cloudflare's limits are Cloudflare's to change, and a project that grows past them should expect to pay. The point is only that the constraint is visible up front.

## Documentation

Getting started, how-to guides, the architecture overview and the full command reference live in [`docs/wiki/`](docs/wiki/index.md).

## License

Licensed under the [MIT license](https://github.com/shadcn/ui/blob/main/LICENSE.md).

