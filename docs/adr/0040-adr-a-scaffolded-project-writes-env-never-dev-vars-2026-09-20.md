# 0040 — A scaffolded project writes `.env`, never `.dev.vars`

Every runtime that reads environment values in a Saasaloy project reads `.env`. No command writes `.dev.vars` or `.dev.vars.example`, `saasaloy doctor` fails on a leftover one, and `pnpm env:setup` carries its values across and deletes it. Settled while planning `docs/plans/0058-plan-env-capability-2026-09-20.md`.

## Status
accepted. Breaking for a project scaffolded before it.

## Context

The base template carried both names from the start. `apps/api` used `.dev.vars`, because that is wrangler's file; `apps/web` and `apps/admin` used `.env`, because that is what Vite and Astro read. `saasaloy add` generated `apps/api/.dev.vars.example` and `saasaloy env` wrote to whichever of the two it inferred a variable belonged in.

Two facts made the split unnecessary and then actively harmful.

Wrangler 4.131 reads `.env` when no `.dev.vars` sits beside it, and `@cloudflare/vite-plugin` 1.54.4 does the same. One name now serves all three runtimes.

A leftover `.dev.vars` **hides** `.env` from wrangler. Wrangler does not merge the two and does not warn. So a developer who ran the migration, wrote `.env` and left the old file in place gets a Worker that silently reads stale values — the exact failure this capability exists to prevent, caused by the capability's own migration.

## Decision

`.env` everywhere. One name, one loader precedence, no per-workspace example file.

`saasaloy env` writes the gitignored `packages/env/.env`, the one value source. `pnpm env:setup` writes each service's own `.env` from `packages/env/.env.example`. `saasaloy add` regenerates that example and writes no other file.

`pnpm env:setup` reads a leftover `.dev.vars` beside a service's `.env`, folds its values into the file it writes, and deletes it. A project scaffolded before this record migrates with that one command, values intact.

`saasaloy doctor` reports a leftover `.dev.vars` as a finding, because the failure it causes is invisible from the outside.

The base `_gitignore` keeps `.env` and `.env.*` ignored and `*.env.example` tracked. Its `.dev.vars` lines are gone; a project that still has one wants it *visible* until it is deleted.

## Consequences

This is a breaking change and ships under a `feat!` subject. A project that upgrades without running `pnpm env:setup` keeps working, because wrangler still prefers the `.dev.vars` it already has — it breaks on the first key a module adds afterwards, and `doctor` says so before then.

The wrangler and vite versions above are the ones this was verified against. An older wrangler in a project's lockfile does not read `.env`, so the migration is not optional there; the base pins 4.129.0 or newer.
