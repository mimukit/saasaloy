---
name: saasaloy-waitlist
description: Runbook for the waitlist feature — a landing-page email waitlist proving the api chained-route patch and the database/web file-drop conventions end to end. Use when adding, changing, or debugging the waitlist route, schema, table, or form, running migrations after install, or setting PUBLIC_API_URL.
---

# waitlist — landing-page email waitlist

`waitlist` is a **feature module** (`saasaloy:feature`): it drops files into the extension points
`api`, `database`, `validators` and the base web template already established, and registers its
route with one `chained-route` patch. It requires
`dependsOn: ["api", "database", "validators"]`, resolved and installed automatically.

## The database driver is your choice, and this payload is SQLite-only

`waitlist` names the `database` capability, never a driver. `database` declares
`requiresOneOf: ["database-d1", "database-postgres"]`, so on a clean project `saasaloy add waitlist`
asks which driver to install, and a non-interactive run refuses and names both. A project that
already has a driver keeps it.

`packages/db/src/schema/waitlist.ts` still builds its table with `sqliteTable` from
`drizzle-orm/sqlite-core`. Pick `database-postgres` and the table does not compile: `pnpm typecheck`
fails on the dialect. That combination has never worked, and the failure is now loud instead of
silent. Earlier releases pinned `dependsOn: ["database-d1"]`, which overrode a Postgres project's
driver choice rather than reporting it.

