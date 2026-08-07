# 0023 — `api` dependsOn `logger` (a capability the spine consumes is depended on, not patched in)

Every capability so far points *at* `api`: `database` and `email` declare **`dependsOn: ["api"]`** and patch themselves into `apps/api`. `logger` reverses it — **`api` declares `dependsOn: ["logger", "logger-console"]`**, and `logger` declares `dependsOn: []`. The reversal is forced, not stylistic: `logger` cannot take `email`'s shape, because `api → logger → api` is exactly the cycle `resolveGraph` throws on (`packages/cli/src/lib/resolve.ts:20-27`). Something had to give, and the direction that survives is the one where the spine names what it consumes. Settled while grilling issue #66 (the `logger` capability module).

The rule it sets: **a capability the spine *consumes in its own code* is depended on by the spine; a capability the spine merely *hosts* depends on the spine.** `api`'s `src/index.ts` calls `createLogger(c.env)` in its correlation middleware — that is a real import in `api`'s own source, so `@repo/logger` belongs in `apps/api/package.json` as a plain dependency rather than something `logger` patches in. `email` is the mirror: `apps/api` imports nothing from `@repo/email`, so `email` patches its own dependency line into api's `package.json` and `api` stays ignorant of it.

This also gives the practical outcome the plan wanted — a logger in every project that can actually log — without putting `packages/logger` in the base template, which four verified mechanisms ruled out: `apps/web` is a static site with no Worker code to log from, `init` writes no manifest (so no ADR 0006 copy-in path and no `remove`), `init` copies no skills, and `resolveGraph` reads `dependsOn` from the registry rather than `saasaloy.json`.

## Status
accepted — narrows [ADR 0018](adr-0018-database-depends-on-api-2026-07-24.md)'s "`api` remains a root capability with no `dependsOn`" for this edge. `api` is still the root of the *hosting* graph; it is no longer a graph root.

## Considered Options
- **`logger` dependsOn `api`, mirroring `email` and `database`** — rejected: impossible. `api` imports `@repo/logger` in its middleware, so it would need `dependsOn: ["logger"]` in return, and `resolveGraph` throws on the cycle.
- **`logger` dependsOn `api`, with the middleware documented as a copy-paste snippet instead of shipped** — the only way to keep the conventional direction. Rejected: correlation is the feature, and a logger you have to wire up by hand is a logger most projects wire up wrong or not at all. It also leaves `api`'s spine claiming it has no logging story.
- **`packages/logger` in the base template** — rejected on the four mechanisms above; `api → logger` delivers the same intent with zero new machinery.
- **`api` dependsOn `logger` only, leaving the provider to the user** — rejected: it ships a capability whose `providers` array is empty by default, so `saasaloy add api` gives you a no-op logger and a `plugin-array` patch point that nothing has ever exercised. `email-cloudflare` reached the registry with an unverified `matchOn: "name"` exactly that way.

## Consequences
- **`api` is no longer a graph root.** `saasaloy add api` resolves `logger` → `logger-console` → `api` and installs all three behind the normal confirmation prompt. Anything that assumed `api` installs alone is now wrong.
- **First `dependsOn` on a provider module.** `logger-console` is typed `saasaloy:feature` because the descriptor schema has exactly two tiers (the wart recorded in `CONTEXT.md` → *Provider module*), so `api` — a capability — now depends on a `feature`. That is legal in the resolver and reads oddly in the taxonomy; it is not a reason to add a third tier.
- **Direction is decided per capability by who imports whom**, and the rule above is how to tell. Both directions now exist in the registry, which is a thing an author must check rather than assume.
- **Projects that already installed `api` do not retroactively gain `logger`** — `dependsOn` resolves at `add` time. The ADR 0006 copy-in update path is what surfaces the changed `api` files; QA confirms what an existing project sees rather than automating it.
- **`@repo/logger` reaches every downstream workspace transitively** through `apps/api`, so `waitlist`, `auth` and `database` can adopt it without a new dependency — they simply don't yet.

## References
Plans: `docs/plans/plan-logger-capability-module-2026-08-07.md`. Prior: [ADR 0005](adr-0005-two-tier-convention-based-modules-2026-07-22.md), [ADR 0013](adr-0013-module-dependency-ownership-and-scaffolds-files-split-2026-07-23.md), [ADR 0018](adr-0018-database-depends-on-api-2026-07-24.md), [ADR 0020](adr-0020-capability-owns-its-vendor-packages-2026-07-24.md). Issues: #66.
