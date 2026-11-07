---
title: The first sign-up no longer becomes the superadmin
---

## What update does

The first-user hook leaves `packages/auth/src/auth.ts`. That hook was the `databaseHooks.user.create.before` block in `sharedOptions()`, with the `noUsersYet()` helper it called. It wrote `role: "superadmin"` on the first sign-up to an empty `users` table. Client sign-up is open, so on a deployed api the first stranger to reach `/auth/sign-up` got the admin app.

Now every sign-up gets the `admin()` plugin's default role, `user`, the first one included. The first superadmin comes from outside the api:

- In development, the seed writes `superadmin@example.test`.
- On Postgres in production, `pnpm db:prod:superadmin --email <address>` creates or promotes it. The `database-postgres` module ships the script when `auth` is installed.
- On D1 in production, you sign up, then promote the account with one SQL statement.

## What the merge plan gets

`packages/auth/src/auth.ts`, if you edited it. Keep your edits and delete three things:

- the `databaseHooks: { user: { create: { before } } }` block in `sharedOptions()`;
- the `noUsersYet()` function and its comment;
- the `users as userTable` import from `@repo/db/schema/auth` and the `SUPERADMIN_ROLE` import from `./authorize`, if nothing else in the file uses them.

## What you do

1. Run `saasaloy update auth`, and apply the merge plan to `packages/auth/src/auth.ts`.

2. Check that each deployed database already has a superadmin:

   ```sql
   select email, role from users where role = 'superadmin';
   ```

   An existing superadmin keeps its role. You need the next step only for a database with none.

3. Make the first superadmin on a database that has none. On Postgres, run this from the repo root and type the password twice at the prompt:

   ```sh
   pnpm db:prod:superadmin --email you@example.com
   ```

   On D1, sign up with that email first, then run this from `apps/api`:

   ```sh
   wrangler d1 execute <db> --remote --command "update users set role = 'superadmin' where email = 'you@example.com'"
   ```

   `<db>` is the `database_name` in `apps/api/wrangler.jsonc`.

## Verify

```sh
grep -n "databaseHooks\|noUsersYet" packages/auth/src/auth.ts
```

The command prints nothing.
