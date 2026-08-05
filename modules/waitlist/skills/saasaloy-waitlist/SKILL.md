---
name: saasaloy-waitlist
description: Runbook for the waitlist feature — a landing-page email waitlist proving the api/database file-drop conventions end to end. Use when adding, changing, or debugging the waitlist route, table, or form, running migrations after install, or setting PUBLIC_API_URL.
---

# waitlist — landing-page email waitlist

`waitlist` is a **feature module** (`saasaloy:feature`): it drops files into the extension points
`api` and `database` already established, and one the base web template ships — no config patch
anywhere. It requires `dependsOn: ["api", "database"]`, resolved and installed automatically.

## What it drops, and where

| File | Convention it extends |
|------|------------------------|
| `apps/api/src/routes/waitlist.ts` | api's `routes/*.ts` glob — mounts at `POST /waitlist` |
| `packages/db/src/schema/waitlist.ts` | db's `schema/*.ts` glob — one table, `waitlist` |
| `apps/web/src/components/WaitlistForm.tsx` | React island (base template ships React) |
| `apps/web/src/sections/waitlist.astro` | base `index.astro`'s `sections/*.astro` glob |
| `apps/web/src/types/waitlist-env.d.ts` | ambient `ImportMetaEnv` augmentation (see below) |

Nothing here edits `src/index.ts`, `src/schema.ts`, or `index.astro` — dropping the files is the
whole installation step.

## After install: generate + apply the migration

The table only exists once its migration is generated and applied — this module ships **no
pre-generated SQL**:

```sh
pnpm --filter @repo/db db:generate       # emits SQL for the new `waitlist` table
pnpm --filter @repo/db db:migrate:local  # applies it to local D1
```

## `PUBLIC_API_URL`

`WaitlistForm.tsx` posts to `${import.meta.env.PUBLIC_API_URL ?? "http://localhost:4000"}/waitlist`.
The fallback matches the api Worker's pinned local dev port — `:4000`, fixed with `strictPort`
in `vite.config.ts` and `dev.port` in `wrangler.jsonc` so it can't drift — so a fresh project
needs **no env var in dev**. Set `PUBLIC_API_URL` at web build time once the api Worker has a real (non-localhost)
URL — e.g. its deployed `*.workers.dev` address or a custom domain.

`waitlist-env.d.ts` augments Astro/Vite's `ImportMetaEnv` with `PUBLIC_API_URL` so the read
typechecks. It's a global ambient `interface` in its own file — TypeScript merges same-named
interfaces across files, so a future feature can add its own env var the same way without
touching this one.

## Duplicate submissions are a success, not an error

`POST /waitlist` uses `.onConflictDoNothing()` on the unique `email` column: resubmitting an
email already on the list returns the same `{ ok: true }` response and does **not** insert a
second row. This is deliberate — it avoids leaking "is this email already on the list" as a side
channel, and keeps the form's UI simple (no special-cased duplicate error state).

## CORS

`web` and `api` are separate origins in dev (`:3000` vs `:4000`) and in prod, so the form's
`fetch` is cross-origin. The route itself carries **no CORS code**: `modules/api`'s entry applies
the credentialed `CORS_ORIGINS` allowlist to `*` before this sub-app is mounted, and a route-level
`cors()` would run as an inner middleware and overwrite those headers with permissive defaults.
If a submission is blocked in the browser, check `CORS_ORIGINS` on the api Worker.

## Boundaries to honor

- **Route, table, component, section are each a pure file-drop** — extend them by editing the
  dropped files directly; don't reach back into `src/index.ts`, `src/schema.ts`, or `index.astro`.
- **Migrations stay manual** — `db:generate` then `db:migrate:local`/`:prod`, per the
  `saasaloy-database` skill. Never auto-migrate.
- **Duplicate email → success, not error.** Don't change this to a 409 without reconsidering the
  membership-leak tradeoff above.
- **No email-confirmation flow ships here.** Optional `email`-module integration is a follow-up
  (no resolver support yet for optional `dependsOn`); this module's `dependsOn` is a hard
  requirement on `api` + `database` only.
