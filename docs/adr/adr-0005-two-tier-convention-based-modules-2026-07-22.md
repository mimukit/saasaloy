# 0005 — Two-tier, granular, convention-based modules

Modules are granular and split into two tiers: **capability modules** (`api`, `database`, `auth`, `admin`, `email`, …) scaffold an app/package and establish convention-based extension points; **feature modules** (`waitlist`, `billing`, `teams`, …) extend those capabilities by dropping files into their conventions and declaring `dependsOn`. Granularity is required because real MVP stages need different subsets — a landing page's first feature might be a waitlist needing `api` + `database` but explicitly not auth or admin. See build-spec [§2.7](../plans/plan-saasaloy-build-spec-2026-07-21.md).

## Status
accepted

## Considered Options
- A monolithic `add app` — rejected: it forces auth/admin onto stages that don't need them.
- Modules AST-patching each other's internals — rejected in favour of convention-based extension points (a `routes/` folder the Hono entry auto-globs, a schema barrel that auto-re-exports `schema/`), so no module edits another module's code and there is no drift-seam. Genuinely structural edits (a D1 binding, a Better Auth plugin insertion) remain small AST patches — the 10%, not the spine.

## Consequences
- `dependsOn` resolves recursively, topologically sorted, behind a confirmation prompt.
- First proof is `add waitlist` (exercises resolution + file-drop without auth's weight); `add billing` is the harder second proof.
