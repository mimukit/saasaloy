# QA — tenant scoping, rbac and api keys (#128)

Covers `modules/multitenant`, `modules/rbac` and `modules/api-keys`, on `database-d1` and on `database-postgres`. The api half of this script is automated as `scripts/qa-tenant-scoping.sh`, driven against a playground the helper `scripts/qa-tenant-scoping-serve.sh` brings up on a clean database. The screens are a manual walkthrough and are listed at the end.

Both drivers were run on 2026-09-09 and both reported `47 passed, 0 failed`.

## What you need

A working `.dev/playground`, a Postgres for the second pass, and `jq`. The Postgres used here was a throwaway container:

```bash
docker run -d --name qa128-pg -e POSTGRES_PASSWORD=pg -e POSTGRES_USER=pg -e POSTGRES_DB=pg -p 55433:5432 postgres:17-alpine
```

## Pass 1 — `database-d1`

```bash
pnpm run play:reset
cd .dev/playground
./saasaloy add database-d1 --yes
./saasaloy add api-keys --yes          # brings auth, admin, teams, multitenant, rbac with it
pnpm install
```

Write `apps/api/.dev.vars`. `BETTER_AUTH_URL=http://localhost:4000` and `CORS_ORIGINS=http://localhost:4000` are the two that matter; the script sends `Origin: http://localhost:4000` on every call, and Better Auth rejects a request with no origin.

```bash
pnpm -C packages/db db:generate
cd ../..
bash scripts/qa-tenant-scoping-serve.sh                  # migrates a clean D1 and starts the api on :4000
DRIVER=d1 bash scripts/qa-tenant-scoping.sh
```

Expect `d1: 47 passed, 0 failed`.

Then the compile-time half, which the script does not cover:

```bash
cd .dev/playground && pnpm typecheck
(cd packages/db && pnpm exec tsc --noEmit)
```

`packages/db` must exit 0. To prove the eight `@ts-expect-error` lines in `src/tenant.typecheck.ts` are load-bearing, delete one and re-run: `tsc` must fail. Three were checked this way (the raw-string case, the table-with-no-tenant-column case, and the insert-supplies-organizationId case) and each one failed as expected.

`pnpm typecheck` at the playground root still reports three errors. All three predate this work: `packages/auth/src/auth.ts` `TS18046: 'authDb.select' is of type 'unknown'`, and two `Bindings`/`LoggerEnv` mismatches at `apps/api/src/index.ts` lines 122 and 148.

## Pass 2 — `database-postgres`

Same shape, with the driver swapped and `DATABASE_URL` set:

```bash
pnpm run play:reset
cd .dev/playground
./saasaloy add database-postgres --yes
./saasaloy add api-keys --yes
pnpm install
# .dev.vars as above, plus DATABASE_URL=postgres://pg:pg@localhost:55433/pg
pnpm -C packages/db db:generate
cd ../..
PG='postgres://pg:pg@localhost:55433/pg' bash scripts/qa-tenant-scoping-serve.sh
DRIVER=postgres bash scripts/qa-tenant-scoping.sh
```

Expect `postgres: 47 passed, 0 failed`, and the same three pre-existing typecheck errors and no others.

Confirm the key column holds a hash rather than the plaintext:

```bash
docker exec qa128-pg psql -U pg -d pg -A -t \
  -c "select name, start, length(key), key not like 'sk\_%' as hashed, permissions from apikey;"
```

The observed row was `qa-b|sk_KNYDy|43|t|{"project":["read"]}` — 43 characters is the base64url of a 32-byte SHA-256 digest, the `start` column carries the eight-character prefix the screen shows, and the scope round-tripped.

## What the script checks

Numbered against the issue's acceptance criteria.

