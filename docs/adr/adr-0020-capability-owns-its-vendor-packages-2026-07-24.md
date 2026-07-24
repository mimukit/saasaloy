# 0020 — Capability workspaces encapsulate their vendor packages

A capability module built around a vendor SDK scaffolds a workspace that **owns that vendor dependency outright**: the npm package is declared only in the scaffolded workspace's `package.json`, and every other workspace consumes the capability through its exported utilities — never by importing the vendor package directly. `database` already worked this way (`packages/db` owns `drizzle-orm`; routes import `getDb` from `@db/client`); `auth` now follows it deliberately (`packages/auth` owns `better-auth` and exports `@auth/server` / `@auth/client`; `apps/api` receives only a thin `routes/auth.ts` that imports `@auth/server`). Settled while grilling issue #12 (the `auth` capability module).

## Status
accepted

## Considered Options
- **Wire the vendor SDK directly into the consuming app** (e.g. Better Auth config at `apps/api/src/lib/auth.ts`) — rejected: it spreads the vendor import across workspaces, so an upgrade or swap touches every consumer, and the admin SPA would later need its own direct `better-auth/client` dependency. Encapsulation contains vendor churn — the exact churn Saasaloy exists to manage — in one workspace.
- **Leave it as an unrecorded habit** — rejected: `database` happened to be shaped this way, but nothing stopped `auth` from being authored app-wired, and the next capability (`email`) faces the same fork. Recording the boundary makes it the default for every future capability.

## Consequences
- **Import boundary:** only the capability's own workspace may import its vendor package(s). Other workspaces import the capability's exports (`@auth/server`, `@db/client`). Thin drop-ins a capability places in other workspaces (an api route, a schema file) obey the same rule.
- **Feature plugin deps land in the capability's workspace:** when a feature patches a capability's extension point (e.g. `billing` pushing `stripe()` into the auth plugin array), its vendor-plugin npm dep (`@better-auth/stripe`) merges into the capability workspace's `package.json` — the vendor surface stays in one place.
- **Patch targets live inside the capability's workspace:** the Better Auth plugin-array patch point is `packages/auth/src/auth.ts`, not a file in `apps/api`.
- **One deliberate exception:** Drizzle table definitions always land in `packages/db`'s schema barrel (`schema/<name>.ts`), even when another capability authors them (auth's user/session tables). Schema is `database`'s domain, the barrel is what migrations see, and `packages/auth` → `packages/db` must stay acyclic; those files live *in* the db workspace, so the import boundary holds.
- Extends the ADR 0013 / create-module rule "a capability declares its deps in the `package.json` it scaffolds" from *where deps are declared* to *who may import them*.

## References
Issue #12. Prior: [ADR 0005](adr-0005-two-tier-convention-based-modules-2026-07-22.md), [ADR 0013](adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md), [ADR 0018](adr-0018-database-depends-on-api-2026-07-24.md). Glossary: `CONTEXT.md` → "Capability module".
