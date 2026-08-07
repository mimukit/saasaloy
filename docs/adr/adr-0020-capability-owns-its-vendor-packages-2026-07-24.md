# 0020 — Capability workspaces encapsulate their vendor packages

A capability module that owns an **integration boundary** scaffolds a workspace that **owns that boundary outright**: any npm package is declared only in the scaffolded workspace's `package.json`, and every other workspace consumes the capability through its exported utilities — never by importing the vendor package, SDK, or binding directly. A vendor SDK is the common form of that boundary, not the test for it: `email`'s core has no SDK at all, and still scaffolds `packages/email`. `database` already worked this way (`packages/db` owns `drizzle-orm`; routes import `getDb` from `@db/client`); `auth` now follows it deliberately (`packages/auth` owns `better-auth` and exports `@auth/server` / `@auth/client`; `apps/api` receives only a thin `routes/auth.ts` that imports `@auth/server`). Settled while grilling issue #12 (the `auth` capability module).

## Status
accepted (trigger broadened 2026-08-04 — see "Integration boundary, not just an SDK")

## Considered Options
- **Wire the vendor SDK directly into the consuming app** (e.g. Better Auth config at `apps/api/src/lib/auth.ts`) — rejected: it spreads the vendor import across workspaces, so an upgrade or swap touches every consumer, and the admin SPA would later need its own direct `better-auth/client` dependency. Encapsulation contains vendor churn — the exact churn Saasaloy exists to manage — in one workspace.
- **Leave it as an unrecorded habit** — rejected: `database` happened to be shaped this way, but nothing stopped `auth` from being authored app-wired, and the next capability (`email`) faces the same fork. Recording the boundary makes it the default for every future capability.

## Consequences
- **Import boundary:** only the capability's own workspace may import its vendor package(s). Other workspaces import the capability's exports (`@auth/server`, `@db/client`). Thin drop-ins a capability places in other workspaces (an api route, a schema file) obey the same rule.
- **Feature plugin deps land in the capability's workspace:** when a feature patches a capability's extension point (e.g. `billing` pushing `stripe()` into the auth plugin array), its vendor-plugin npm dep (`@better-auth/stripe`) merges into the capability workspace's `package.json` — the vendor surface stays in one place.
- **Patch targets live inside the capability's workspace:** the Better Auth plugin-array patch point is `packages/auth/src/auth.ts`, not a file in `apps/api`.
- **One deliberate exception:** Drizzle table definitions always land in `packages/db`'s schema barrel (`schema/<name>.ts`), even when another capability authors them (auth's user/session tables). Schema is `database`'s domain, the barrel is what migrations see, and `packages/auth` → `packages/db` must stay acyclic; those files live *in* the db workspace, so the import boundary holds.
- Extends the ADR 0013 / create-module rule "a capability declares its deps in the `package.json` it scaffolds" from *where deps are declared* to *who may import them*.

## Integration boundary, not just an SDK (2026-08-04)

`email` forced the trigger clause open: the capability's core has **zero runtime dependencies**, so "built around a vendor SDK" would have excluded it, and it still needs its own workspace. The test is whether the capability owns an **integration boundary** — a seam where the project meets something outside it — npm-shaped or not. Two concrete reasons, neither hypothetical:

- **Import direction.** `packages/auth` has to send verification and password-reset mail. `apps/api` already depends on `@repo/auth`, so `packages/auth` → `apps/api` is a cycle; a sender that lived in the api app would be unreachable from the workspace that needs it most. It has to be a package.
- **It is a real patch point.** `packages/email/src/index.ts` holds the `providers` array that every `email-<provider>` module appends to with the existing `plugin-array` codemod — the same role `packages/auth/src/auth.ts`'s plugin array plays for `billing`. When ADR 0020 was written, "patch targets live inside the capability's workspace" was an argument from symmetry; here it is load-bearing.

Deliberately **not** part of the rationale: "swapping providers rewrites one function body." It doesn't. A swap changes `envVars` and `patches` too, which is exactly why a provider is a whole module (see [ADR 0001](adr-0001-all-in-on-cloudflare-2026-07-22.md)'s 2026-08-04 amendment) rather than a branch inside one.

## References
Issues #12, [#15](https://github.com/mimukit/saasaloy/issues/15). Prior: [ADR 0005](adr-0005-two-tier-convention-based-modules-2026-07-22.md), [ADR 0013](adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md), [ADR 0018](adr-0018-database-depends-on-api-2026-07-24.md). Glossary: `CONTEXT.md` → "Capability module", "Provider module".