- **P2-1, P2-5.** `GET /tenant` on the cookie path returns `organizationId` and `principal`, and a member of org A resolves to org A with `principal.kind === "member"`.
- **P2-2.** A signed-in caller who belongs to no organization gets 403 on `/tenant` and on `/projects`, and the body message is exactly `no active organization`.
- **P2-3.** A `superadmin` sending `x-organization-id: <B>` gets org B. Any other role sending the same header gets 403 `forbidden`.
- **P2-8.** With rows in org A and org B, `GET /projects` returns only the caller's own rows, for the owner and for a plain member alike.
- **P3-2.** A member holding `project: ["read"]` gets 403 on `DELETE /projects/:id` and on `POST /projects`, with the message `permission required: project:delete`. The owner's delete returns 200.
- **P3-3.** `create-role`, `update-role` and `delete-role` are each 403 on `owner`, `admin` and `member`. A custom name (`auditor`) is allowed.
- **P4-1.** The plaintext comes back once from `/api-key/create`, and a re-read through `/api-key/list` returns no `key`.
- **P4-2.** `permissions` round-trips as the requested map, `expiresAt` is null when no expiry was asked for, and `lastRequest` advances after a bearer call.
- **P4-3.** A member holding only `project: ["read"]` is refused a key scoped `project: ["delete"]`, with 403 from `apiKeyScopeGuard`.
- **P4-4.** `GET /tenant` with `Authorization: Bearer <key>` and no cookie returns the key's organization and `principal: { kind: "apiKey", keyId, … }`. `x-organization-id` beside a bearer header is 403.
- **P4-5.** After `/api-key/delete`, the next bearer call is 401 with the message `invalid api key`.
- **P4-6.** A key scoped `project: ["read"]` gets 200 on `GET /projects` and 403 on `DELETE /projects/:id`, and the refusal message is the one `can()` produces.
- **P5-1.** Three bearer requests in a row against one live api process resolve A, then B, then A, and each key's `GET /projects` returns only its own organization's rows. This is the ADR 0029 assertion: the module-scope `auth` singleton with a request-scoped db client behind it does not leak one request's tenant into the next.

## Removal behaviour (P5-2)

From a playground with all three installed:

```bash
cd .dev/playground
./saasaloy remove multitenant --yes; echo $?
```

Exits `2` and prints `multitenant is still depended on by rbac — refusing (use --force to remove it anyway).`

```bash
./saasaloy remove api-keys --yes
```

Reverts exactly five patches — two `plugin-array` on `packages/auth/src/auth.ts`, one on `client.ts`, one on `tenant.ts`, and one `const-array` on the admin shell — then warns that the `package-json-dependency` patch on `packages/auth/package.json` has no removal inverse, and prints the `apikey` table warning.

## Manual walkthrough (P3-4, P4-7)

Not covered by the script; a browser is needed. Start `pnpm dev` in the playground and sign in as the first account, which holds `superadmin`.

**`/roles`.** The active organization's roles render as a resource-by-action grid. The three base roles show no edit and no delete control. Create a custom role, edit it, and delete it. Assign it to a member from the member list, then confirm delete is disabled and names the holders. Sign in as a member whose `can()` over `GET /tenant` denies role management and confirm the controls are absent.

**`/api-keys`.** The list shows name, `start`, expiry, last used and enabled, plus the note that a scope is fixed at issue time. The create form's scope picker offers only statements the caller holds. The plaintext appears once in a copy box; navigate away and back and confirm it is gone. Revoke removes the row.

## Known failures, not caused by this work

The generated project's own `pnpm lint` is red before it reaches anything here. `lint:types` (`oxlint --type-aware packages/ui/src`) and `lint:code` both report `No files found to lint`, `lint:css` reports an `@apply` prelude error in the base template's CSS, and `format:check` reports `apps/api/src/index.ts` and `packages/auth/src/auth.ts`. The two prettier failures are patch-engine output: `chained-route` writes `import {adminUsers}` with no inner spaces and appends `.route()` links past the print width, and `plugin-array` leaves no trailing comma on the last element it appends. Both come from `modules/admin` and the unchanged engine, so both are visible on `main`.
