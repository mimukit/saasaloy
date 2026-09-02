---
name: saasaloy-waitlist
description: Runbook for the waitlist feature — a landing-page email waitlist proving the api chained-route patch and the database/ui file-drop conventions end to end. Use when adding, changing, or debugging the waitlist route, schema, table, or block, placing the block on a page, running migrations after install, or setting PUBLIC_API_URL.
---

# waitlist — landing-page email waitlist

`waitlist` is a **feature module** (`saasaloy:feature`): it drops files into the extension points
`api`, `database`, `validators`, `packages/ui` and `apps/web` already established, registers its
route with one `chained-route` patch, and leaves one step to you — placing its form on a page (see
[Wire-up](#wire-up)). It depends on `api`, `database` and `validators`, resolved and installed
automatically. It names no database **driver**: `database`'s own `requiresOneOf` is what guarantees
one is present.

## Either database driver

This module installs against `database-d1` or `database-postgres`, and picks the right table
declaration for whichever one the project holds. It ships the table twice:

| Source in the module | Installs when | Dialect |
|---|---|---|
| `files/db/schema/waitlist.sqlite.ts` | `onlyWith: "database-d1"` | `sqliteTable`, `drizzle-orm/sqlite-core` |
| `files/db/schema/waitlist.pg.ts` | `onlyWith: "database-postgres"` | `pgTable`, `drizzle-orm/pg-core` |

Both name the same `target`, `packages/db/src/schema/waitlist.ts`, so exactly one lands and the
other is filtered out before the plan is built. `saasaloy add waitlist --dry-run` prints which
source it chose.

**Everything else is one file.** The route, the validators and the block are dialect-neutral,
because Drizzle's query builder is the same under both dialects and the driver's `withDb(c, …)` is
the same call. The dialect reaches the column declarations and stops there.

The two variants are the same table, so keep them in step. They differ only where each dialect is
idiomatic: the SQLite id is `integer("id").primaryKey({ autoIncrement: true })` and the Postgres id
is `integer("id").primaryKey().generatedAlwaysAsIdentity()`; `created_at` is a millisecond integer
on SQLite (`mode: "timestamp_ms"`, defaulted from `unixepoch('subsecond')`) and a `timestamptz` on
Postgres (defaulted from `now()`). A row comes back the same shape either way.

**Switching driver is remove-then-add, and it takes this module with it.** The unchosen variant is
filtered before planning, so a project that swaps `database-d1` for `database-postgres` keeps the
SQLite table it already installed. Remove `waitlist` and add it again after the driver switch to
get the other variant. There is no data migration; see ADR 0026.

## What it drops, and where

| File | Convention it extends |
|------|------------------------|
| `apps/api/src/routes/waitlist.ts` | api's route-module contract — a chained sub-app under `export const waitlist` |
| `packages/db/src/schema/waitlist.ts` | db's `schema/*.ts` glob — one table, `waitlist`, in the installed driver's dialect |
| `packages/validators/src/waitlist.ts` | validators' one-file-per-feature rule — `@repo/validators/waitlist` |
| `packages/ui/src/blocks/waitlist.tsx` | ui's blocks folder — one file, one component export, same as every base block |
| `apps/web/src/components/WaitlistForm.tsx` | the app's own island — supplies the block's `onSubmit` |
| `apps/web/src/types/waitlist-env.d.ts` | ambient `ImportMetaEnv` augmentation (see below) |

**The block is presentational and the app supplies the behaviour.** `Waitlist` renders the panel,
owns the form's own state, and takes a required `onSubmit`. It imports React and three ui
primitives, and nothing else — no api package, no http client, no env var. `WaitlistForm.tsx`
holds all of that: it builds `hc<AppType>` and passes the function down. Keeping `packages/ui`
clear of the api package is not tidiness — a design package that imports it compiles the whole
Worker source tree on every `pnpm typecheck`.

**Neither file is placed for you.** `saasaloy add waitlist` writes both and stops; no command edits
a page. Read [Wire-up](#wire-up) for the two lines that put the form on the landing page.

## Wire-up

Put the form on a page yourself:

1. Open `apps/web/src/pages/index.astro`.
2. Add the import, beside the other block imports:

   ```astro
   import WaitlistForm from "@web/components/WaitlistForm";
   ```

3. Render it inside `<main>`, after `<Cta siteName={siteName} />` — or wherever you want it:

   ```astro
   <WaitlistForm client:load />
   ```

Import `WaitlistForm`, **not** `Waitlist`. The block needs a function prop, and Astro serializes
island props, so a function cannot cross from `.astro` into an island. `WaitlistForm` is the React
file that closes over it. This is also why `client:load` is required rather than a default: the form
owns browser state, and with no client directive the page renders dead HTML whose button does
nothing. The whole block hydrates, heading and paragraph included, because a static React parent
cannot hold a hydrated React child.

The suggested spot is after `<Cta />` for one reason: both use the muted panel, and this block is
laid out in two columns so that the pair does not read as two centred panels in a row. Move it and
the page still works.

`Waitlist` also takes optional `id`, `title` and `description` props, which `WaitlistForm` is the
place to pass. Its copy lives in the block file rather than in
`packages/ui/src/content/landing.ts`, because that content module belongs to the base and this
module never edits a file it does not own.

`saasaloy remove waitlist` deletes both files and **does not** touch the import you added. Take
those two lines out yourself, or the page stops building.

## What it patches

Three patches; `saasaloy remove` reverses only the first — it does not uninstall npm dependencies,
so the other two are dropped with a warning and uninstalling leaves them in
`apps/web/package.json`:

| Patch | Target | Why |
|---|---|---|
| `chained-route` | `apps/api/src/index.ts` | mounts the route at `POST /waitlist` **and** puts it in `AppType` |
| `package-json-dependency` | `apps/web/package.json` | `hono`, for `hc` from `hono/client` |
| `package-json-dependency` | `apps/web/package.json` | `@repo/api`, for `type { AppType }` |

The route link is a patch, not a drop, because a folder scan gives the chain no type to carry. See
the `saasaloy-api` skill for the convention. Nothing here edits `src/schema.ts` or `index.astro`.

The `hono` patch carries a **version**, `4.13.5`, and it is the only versioned patch range in the
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
```

`db:generate` belongs to the `database` core and is the same command under either driver. **The
apply step is the driver's**, and the command differs, so read the skill for the driver this
project installed: `saasaloy-database-d1` or `saasaloy-database-postgres`. Nothing here should name
one of them, because this module works with both.

### Updating a D1 project that installed waitlist before the two-variant split

`created_at` used to be `integer("created_at", { mode: "timestamp" })`, which stores **whole
seconds**. The SQLite variant now uses `mode: "timestamp_ms"`, which stores **milliseconds**. The
integers already in the table do not change when `saasaloy update waitlist` rewrites the schema
file — only the way Drizzle reads them changes, so every pre-existing row comes back dated near
1970.

Nothing this module ships reads `createdAt` back (the route only inserts), so a project that never
queries the column can ignore this. If yours does, rescale the old rows once, after the update and
before the first read:

```sql
UPDATE waitlist SET created_at = created_at * 1000 WHERE created_at < 100000000000;
```

The `WHERE` clause is what makes it safe to run twice: a genuine millisecond timestamp is already
past that bound, so a second run touches nothing. Apply it with the same command your driver's
skill gives for migrations. Postgres projects are unaffected — `timestamptz` never carried the
seconds form.

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

`waitlist-env.d.ts` augments the bundler's `ImportMetaEnv` with `PUBLIC_API_URL` so the read
typechecks. It's a global ambient `interface` in its own file — TypeScript merges same-named
interfaces across files, so a future feature can add its own env var the same way without
touching this one. It sits in `apps/web` rather than `packages/ui`, because the env read sits there
too — the block takes a function and never looks at `import.meta.env`.

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

- **The route registers by patch; table, block and island stay file-drops.** Extend any of them by
  editing the dropped file. The one edit to `apps/api/src/index.ts` is the `chained-route` patch's,
  so don't hand-write the link and don't reach into `src/schema.ts`.
- **The block stays free of the api.** `packages/ui/src/blocks/waitlist.tsx` takes `onSubmit` and
  imports React and ui primitives only. Never move `hc`, `@repo/api`, or an `import.meta.env` read
  into it: `packages/ui` has a `typecheck` script, and one import of `@repo/api` there makes `tsc`
  compile the whole Worker source tree under the ui package's own tsconfig.
- **The form's placement is the owner's, and no code of ours writes it.** Never teach a user to
  expect the form on the page automatically, and never add a patch that edits `index.astro`. The
  Wire-up section above is the whole mechanism.
- **Keep the route one unbroken chain.** A `waitlist.post(...)` statement still serves the request
  and still typechecks, but `typeof waitlist` forgets it, so `api.waitlist` disappears from the
  client with no error anywhere in `apps/api`.
- **Input shapes live in `@repo/validators/waitlist`**, not inline in the route.
- **Migrations stay manual** — `db:generate` from the `saasaloy-database` skill, then the apply
  command from the installed driver's skill. Never auto-migrate.
- **Duplicate email → 201, not error.** Don't change this to a 409 without reconsidering the
  membership-leak tradeoff above.
- **The dialect lives in the two schema variants and nowhere else.** Edit both when the table
  changes, and keep the route on `withDb(c, …)` and the shared query builder. A `sqlite-core` or
  `pg-core` import anywhere but `files/db/schema/waitlist.*.ts` pins this module to one driver
  again.
- **No email-confirmation flow ships here.** Optional `email`-module integration is a follow-up
  (no resolver support yet for optional `dependsOn`); this module's `dependsOn` is a hard
  requirement on `api` + `database` + `validators` only.