Porting the table to `drizzle-orm/pg-core` by hand is not the fix. The dialect-neutral rewrite is
tracked in [#99](https://github.com/mimukit/saasaloy/issues/99). Until it lands, a Postgres project
writes its own waitlist table and route, using this module's route and form as the worked example.

## What it drops, and where

| File | Convention it extends |
|------|------------------------|
| `apps/api/src/routes/waitlist.ts` | api's route-module contract — a chained sub-app under `export const waitlist` |
| `packages/db/src/schema/waitlist.ts` | db's `schema/*.ts` glob — one table, `waitlist` |
| `packages/validators/src/waitlist.ts` | validators' one-file-per-feature rule — `@repo/validators/waitlist` |
| `apps/web/src/components/WaitlistForm.tsx` | React island (base template ships React) |
| `apps/web/src/sections/waitlist.astro` | base `index.astro`'s `sections/*.astro` glob |
| `apps/web/src/types/waitlist-env.d.ts` | ambient `ImportMetaEnv` augmentation (see below) |

## What it patches

Three patches; `saasaloy remove` reverses only the first — the other two are dropped with a warning
(#36), so uninstalling leaves the two web dependencies behind:

| Patch | Target | Why |
|---|---|---|
| `chained-route` | `apps/api/src/index.ts` | mounts the route at `POST /waitlist` **and** puts it in `AppType` |
| `package-json-dependency` | `apps/web/package.json` | `hono`, for `hc` from `hono/client` |
| `package-json-dependency` | `apps/web/package.json` | `@repo/api`, for `type { AppType }` |

The route link is a patch, not a drop, because a folder scan gives the chain no type to carry. See
the `saasaloy-api` skill for the convention. Nothing here edits `src/schema.ts` or `index.astro`.

The `hono` patch carries a **version**, `4.12.33`, and it is the only versioned patch range in the
repo. It must match `modules/api/files/package.json`'s `hono` pin: `apps/web` infers `AppType`
across the package boundary from `apps/api`, and two `hono` copies at different versions make that
inference fail in ways the error message does not explain. `pnpm deps:check` scans this range and
fails on drift, but `pnpm deps:update` will not rewrite it — re-serializing the descriptor would
reflow the whole file, so the report prints the edit and you make it by hand (see CONTRIBUTING.md
"Updating dependencies", and #93 for the fix that automates it).

## After install: generate + apply the migration

The table only exists once its migration is generated and applied — this module ships **no
pre-generated SQL**:

```sh
pnpm --filter @repo/db db:generate       # emits SQL for the new `waitlist` table
pnpm --filter @repo/db db:migrate:local  # applies it to local D1
```

## The route's responses

`POST /waitlist` answers with two status codes, both explicit so `hc` can key the response type on
them:

| Status | Body | When |
|---|---|---|
| **201** | `{ ok: true }` | the address was accepted, new or duplicate |
| **400** | `{ error: { code: "invalid_input", message } }` | the address failed `waitlistInput` |

The 400 has two sources and one shape. A body that parses and fails `waitlistInput` hits
`zValidator`'s third-argument failure hook, which returns `errorBody("invalid_input", message)` from
`@repo/validators/common`. A body that does not parse at all never reaches the hook — Hono's json
validator throws `HTTPException(400, "Malformed JSON in request body")` first — and `modules/api`'s
`onError` handler converts that to the same `{ error: { code: "invalid_input", message } }`. Both
paths match the type `hc` publishes. Neither the hook nor the handler is optional: drop either and
one of the two 400s ships as plain text.

## The input schema lives in `@repo/validators`

`packages/validators/src/waitlist.ts` exports `waitlistInput` and `WaitlistInput`. The route does
not define a local `z.object`. The schema reuses `email` from `@repo/validators/common`, which
trims and lowercases before parsing, so `"A@B.com "` and `a@b.com` reach the unique column as the
same value. Widen the accepted input by editing that file, not the route.

## `PUBLIC_API_URL`

`WaitlistForm.tsx` builds a typed client, `hc<AppType>(import.meta.env.PUBLIC_API_URL ??
"http://localhost:4000")`, and calls `api.waitlist.$post({ json: { email } })`. The fallback matches
the api Worker's pinned local dev port — `:4000`, fixed with `strictPort` in `vite.config.ts` and
`dev.port` in `wrangler.jsonc` so it can't drift — so a fresh project needs **no env var in dev**.
Set `PUBLIC_API_URL` at web build time once the api Worker has a real (non-localhost) URL — e.g. its
deployed `*.workers.dev` address or a custom domain.

`waitlist-env.d.ts` augments Astro/Vite's `ImportMetaEnv` with `PUBLIC_API_URL` so the read
typechecks. It's a global ambient `interface` in its own file — TypeScript merges same-named
interfaces across files, so a future feature can add its own env var the same way without
touching this one.

## Duplicate submissions are a success, not an error

`POST /waitlist` uses `.onConflictDoNothing()` on the unique `email` column: resubmitting an
email already on the list returns the same `201 { ok: true }` response and does **not** insert a
second row. This is deliberate — it avoids leaking "is this email already on the list" as a side
channel, and keeps the form's UI simple (no special-cased duplicate error state).

## CORS

`web` and `api` are separate origins in dev (`:3000` vs `:4000`) and in prod, so the form's request
is cross-origin. The route itself carries **no CORS code**: `modules/api`'s entry applies the
credentialed `CORS_ORIGINS` allowlist to `*` before this sub-app is mounted, and a route-level
`cors()` would run as an inner middleware and overwrite those headers with permissive defaults.
If a submission is blocked in the browser, check `CORS_ORIGINS` on the api Worker.

## Boundaries to honor

- **The route registers by patch; table, component and section stay file-drops.** Extend any of
  them by editing the dropped file. The one edit to `apps/api/src/index.ts` is the `chained-route`
  patch's, so don't hand-write the link and don't reach into `src/schema.ts` or `index.astro`.
- **Keep the route one unbroken chain.** A `waitlist.post(...)` statement still serves the request
  and still typechecks, but `typeof waitlist` forgets it, so `api.waitlist` disappears from the
  client with no error anywhere in `apps/api`.
- **Input shapes live in `@repo/validators/waitlist`**, not inline in the route.
- **Migrations stay manual** — `db:generate` then `db:migrate:local`/`:prod`, per the
  `saasaloy-database` skill. Never auto-migrate.
- **Duplicate email → 201, not error.** Don't change this to a 409 without reconsidering the
  membership-leak tradeoff above.
- **D1 is a hard requirement.** The table is `sqliteTable`, so don't rewrite it as `pgTable` to get
  this running on `database-postgres` — see the section above.
- **No email-confirmation flow ships here.** Optional `email`-module integration is a follow-up
  (no resolver support yet for optional `dependsOn`); this module's `dependsOn` is a hard
  requirement on `api` + `database` + `database-d1` + `validators` only.
