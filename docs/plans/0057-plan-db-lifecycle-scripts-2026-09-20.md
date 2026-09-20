# Plan: db:setup, db:status and db:drop for the development database

Grilled: 2026-09-20

## Context

A scaffolded Saasaloy project can generate a migration (`db:generate`) and apply one (`db:migrate:local` on D1, `db:migrate` on Postgres). It cannot create a database, report what is applied, or throw one away.

Issue [#152](https://github.com/mimukit/saasaloy/issues/152) reads this as "prepare a local development database". A working precedent says the problem is wider. `/home/dev/projects/unishopr-reborn/packages/db` is a Saasaloy-generated project that already built `db:setup`, `db:status`, `db:drop` and `db:prune`, and its `README.md` names what they solve: **a branch with an unmerged migration must not apply it to a shared development database**, because every other developer then runs schema that is not on `main`. Its answer is a database per git worktree, named from the branch, recorded in a comment block at the top of the env file.

This plan ships both readings in one design, over three developer-chosen backends: a local Docker container, an existing shared server, and a temporary neon.new database.

Success means a developer on a generated Postgres project runs `pnpm db:setup` from a clean checkout and gets a migrated database, and a developer in a feature worktree gets one nobody else shares.

## The precedent

Read `/home/dev/projects/unishopr-reborn/packages/db/README.md` and `scripts/` before implementing. What it proved, and what this plan should not re-derive:

- **`node scripts/<name>.ts`, one file per command**, with shared helpers in `scripts/lib/` (`context.ts`, `state.ts`, `url.ts`, `branch-name.ts`) and one file per backend in `scripts/providers/`. Node's native type stripping runs them.
- **A state block of comment lines at the top of the env file** records the backend, the database, the creation time and `seeded=yes|no`. `db:status`, `db:drop` and the next `db:setup` read it. `lib/state.ts` holds `formatState`, `parseState`, `inferState` and `chooseProvider`, and `inferState` reconstructs a missing block when the URL looks like a branch database. Any other URL makes every script refuse.
- **The branch-name rule.** `issue-<N>-<title>` collapses to `<prefix>_issue_<N>_<sha1[0:6]>`; anything else is lowercased with non-`[a-z0-9]` runs turned into `_`; over 63 bytes it is cut and suffixed with the hash, because PostgreSQL truncates identifiers and two long branches would collide.
- **Safety is a refusal, not a prompt.** `db:drop` ships no confirmation and no `--yes`. It refuses a `DATABASE_URL` the state block does not vouch for, and `assertBranchDatabase` guards every `CREATE DATABASE` and `DROP DATABASE` before the name reaches `sql.unsafe`.
- **`db:status` exits 1 only when the database is unreachable.** It is a report, not a gate.
- **A backend is one file.** `vps.ts` is 5 exported functions; `neon.ts` provisions over HTTP and carries its own quirks (a `uuidv7()` shim for PostgreSQL 17, forced IPv4).

What does not port: every script imports `@repo/env`, and Saasaloy ships no `env` module. unishopr also moved `apps/api/.dev.vars` to `apps/api/.env`; Saasaloy still writes `.dev.vars`.

## Design decisions (settled)

| Decision | Resolution |
|---|---|
| Capability boundary against `database` | No new module. ADR 0037 question 1 decides it: the project owns the schema and the migrations, so this is driver work on the line ADR 0026 drew. A `db` capability would be a module whose entire body branches over the two drivers. |
| Does the `database` core change? | No. It stays driver-blind with `db:generate` only. |
| Registry shape | Neither providers nor drivers. This adds no selection point to the registry. |
| What the commands solve | Both readings, in one design. `db:setup` names the database from the branch in a feature worktree and uses the plain name otherwise. The branch rule costs one file and pays off the day the project gets a shared server. |
| The three backends | `docker`, `server`, `neon`. `docker` runs a local container. `server` uses the `DATABASE_URL` already in `.dev.vars`, connects to the `postgres` maintenance database and creates the branch database; a VPS is one instance of it. `neon` creates a temporary neon.new database. |
| The word for them | **Backend**, in `scripts/backends/`, recorded as `backend=docker` in the state block. Not "provider": AGENTS.md gives that word a registry meaning (a `plugin-array` patch plus a `<CAP>_PROVIDER` env var) that none of these has. A `CONTEXT.md` entry draws the line against "Provider module". |
| Backend selection | A flag on first run, persisted in the state block: `db:setup --docker | --server | --neon`. Later runs read the block. Switching needs `--reset`. `docker` is the default, because a fresh project has no server. This is `lib/state.ts` `chooseProvider` with a third member and a new default. |
| Docker lifecycle | A scaffolded `compose.yaml` at the repo root. `db:setup --docker` runs `docker compose up -d` when the server is unreachable, then creates the database. |
| How a root file is written | `database-postgres`'s existing `scaffolds` entry gains `"aliases": {"@root": "."}`, and `compose.yaml` targets `@root/compose.yaml`. The applier already writes a scaffold's alias map into `saasaloy.json`, so this works on a project of any age with no base-template change and no back-fill. AGENTS.md gains a rule: `@root` is for a file a developer runs by hand at the repo root, and a module needs a stated reason to use it. |
| `db:drop` meaning | It drops a database, never a server, on all three backends. No `db:up` or `db:down`. Container teardown is a documented `docker compose down -v`. |
| Command set | The three, plus `db:setup --reset`. `db:prune` and `db:seed` are follow-up issues. |
| D1 | Ships all three names as thin wrappers. `db:setup` calls the `db:migrate:local` command, `db:status` calls `wrangler d1 migrations list --local`, `db:drop` removes `apps/api/.wrangler/state/v3/d1`. No backends, no state block, no branch naming: `.wrangler/state` is gitignored and therefore already per-worktree. |
| D1 `db:drop` guard | It verifies the directory exists and resolves under the project root, then removes it with the pinned `rimraf`. A wrangler upgrade that moves the path makes `db:drop` a no-op that says so, rather than a wrong delete. The path is named in a comment and in the skill. |
| Root scripts | Three `package-json-script` patches into the root `package.json`, each `pnpm --filter @repo/db <name>`, so `pnpm db:setup` works. Patches take a plain project-relative file path, so the root is already patch-reachable; this is the first module to use that. |
| Env-file handling | Inline `scripts/lib/env-file.ts` in each driver, about 60 lines, scoped to `apps/api/.dev.vars`. No `env` capability in this issue. |
| Runner | `node scripts/<name>.ts`. The base template pins `node >=24.13.0`, which strips types natively, so no runner dependency is added. |
| Typecheck | Both drivers add `"scripts"` to `include` in the `packages/db/tsconfig.json` they each scaffold. |
| Patch mechanism | `package-json-script`, the repo's only script-adding kind. It is idempotent, never clobbers an existing key, and its lifecycle denylist does not cover these names. |
| `db:status` exit code | `0` normally, `1` when unreachable. No third code. |

## Approach

### Phase 1: the `@root` alias

- Add `"aliases": {"@root": "."}` to `modules/database-postgres`'s `packages/db` scaffold entry.
- Confirm `resolveTarget` normalizes `@root/compose.yaml` to `compose.yaml` rather than `./compose.yaml` (`packages/cli/src/lib/saasaloy-config.ts:89-92` joins a trimmed base to the rest, so `"."` yields `./compose.yaml` today). Fix the join or record the alias as `""` if the schema's `minLength: 1` allows it; otherwise normalize in `resolveTarget`.
- Extend `packages/cli/src/lib/collisions.ts` coverage so two modules writing `@root/<same file>` is reported, since the root now has more than one possible writer.
- Add the AGENTS.md rule for `@root`.
- Add a CLI test for a root-targeted file and for `remove` deleting it.

### Phase 2: the Postgres lifecycle scripts

- Ship `scripts/setup.ts`, `scripts/status.ts`, `scripts/drop.ts`, `scripts/lib/{context,state,url,branch-name,env-file}.ts` and `scripts/backends/{docker,server,neon}.ts` under `modules/database-postgres/files/`.
- Port `branch-name.ts` and `state.ts` from the precedent, renaming `provider` to `backend` and adding the `docker` member.
- `docker.ts` runs `docker compose up -d`, waits for the port, then does the same `CREATE DATABASE` work `server.ts` does.
- `server.ts` is the precedent's `vps.ts` with wider error text.
- `neon.ts` ports with its `uuidv7()` shim and IPv4 forcing; keep both comments, they are non-obvious.
- Scaffold `compose.yaml` at `@root/compose.yaml`: `postgres:18`, port `5432`, a named volume, `POSTGRES_PASSWORD=postgres`, and a header comment saying it is development-only.
- Add three `package-json-script` patches on `packages/db/package.json` and three on the root `package.json`.
- Add `"scripts"` to the driver's `tsconfig.json` `include`.

### Phase 3: the D1 wrappers

- Ship `scripts/setup.ts`, `scripts/status.ts`, `scripts/drop.ts` under `modules/database-d1/files/`, at the same targets as the Postgres set. Only one driver is ever installed, so this is the arrangement `client.ts` already uses.
- Add the same six script patches and the `tsconfig.json` `include` entry.

### Phase 4: documentation and the decision record

- Write the ADR: the commands belong to the drivers, `db` is not a capability, and a dev-database backend is not a registry provider.
- Add the `CONTEXT.md` glossary entries for "Backend" and "State block".
- Extend both driver skills with the commands, the state block, the backend flags and the refusal rules. Point `modules/database/skills/saasaloy-database/SKILL.md` at both.
- Run `pnpm lint`, `pnpm typecheck` and `pnpm deps:verify`, and verify end to end in `.dev` against both drivers.

### Rejected alternatives

- **A `modules/db` capability with `requiresOneOf`.** A module whose body is a driver branch, and two owners for `db:*`.
- **Commands in the `database` core, branching at runtime.** Puts `wrangler` and `postgres` knowledge in a package that declares neither.
- **A `saasaloy db setup` CLI command.** The generated project must work without the Saasaloy CLI installed.
- **`compose.yaml` under `packages/db/`.** No CLI change, but `docker compose up -d` with no `-f` is the command people type.
- **A `DB_DEV_BACKEND` env var for the backend.** The `<CAP>_PROVIDER` rule governs runtime selection inside the Worker; these scripts never run there.
- **Re-deriving the design instead of porting it.** The precedent already paid for the branch-name rule, the state block and the refusal model.

## Open questions

None. Every decision above was settled in the grill.

## Follow-ups

Deferred by decision, to be filed as their own issues.

1. **`db:prune`.** The precedent ships it because `db:drop` gets forgotten. It needs the git worktree list and a server-wide database list.
2. **`db:seed`.** `db:setup` in the precedent migrates *and* seeds, and its seed guard (`refuse a database not named <prefix>_dev or <prefix>_dev_<branch>`) is what makes the branch-name rule fully load-bearing.
3. **An `env` capability.** Phase 2 inlines an env-file reader and writer per driver. unishopr's `packages/env` is the shape a `saasaloy add env` would take, and `saasaloy env` would use it too.
4. **`remove <driver>` leaves patched script keys behind.** The D1 skill already records this wart for `packages/db/tsconfig.json`. This plan widens it to six script keys and a root `compose.yaml`, so the skills must say so until the remover handles it.

## Non-goals

- No new module, capability, provider or driver in the registry.
- No data migration between drivers. ADR 0026 still promises none.
- No production lifecycle. `db:migrate:prod` is unchanged, and `db:drop` never reaches a remote target.
- No automatic invocation. Nothing runs `db:setup` from a git hook or from `pnpm dev`, matching the precedent.
- No container teardown command. `docker compose down -v` stays a documented step.
